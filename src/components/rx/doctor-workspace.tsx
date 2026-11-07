"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import { SessionGuard, SignOutButton } from "@/components/session-controls";
import {
  formPayload,
  messages,
  type FormPayload,
  type PrescriberContext,
  type Receipt,
} from "@/lib/experience/contracts";
import {
  Notice,
  Shell,
  api,
  clearRequest,
  formatDate,
  rememberRequest,
} from "./shell";

type Medicine = {
  key: number;
  name: string;
  strength: string;
  dose: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};
const emptyMedicine = (key: number): Medicine => ({
  key,
  name: "",
  strength: "",
  dose: "",
  frequency: "",
  duration: "",
  quantity: "",
  instructions: "",
});
const fields = [
  ["name", "rx_med_name", 200],
  ["strength", "rx_med_strength", 120],
  ["dose", "rx_med_dose", 200],
  ["frequency", "rx_med_frequency", 200],
  ["duration", "rx_med_duration", 120],
  ["quantity", "rx_med_quantity", 7],
] as const;
const blankPatient = { name: "", identifier: "", notes: "" };

export function DoctorWorkspace() {
  const { t, locale } = useI18n();
  const [context, setContext] = useState<PrescriberContext>({
    state: "unauthorized",
  });
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState(blankPatient);
  const [medicines, setMedicines] = useState([emptyMedicine(1)]);
  const next = useRef(2);
  const [review, setReview] = useState<FormPayload | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const request = useRef<string | null>(null);
  const frozen = useRef<FormPayload | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    void api({ operation: "context" }).then((reply) => {
      if (!alive) return;
      if (reply.result) setContext(reply.result as PrescriberContext);
      setLoading(false);
    });
    try {
      request.current = sessionStorage.getItem("rx.issue.request");
    } catch {}
    return () => {
      alive = false;
    };
  }, []);

  const verified = context.state === "verified";
  async function issue() {
    if (!review || busy) return;
    setBusy(true);
    setFeedback("");
    request.current ??= rememberRequest("rx.issue.request");
    frozen.current ??= review;
    setSubmitted(true);
    const reply = await api({
      operation: "issue",
      reviewedDoctorId: context.doctor_id,
      reviewedClinicId: context.clinic_id,
      requestId: request.current,
      payload: frozen.current,
      confirmed: true,
    });
    setBusy(false);
    if (reply.result) {
      setReceipt(reply.result as Receipt);
      clearRequest("rx.issue.request");
      setUncertain(false);
    } else {
      const unsure = ["uncertain", "unavailable"].includes(reply.state ?? "");
      setFeedback(reply.message ?? messages.unavailable);
      setUncertain(unsure);
      if (!unsure) {
        frozen.current = null;
        setSubmitted(false);
      }
    }
  }
  async function recover() {
    request.current ??= rememberRequest("rx.issue.request");
    setBusy(true);
    const reply = await api({
      operation: "recoverIssue",
      requestId: request.current,
    });
    setBusy(false);
    if (reply.result) {
      setReceipt(reply.result as Receipt);
      clearRequest("rx.issue.request");
      setUncertain(false);
      setFeedback("");
    } else setFeedback(reply.message ?? "rx_no_receipt");
  }
  function prepare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = formPayload({
      ...patient,
      items: medicines.map((m) => ({
        medication_name: m.name,
        strength: m.strength,
        dose: m.dose,
        frequency: m.frequency,
        duration: m.duration,
        quantity: Number(m.quantity),
        special_instructions: m.instructions,
      })),
    });
    if (!payload) {
      setInvalid(true);
      setFeedback(messages.validation);
      return;
    }
    setInvalid(false);
    setReview(payload);
    setFeedback("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  function restart() {
    setReceipt(null);
    setReview(null);
    frozen.current = null;
    request.current = null;
    setSubmitted(false);
    setPatient(blankPatient);
    setMedicines([emptyMedicine(next.current++)]);
    setFeedback("");
  }
  const step = receipt ? 2 : review ? 1 : 0;
  const aside = (
    <aside className="cx-panel cx-aside cx-noprint">
      <dl>
        <dt>{t("rx_context_doctor")}</dt>
        <dd>
          {loading
            ? t("rx_checking")
            : (context.doctor_name ?? t("rx_unverified"))}
        </dd>
        <dt>{t("rx_context_clinic")}</dt>
        <dd>{context.clinic_name ?? "—"}</dd>
        <dt>{t("rx_context_sub")}</dt>
        <dd>
          <span className={`cx-state-pill ${context.entitled ? "" : "is-off"}`}>
            {context.entitled ? t("rx_active") : t("rx_inactive_short")}
          </span>
        </dd>
      </dl>
      {verified && <SignOutButton />}
    </aside>
  );

  return (
    <Shell active="doctor" aside={aside}>
      {verified && (
        <SessionGuard role="doctor" identity={context.doctor_id} />
      )}
      <h1 className="cx-title">{t("rx_doc_title")}</h1>
      <p className="cx-lede cx-noprint">{t("rx_doc_lede")}</p>
      <ol className="cx-steps" aria-label={t("rx_steps_label")}>
        {["rx_step_details", "rx_step_review", "rx_step_receipt"].map(
          (key, i) => (
            <li key={key} aria-current={step === i ? "step" : undefined}>
              {i + 1}. {t(key)}
            </li>
          ),
        )}
      </ol>
      <h2 className="sr-only" ref={heading} tabIndex={-1}>
        {t(receipt ? "rx_receipt_title" : "rx_review_title")}
      </h2>
      {feedback && <Notice tone={uncertain ? "warn" : "error"}>{t(feedback)}</Notice>}
      {!loading && verified && !context.entitled && (
        <Notice tone="warn">{t("rx_inactive")}</Notice>
      )}
      {!receipt && !review && (
        <form onSubmit={prepare} noValidate>
          <section className="cx-panel">
            <h2>{t("rx_patient")}</h2>
            <div className="cx-grid">
              <label className="cx-field" htmlFor="patient-name">
                <span>{t("rx_patient_name")}</span>
                <input
                  id="patient-name"
                  className="cx-input"
                  dir="auto"
                  maxLength={200}
                  autoComplete="off"
                  value={patient.name}
                  aria-invalid={invalid && !patient.name.trim()}
                  onChange={(e) =>
                    setPatient({ ...patient, name: e.target.value })
                  }
                />
              </label>
              <label className="cx-field" htmlFor="patient-id">
                <span>{t("rx_national_id")}</span>
                <input
                  id="patient-id"
                  className="cx-input cx-ltr cx-mono"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={12}
                  value={patient.identifier}
                  onChange={(e) =>
                    setPatient({ ...patient, identifier: e.target.value })
                  }
                />
                <small className="cx-hint">{t("rx_id_help")}</small>
              </label>
            </div>
          </section>
          <section className="cx-panel">
            <h2>{t("rx_medications")}</h2>
            {medicines.map((m, i) => (
              <fieldset className="cx-med" key={m.key}>
                <legend>
                  {t("rx_med_n")} {i + 1}
                </legend>
                <div className="cx-med-grid">
                  {fields.map(([field, label, max]) => (
                    <label
                      className={`cx-field ${field === "name" ? "is-wide" : ""}`}
                      key={field}
                      htmlFor={`med-${m.key}-${field}`}
                    >
                      <span>{t(label)}</span>
                      <input
                        id={`med-${m.key}-${field}`}
                        className="cx-input"
                        dir="auto"
                        maxLength={max}
                        value={m[field]}
                        inputMode={field === "quantity" ? "numeric" : undefined}
                        onChange={(e) =>
                          setMedicines((rows) =>
                            rows.map((row) =>
                              row.key === m.key
                                ? { ...row, [field]: e.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <label
                    className="cx-field is-wide"
                    htmlFor={`med-${m.key}-instructions`}
                  >
                    <span>{t("rx_med_instructions")}</span>
                    <input
                      id={`med-${m.key}-instructions`}
                      className="cx-input"
                      dir="auto"
                      maxLength={2000}
                      value={m.instructions}
                      onChange={(e) =>
                        setMedicines((rows) =>
                          rows.map((row) =>
                            row.key === m.key
                              ? { ...row, instructions: e.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                {medicines.length > 1 && (
                  <button
                    type="button"
                    className="cx-btn is-quiet"
                    onClick={() =>
                      setMedicines((rows) =>
                        rows.filter((row) => row.key !== m.key),
                      )
                    }
                  >
                    {t("rx_remove")} {i + 1}
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              className="cx-btn is-secondary"
              disabled={medicines.length >= 30}
              onClick={() =>
                setMedicines((rows) => [...rows, emptyMedicine(next.current++)])
              }
            >
              + {t("rx_add_med")}
            </button>
          </section>
          <section className="cx-panel">
            <label className="cx-field" htmlFor="notes">
              <span>{t("rx_notes")}</span>
              <textarea
                id="notes"
                className="cx-textarea"
                dir="auto"
                maxLength={4000}
                value={patient.notes}
                onChange={(e) =>
                  setPatient({ ...patient, notes: e.target.value })
                }
              />
            </label>
          </section>
          <div className="cx-actions">
            <button className="cx-btn" type="submit">
              {t("rx_review_btn")}
            </button>
          </div>
        </form>
      )}
      {review && !receipt && (
        <section className="cx-panel">
          <h2>{t("rx_review_title")}</h2>
          <p className="cx-hint">{t("rx_review_note")}</p>
          <dl className="cx-dl">
            <dt>{t("rx_patient")}</dt>
            <dd>{review.name}</dd>
            <dt>{t("rx_national_id")}</dt>
            <dd>
              <bdi className="cx-mono">{review.identifier}</bdi>
            </dd>
            <dt>{t("rx_prescriber")}</dt>
            <dd>
              {context.doctor_name ?? t("rx_unverified")} ·{" "}
              {context.clinic_name ?? "—"}
            </dd>
          </dl>
          {review.items.map((m, i) => (
            <div className="cx-med-row" key={i}>
              <strong>
                {i + 1}.{" "}
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
          {review.notes && <p>{review.notes}</p>}
          {uncertain && <Notice tone="warn">{t("rx_uncertain")}</Notice>}
          <div className="cx-actions">
            <button
              className="cx-btn is-secondary"
              disabled={busy || uncertain || submitted}
              onClick={() => setReview(null)}
            >
              {t("rx_edit")}
            </button>
            <button
              className="cx-btn"
              disabled={busy || !verified || !context.entitled}
              onClick={issue}
            >
              {busy
                ? t("rx_issuing")
                : uncertain
                  ? t("rx_retry_same")
                  : t("rx_issue")}
            </button>
            {uncertain && (
              <button
                className="cx-btn is-secondary"
                disabled={busy}
                onClick={recover}
              >
                {t("rx_recover_issue")}
              </button>
            )}
          </div>
        </section>
      )}
      {receipt && (
        <section className="cx-panel" aria-live="polite">
          <Notice tone="ok">
            <strong>{t("rx_receipt_title")}</strong>
          </Notice>
          <h2>{t("rx_code_label")}</h2>
          {receipt.reference ? (
            <bdi className="cx-code cx-mono" dir="ltr">
              {receipt.reference}
            </bdi>
          ) : (
            <Notice tone="warn">{t("rx_code_missing")}</Notice>
          )}
          <p className="cx-hint">{t("rx_code_help")}</p>
          <dl className="cx-dl">
            <dt>{t("rx_prescriber")}</dt>
            <dd>
              {receipt.doctor_name ?? context.doctor_name} ·{" "}
              {receipt.clinic_name ?? context.clinic_name}
            </dd>
            <dt>{t("rx_issued_at")}</dt>
            <dd>{formatDate(receipt.issued_at, locale)}</dd>
            <dt>{t("rx_valid_until")}</dt>
            <dd>{formatDate(receipt.expires_at, locale)}</dd>
            <dt>{t("rx_ref")}</dt>
            <dd>
              <bdi className="cx-mono">{receipt.id}</bdi>
            </dd>
          </dl>
          <div className="cx-actions">
            <button
              className="cx-btn is-secondary"
              onClick={() => window.print()}
            >
              {t("rx_print")}
            </button>
            {!receipt.reference && (
              <button
                className="cx-btn is-secondary"
                disabled={busy}
                onClick={recover}
              >
                {t("rx_recover_issue")}
              </button>
            )}
            <button className="cx-btn" onClick={restart}>
              {t("rx_new")}
            </button>
          </div>
        </section>
      )}
    </Shell>
  );
}
