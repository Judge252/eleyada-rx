"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import {
  lookupInput,
  messages,
  pharmacyLabel,
  type FillHistoryEntry,
  type FillReceipt,
} from "@/lib/experience/contracts";
import { PrescriptionSheet, PrintButton, type SheetData } from "./prescription-sheet";
import {
  Notice,
  Shell,
  api,
  clearRequest,
  formatDate,
  localName,
  rememberRequest,
} from "./shell";

type LookupItem = {
  id: string;
  medication_name: string;
  strength?: string | null;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantity: number;
  special_instructions?: string | null;
  filled: number;
  remaining: number;
};
type Lookup = {
  state: "eligible" | "partial" | "dispensed" | "cancelled" | "expired";
  prescription_id?: string;
  lookup_id?: string;
  doctor_name?: string;
  clinic_name?: string;
  doctor_name_he?: string | null;
  doctor_name_en?: string | null;
  clinic_name_he?: string | null;
  clinic_name_en?: string | null;
  allergy_test_done?: boolean | null;
  patient: { name: string };
  issued_at: string;
  expires_at: string;
  dispensed_at?: string;
  items: LookupItem[];
  history?: FillHistoryEntry[];
};
const FILLABLE = ["eligible", "partial"];
const LABEL_KEY = "rx.pharmacy.label";

