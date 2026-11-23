"use client";
import Image from "next/image";
import { useI18n } from "@/lib/i18n/client";
import { formatDate } from "./shell";

export type SheetItem = {
  medication_name: string;
  quantity: number | string;
  special_instructions?: string | null;
  strength?: string | null;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
};
export type SheetData = {
  clinic?: string | null;
  doctor?: string | null;
  issuedAt?: string;
  expiresAt?: string;
  patientName: string;
  patientId?: string;
  items: SheetItem[];
  notes?: string;
  code?: string;
  status?: "dispensed" | "cancelled" | "expired" | "partial";
  dispensedAt?: string;
  // Pharmacy portal only: what was dispensed, where and when (pharmacy names as entered, unverified).
  history?: {
    at: string;
    pharmacy: string | null;
    complete: boolean;
    items: { medication_name: string; quantity: number }[];
  }[];
};

const DETAILS = [
  ["rx_med_strength", "strength"],
  ["rx_med_dose", "dose"],
  ["rx_med_frequency", "frequency"],
  ["rx_med_duration", "duration"],
] as const;
const present = (value: string | null | undefined) =>
  Boolean(value && value.trim() && value.trim() !== "-");

// Printable prescription. It is rendered from the permanently stored record on demand; the browser's native print
// dialog prints it or saves it as a PDF. Nothing extra is generated, stored or fetched for printing.
export function PrescriptionSheet({ data }: { data: SheetData }) {
  const { t, locale } = useI18n();
  return (
    <article className="cx-sheet" aria-label={t("rx_sheet_title")}>
      <header className="cx-sheet-head">
        <Image
          src="/branding/clinic-rx-logo.png"
          alt="Clinic RX"
          width={140}
          height={26}
          className="cx-sheet-logo"
        />
        <h2 className="cx-sheet-title">{t("rx_sheet_title")}</h2>
      </header>

      {data.status && (
        <div className="cx-sheet-status" role="status">
          {t(`rx_state_${data.status}`)}
        </div>
      )}

      <section className="cx-sheet-parties" aria-label={t("rx_prescriber")}>
        <div className="cx-party">
          <span className="cx-sheet-label">{t("rx_prescriber")}</span>
          <strong className="cx-party-doctor">
            <bdi>{data.doctor || "—"}</bdi>
          </strong>
        </div>
        <div className="cx-party">
          <span className="cx-sheet-label">{t("rx_context_clinic")}</span>
          <strong className="cx-party-clinic">
            <bdi>{data.clinic || "—"}</bdi>
          </strong>
        </div>
      </section>

      <section className="cx-sheet-patient" aria-label={t("rx_patient")}>
        <div className="cx-patient-main">
          <span className="cx-sheet-label">{t("rx_patient")}</span>
          <strong className="cx-patient-name">
            <bdi>{data.patientName}</bdi>
          </strong>
          {data.patientId && (
            <span className="cx-patient-id">
              <span className="cx-sheet-label">{t("rx_national_id")}</span>{" "}
              <bdi className="cx-mono" dir="ltr">
                {data.patientId}
              </bdi>
            </span>
          )}
        </div>
        <dl className="cx-sheet-dates">
          <div>
            <dt>{t("rx_issued_at")}</dt>
            <dd>
              <bdi>{formatDate(data.issuedAt, locale)}</bdi>
            </dd>
          </div>
          <div>
            <dt>{t("rx_valid_until")}</dt>
            <dd>
              <bdi>{formatDate(data.expiresAt, locale)}</bdi>
            </dd>
          </div>
          {data.dispensedAt && (
            <div>
              <dt>{t("rx_dispensed_on")}</dt>
              <dd>
                <bdi>{formatDate(data.dispensedAt, locale)}</bdi>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="cx-sheet-meds" aria-labelledby="cx-sheet-meds-h">
        <h3 id="cx-sheet-meds-h" className="cx-sheet-section">
          {t("rx_medications")}
        </h3>
        <ol className="cx-rx-list">
          {data.items.map((m, i) => {
            const details = DETAILS.filter(([, key]) => present(m[key]));
            return (
              <li className="cx-rx-item" key={i}>
                <span className="cx-rx-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="cx-rx-body">
                  <div className="cx-rx-top">
                    <strong className="cx-rx-name">
                      <bdi>{m.medication_name}</bdi>
                    </strong>
                    <span className="cx-rx-qty">
                      <span className="cx-sheet-label">
                        {t("rx_med_quantity")}
                      </span>{" "}
                      <bdi>{m.quantity}</bdi>
                    </span>
                  </div>
                  {details.length > 0 && (
                    <dl className="cx-rx-details">
                      {details.map(([label, key]) => (
                        <div key={key}>
                          <dt>{t(label)}</dt>
                          <dd>
                            <bdi>{m[key]}</bdi>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {m.special_instructions && (
                    <p className="cx-rx-instructions">
                      <span className="cx-sheet-label">
                        {t("rx_instructions")}
                      </span>{" "}
                      <bdi>{m.special_instructions}</bdi>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {data.notes && (
        <section className="cx-sheet-block">
          <h3 className="cx-sheet-section">{t("rx_notes_title")}</h3>
          <p className="cx-sheet-notes">
            <bdi>{data.notes}</bdi>
          </p>
        </section>
      )}

      {data.code && (
        <section className="cx-sheet-block cx-sheet-code">
          <h3 className="cx-sheet-section">{t("rx_code_label")}</h3>
          <bdi className="cx-code cx-mono" dir="ltr">
            {data.code}
          </bdi>
        </section>
      )}

      {data.history && (
        <section className="cx-sheet-block cx-sheet-history">
          <h3 className="cx-sheet-section is-minor">{t("rx_hist_title")}</h3>
          {data.history.length === 0 ? (
            <p className="cx-sheet-empty">{t("rx_hist_none")}</p>
          ) : (
            <ol className="cx-history">
              {data.history.map((h, i) => (
                <li key={i}>
                  <div className="cx-history-head">
                    <strong>
                      <bdi>{h.pharmacy || t("rx_hist_unknown_pharmacy")}</bdi>
                    </strong>
                    <span>
                      <bdi>{formatDate(h.at, locale)}</bdi>
                    </span>
                    <span className={`cx-history-tag ${h.complete ? "" : "is-partial"}`}>
                      {t(h.complete ? "rx_hist_final" : "rx_hist_partial")}
                    </span>
                  </div>
                  <div className="cx-history-items">
                    {h.items.map((m, j) => (
                      <span key={j}>
                        <bdi>{m.medication_name}</bdi> × {m.quantity}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <footer className="cx-sheet-foot">
        <p className="cx-sheet-foot-text">{t("rx_sheet_footer")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset; a plain img keeps print/PDF output exact */}
        <img
          src="/branding/clinicrx-stamp.png"
          alt={t("rx_seal_alt")}
          className="cx-sheet-seal"
          width={320}
          height={318}
        />
      </footer>
      <p className="cx-sheet-privacy">{t("rx_privacy_notice")}</p>
    </article>
  );
}

// One action: the browser's native print dialog (print, or "Save as PDF"). The suggested file name carries no
// patient data. No PDF is generated by the app.
export function PrintButton({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  function print() {
    const previous = document.title;
    document.title = `ClinicRX-Rx-${new Date().toISOString().slice(0, 10)}`;
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }
  return (
    <button type="button" className={`cx-btn ${className}`} onClick={print}>
      {t("rx_save_pdf")}
    </button>
  );
}
