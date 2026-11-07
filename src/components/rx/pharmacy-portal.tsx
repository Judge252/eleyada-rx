"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import {
  lookupInput,
  messages,
  type Receipt,
  type Selection,
} from "@/lib/experience/contracts";
import {
  Notice,
  Shell,
  api,
  clearRequest,
  formatDate,
  rememberRequest,
} from "./shell";

type Eligible = Selection & { state: "eligible" };
const END_STATES = ["dispensed", "cancelled", "expired"];

// Open portal: no pharmacy account. The ID number alone discloses nothing; ID + patient-held code open exactly one prescription.
export function PharmacyPortal() {
  const { t, locale } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<Eligible | null>(null);
  const [ended, setEnded] = useState("");
  const [identityOk, setIdentityOk] = useState(false);
  const [fullOk, setFullOk] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const request = useRef<string | null>(null);
  const lookupId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [formError, setFormError] = useState(false);
  useEffect(() => {
    try {
      request.current = sessionStorage.getItem("rx.dispense.request");
      lookupId.current = sessionStorage.getItem("rx.dispense.lookup");
    } catch {}
  }, []);

  async function find(e: FormEvent) {
    e.preventDefault();
    setFeedback("");
    setEnded("");
    setSelected(null);
    setReceipt(null);
    if (!lookupInput({ identifier, code })) {
      setFormError(true);
      setFeedback(messages.validation);
      return;
    }
    setFormError(false);
    setBusy(true);
    const reply = await api({ operation: "lookup", identifier, code });
    setBusy(false);
    const result = reply.result as
      | ({ state?: string } & Partial<Eligible>)
      | undefined;
    if (result?.state === "eligible") {
      setSelected(result as Eligible);
      setIdentityOk(false);
      setFullOk(false);
      requestAnimationFrame(() => heading.current?.focus());
    } else if (result?.state && END_STATES.includes(result.state))
      setEnded(result.state);
    else setFeedback(reply.message ?? messages.unavailable);
  }
  function finish(r: Receipt) {
    setReceipt(r);
    setUncertain(false);
    setFeedback("");
    setSelected(null);
    clearRequest("rx.dispense.request");
    clearRequest("rx.dispense.lookup");
    request.current = null;
    lookupId.current = null;
  }
  async function dispense() {
    if (!selected || busy) return;
    setBusy(true);
    request.current ??= rememberRequest("rx.dispense.request");
    lookupId.current = selected.lookup_id;
    try {
      sessionStorage.setItem("rx.dispense.lookup", selected.lookup_id);
    } catch {}
    const reply = await api({
      operation: "dispense",
      requestId: request.current,
      lookupId: selected.lookup_id,
      prescriptionId: selected.prescription_id,
      identityConfirmed: identityOk,
      fullConfirmed: fullOk,
      pharmacyLabel: label.trim(),
    });
    setBusy(false);
    if (reply.result) finish(reply.result as Receipt);
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
      operation: "recoverDispense",
      requestId: request.current,
      lookupId: lookupId.current,
    });
    setBusy(false);
    if (reply.result) finish(reply.result as Receipt);
    else setFeedback("rx_no_receipt");
  }
  function reset() {
    setIdentifier("");
    setCode("");
    setSelected(null);
    setReceipt(null);
    setEnded("");
    setFeedback("");
    setUncertain(false);
  }

  return (
    <Shell active="pharmacy" narrow>
      <h1 className="cx-title">{t("rx_ph_title")}</h1>
      <p className="cx-lede">{t("rx_ph_lede")}</p>
      {feedback && (
        <Notice tone={uncertain ? "warn" : "error"}>{t(feedback)}</Notice>
      )}
      {ended && <Notice tone="warn">{t(`rx_state_${ended}`)}</Notice>}
      {!selected && !receipt && (
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
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={80}
                placeholder="RX1-K1-XXXX-XXXX-…"
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
      {selected && (
        <section className="cx-panel" aria-labelledby="ph-review">
          <h2 id="ph-review" ref={heading} tabIndex={-1}>
            {t("rx_ph_review")}
          </h2>
          <dl className="cx-dl">
            <dt>{t("rx_patient")}</dt>
            <dd>{selected.patient.name}</dd>
            <dt>{t("rx_issued_at")}</dt>
            <dd>{formatDate(selected.issued_at, locale)}</dd>
            <dt>{t("rx_valid_until")}</dt>
            <dd>{formatDate(selected.expires_at, locale)}</dd>
          </dl>
          {selected.items.map((m, i) => (
            <div className="cx-med-row" key={i}>
              <strong>
                <bdi>
                  {m.medication_name} · {m.strength}
                </bdi>
              </strong>
              <span>
                {m.dose} · {m.frequency} · {m.duration} · {t("rx_qty")}{" "}
                {m.quantity}
              </span>
              {m.special_instructions && <div>{m.special_instructions}</div>}
            </div>
          ))}
          <label className="cx-check">
            <input
              type="checkbox"
              checked={identityOk}
              disabled={busy}
              onChange={(e) => setIdentityOk(e.target.checked)}
            />
            <span>{t("rx_confirm_identity")}</span>
          </label>
          <label className="cx-check">
            <input
              type="checkbox"
              checked={fullOk}
              disabled={busy}
              onChange={(e) => setFullOk(e.target.checked)}
            />
            <span>{t("rx_confirm_full")}</span>
          </label>
          <label className="cx-field" htmlFor="ph-label">
            <span>{t("rx_pharmacy_name")}</span>
            <input
              id="ph-label"
              className="cx-input"
              dir="auto"
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <small className="cx-hint">{t("rx_pharmacy_name_help")}</small>
          </label>
          {uncertain && <Notice tone="warn">{t("rx_uncertain")}</Notice>}
          <div className="cx-actions">
            <button
              className="cx-btn"
              disabled={busy || !identityOk || !fullOk}
              onClick={dispense}
            >
              {busy
                ? t("rx_issuing")
                : uncertain
                  ? t("rx_retry_dispense")
                  : t("rx_dispense")}
            </button>
            {uncertain && (
              <button
                className="cx-btn is-secondary"
                disabled={busy}
                onClick={recover}
              >
                {t("rx_recover_dispense")}
              </button>
            )}
            <button
              className="cx-btn is-secondary"
              disabled={busy || uncertain}
              onClick={reset}
            >
              {t("rx_edit")}
            </button>
          </div>
        </section>
      )}
      {receipt && (
        <section className="cx-panel" aria-live="polite">
          <Notice tone="ok">
            <strong>{t("rx_disp_title")}</strong>
            <div>{t("rx_disp_body")}</div>
          </Notice>
          <dl className="cx-dl">
            <dt>{t("rx_disp_ref")}</dt>
            <dd>
              <bdi className="cx-mono">{receipt.id}</bdi>
            </dd>
            <dt>{t("rx_disp_time")}</dt>
            <dd>{formatDate(receipt.dispensed_at, locale)}</dd>
          </dl>
          <div className="cx-actions">
            <button
              className="cx-btn is-secondary"
              onClick={() => window.print()}
            >
              {t("rx_print")}
            </button>
            <button className="cx-btn" onClick={reset}>
              {t("rx_start_over")}
            </button>
          </div>
        </section>
      )}
    </Shell>
  );
}