// Open portal: no pharmacy account. The ID number alone discloses nothing; ID + patient-held code open exactly one
// prescription and its own dispensing history. Each pharmacy records what it hands out now; the rest stays open.
export function PharmacyPortal() {
  const { t, locale } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [patientId, setPatientId] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [identityOk, setIdentityOk] = useState(false);
  // The fill form only renders after a lookup, so reading the remembered name here cannot cause a hydration mismatch.
  const [label, setLabel] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : (localStorage.getItem(LABEL_KEY) ?? "");
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<FillReceipt | null>(null);
  const [formError, setFormError] = useState(false);
  const request = useRef<string | null>(null);
  const lookupId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      request.current = sessionStorage.getItem("rx.fill.request");
      lookupId.current = sessionStorage.getItem("rx.fill.lookup");
    } catch {}
  }, []);

  const fillable = found && FILLABLE.includes(found.state) && !receipt;
  const parsed = (found?.items ?? []).map((item) => {
    const raw = (amounts[item.id] ?? "").trim();
    const value = raw === "" ? 0 : Number(raw);
    return { item, raw, value };
  });
  const invalid = parsed.some(
    ({ raw, value, item }) =>
      raw !== "" && (!Number.isSafeInteger(value) || value < 0 || value > item.remaining),
  );
  const chosen = parsed.filter(({ value }) => Number.isSafeInteger(value) && value > 0);
  const completes =
    !invalid &&
    chosen.length > 0 &&
    parsed.every(({ item, value }) => (Number.isSafeInteger(value) ? value : 0) === item.remaining);

  async function find(e: FormEvent) {
    e.preventDefault();
    setFeedback("");
    setFound(null);
    setReceipt(null);
    const proof = lookupInput({ identifier, code });
    if (!proof) {
      setFormError(true);
      setFeedback(messages.validation);
      return;
    }
    setFormError(false);
    setBusy(true);
    const reply = await api({ operation: "lookup", identifier, code });
    setBusy(false);
    const result = reply.result as Lookup | undefined;
    if (result?.patient && Array.isArray(result.items)) {
      setFound(result);
      setPatientId(proof.identifier);
      setAmounts({});
      setIdentityOk(false);
      if (FILLABLE.includes(result.state))
        requestAnimationFrame(() => heading.current?.focus());
    } else setFeedback(reply.message ?? messages.unavailable);
  }

  function finish(r: FillReceipt) {
    setReceipt(r);
    // Show the new state without spending another lookup: add this fill to the history and lower the remainders.
    setFound((f) => {
      if (!f) return f;
      const given = new Map(r.items.map((i) => [i.item_id, i.quantity]));
      const already = (f.history ?? []).some(
        (h) => h.at === r.filled_at && h.pharmacy === r.pharmacy_label,
      );
      return {
        ...f,
        state: r.completes ? "dispensed" : "partial",
        dispensed_at: r.completes ? r.filled_at : f.dispensed_at,
        items: f.items.map((i) => {
          const q = already ? 0 : (given.get(i.id) ?? 0);
          return { ...i, filled: i.filled + q, remaining: Math.max(i.remaining - q, 0) };
        }),
        history: already
          ? f.history
          : [
              ...(f.history ?? []),
              {
                at: r.filled_at,
                pharmacy: r.pharmacy_label,
                complete: r.completes,
                items: r.items.map(({ medication_name, quantity }) => ({ medication_name, quantity })),
              },
            ],
      };
    });
    setUncertain(false);
    setFeedback("");
    clearRequest("rx.fill.request");
    clearRequest("rx.fill.lookup");
    request.current = null;
    lookupId.current = null;
  }

  async function submit() {
    if (!found?.lookup_id || !found.prescription_id || busy) return;
    const name = pharmacyLabel(label);
    if (invalid) return setFeedback("rx_fill_over");
    if (chosen.length === 0) return setFeedback("rx_fill_need_qty");
    if (!name) return setFeedback("rx_fill_need_pharmacy");
    try {
      localStorage.setItem(LABEL_KEY, name);
    } catch {}
    setBusy(true);
    request.current ??= rememberRequest("rx.fill.request");
    lookupId.current = found.lookup_id;
    try {
      sessionStorage.setItem("rx.fill.lookup", found.lookup_id);
    } catch {}
    const reply = await api({
      operation: "fill",
      requestId: request.current,
      lookupId: found.lookup_id,
      prescriptionId: found.prescription_id,
      identityConfirmed: identityOk,
      items: chosen.map(({ item, value }) => ({ item_id: item.id, quantity: value })),
      pharmacyLabel: name,
    });
    setBusy(false);
    if (reply.result) finish(reply.result as FillReceipt);
    else {
      setUncertain(["unavailable", "uncertain"].includes(reply.state ?? ""));
      setFeedback(reply.message ?? messages.unavailable);
    }
  }

  async function recover() {
    if (!request.current || !lookupId.current) {
      setFeedback("rx_no_receipt");
      return;
    }
    setBusy(true);
    const reply = await api({
      operation: "recoverFill",
      requestId: request.current,
      lookupId: lookupId.current,
    });
    setBusy(false);
    if (reply.result) finish(reply.result as FillReceipt);
    else setFeedback("rx_no_receipt");
  }

  function reset() {
    setIdentifier("");
    setCode("");
    setFound(null);
    setReceipt(null);
    setAmounts({});
    setFeedback("");
    setUncertain(false);
  }
  function fillAll() {
    if (!found) return;
    setAmounts(Object.fromEntries(found.items.map((i) => [i.id, String(i.remaining)])));
  }

  const sheet: SheetData | null = found
    ? {
        clinic: localName(locale, found.clinic_name_he, found.clinic_name_en, found.clinic_name),
        doctor: localName(locale, found.doctor_name_he, found.doctor_name_en, found.doctor_name),
        issuedAt: found.issued_at,
        expiresAt: found.expires_at,
        patientName: found.patient.name,
        patientId,
        items: found.items,
        allergyTest: found.allergy_test_done ?? null,
        status: found.state === "eligible" ? undefined : found.state,
        dispensedAt: found.state === "dispensed" ? found.dispensed_at : undefined,
        history: found.history ?? [],
      }
    : null;

  return (
    <Shell active="pharmacy" narrow>
      <h1 className="cx-title">{t("rx_ph_title")}</h1>
      <p className="cx-lede">{t("rx_ph_lede")}</p>
      {feedback && <Notice tone={uncertain ? "warn" : "error"}>{t(feedback)}</Notice>}
      {!found && (
        <form className="cx-panel" onSubmit={find} noValidate>
          <div className="cx-grid">
            <label className="cx-field" htmlFor="ph-id">
              <span>{t("rx_national_id")}</span>
              <input
                id="ph-id"
                className="cx-input cx-ltr cx-mono"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                value={identifier}
                aria-invalid={formError}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </label>
            <label className="cx-field" htmlFor="ph-code">
              <span>{t("rx_access_code")}</span>
              <input
                id="ph-code"
                className="cx-input cx-ltr cx-mono"
                inputMode="numeric"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={80}
                placeholder="123456"
                value={code}
                aria-invalid={formError}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          </div>
          <p className="cx-hint">{t("rx_ph_privacy")}</p>
          <div className="cx-actions">
            <button className="cx-btn" type="submit" disabled={busy}>
              {busy ? t("rx_finding") : t("rx_find")}
            </button>
          </div>
        </form>
      )}
      {receipt && (
        <Notice tone="ok">
          <strong>{t(receipt.completes ? "rx_disp_title" : "rx_disp_title_partial")}</strong>
          <div>{t(receipt.completes ? "rx_disp_body" : "rx_disp_body_partial")}</div>
          <div>
            {t("rx_disp_pharmacy")}: <bdi>{receipt.pharmacy_label}</bdi> ·{" "}
            {formatDate(receipt.filled_at, locale)}
          </div>
        </Notice>
      )}
      {sheet && (
        <section className="cx-panel">
          <PrescriptionSheet data={sheet} />
          <div className="cx-actions cx-noprint">
            <PrintButton />
            {!fillable && (
              <button className="cx-btn" onClick={reset}>
                {t("rx_start_over")}
              </button>
            )}
          </div>
          <p className="cx-hint cx-noprint">{t("rx_pdf_hint")}</p>
        </section>
      )}
      {fillable && found && (
        <section className="cx-panel cx-noprint" aria-labelledby="ph-fill">
          <h2 id="ph-fill" ref={heading} tabIndex={-1}>
            {t("rx_fill_title")}
          </h2>
          <div className="cx-fill">
            {found.items.map((item) => (
              <div className="cx-fill-row" key={item.id}>
                <div className="cx-fill-name">
                  <bdi>{item.medication_name}</bdi>
                </div>
                <dl className="cx-fill-nums">
                  <div>
                    <dt>{t("rx_fill_prescribed")}</dt>
                    <dd>{item.quantity}</dd>
                  </div>
                  <div>
                    <dt>{t("rx_fill_given")}</dt>
                    <dd>{item.filled}</dd>
                  </div>
                  <div>
                    <dt>{t("rx_fill_left")}</dt>
                    <dd>
                      <strong>{item.remaining}</strong>
                    </dd>
                  </div>
                </dl>
                <label className="cx-field cx-fill-input" htmlFor={`fill-${item.id}`}>
                  <span>{t("rx_fill_now")}</span>
                  <input
                    id={`fill-${item.id}`}
                    className="cx-input cx-ltr cx-mono"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={busy || item.remaining === 0}
                    placeholder="0"
                    value={amounts[item.id] ?? ""}
                    aria-invalid={(() => {
                      const raw = (amounts[item.id] ?? "").trim();
                      const v = Number(raw);
                      return raw !== "" && (!Number.isSafeInteger(v) || v < 0 || v > item.remaining);
                    })()}
                    onChange={(e) =>
                      setAmounts((a) => ({ ...a, [item.id]: e.target.value.replace(/[^0-9]/g, "") }))
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="cx-actions">
            <button type="button" className="cx-btn is-secondary" disabled={busy} onClick={fillAll}>
              {t("rx_fill_all")}
            </button>
            <button type="button" className="cx-btn is-quiet" disabled={busy} onClick={() => setAmounts({})}>
              {t("rx_fill_clear")}
            </button>
          </div>
          {chosen.length > 0 && !invalid && (
            <p className="cx-hint" role="status">
              {t(completes ? "rx_fill_will_complete" : "rx_fill_will_partial")}
            </p>
          )}
          <label className="cx-check">
            <input
              type="checkbox"
              checked={identityOk}
              disabled={busy}
              onChange={(e) => setIdentityOk(e.target.checked)}
            />
            <span>{t("rx_confirm_identity")}</span>
          </label>
          <label className="cx-field" htmlFor="ph-label">
            <span>{t("rx_pharmacy_name")}</span>
            <input
              id="ph-label"
              className="cx-input"
              dir="auto"
              maxLength={120}
              autoComplete="organization"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <small className="cx-hint">{t("rx_pharmacy_name_help")}</small>
          </label>
          {uncertain && <Notice tone="warn">{t("rx_uncertain")}</Notice>}
          <div className="cx-actions">
            <button
              className="cx-btn"
              disabled={busy || !identityOk || chosen.length === 0 || invalid || !pharmacyLabel(label)}
              onClick={submit}
            >
              {busy ? t("rx_issuing") : uncertain ? t("rx_retry_dispense") : t("rx_fill_submit")}
            </button>
            {uncertain && (
              <button className="cx-btn is-secondary" disabled={busy} onClick={recover}>
                {t("rx_recover_dispense")}
              </button>
            )}
            <button className="cx-btn is-secondary" disabled={busy || uncertain} onClick={reset}>
              {t("rx_start_over")}
            </button>
          </div>
        </section>
      )}
    </Shell>
  );
}
