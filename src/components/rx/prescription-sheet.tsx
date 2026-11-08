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
  status?: "dispensed" | "cancelled" | "expired";
  dispensedAt?: string;
};

// Printable prescription. It is rendered from the permanently stored record on demand, so "Save as PDF" in the
// print dialog produces a small text PDF in the browser and nothing extra is stored or fetched from the database.
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
        />
        <strong>{t("rx_sheet_title")}</strong>
      </header>
      {data.status && (
        <div className="cx-sheet-status" role="status">
          {t(`rx_state_${data.status}`)}
        </div>
      )}
      <dl className="cx-dl">
        <dt>{t("rx_context_clinic")}</dt>
        <dd>{data.clinic || "—"}</dd>
        <dt>{t("rx_prescriber")}</dt>
        <dd>{data.doctor || "—"}</dd>
        <dt>{t("rx_issued_at")}</dt>
        <dd>{formatDate(data.issuedAt, locale)}</dd>
        <dt>{t("rx_valid_until")}</dt>
        <dd>{formatDate(data.expiresAt, locale)}</dd>
        <dt>{t("rx_patient")}</dt>
        <dd>{data.patientName}</dd>
        {data.patientId && (
          <>
            <dt>{t("rx_national_id")}</dt>
            <dd>
              <bdi className="cx-mono">{data.patientId}</bdi>
            </dd>
          </>
        )}
        {data.dispensedAt && (
          <>
            <dt>{t("rx_dispensed_on")}</dt>
            <dd>{formatDate(data.dispensedAt, locale)}</dd>
          </>
        )}
      </dl>
      <h2 className="cx-sheet-h">{t("rx_medications")}</h2>
      {data.items.map((m, i) => (
        <div className="cx-med-row" key={i}>
          <h3 className="cx-med-title">
            {t("rx_med_n")} {i + 1}
          </h3>
          <dl className="cx-dl">
            <dt>{t("rx_med_name")}</dt>
            <dd>
              <bdi>{m.medication_name}</bdi>
            </dd>
            <dt>{t("rx_med_quantity")}</dt>
            <dd>{m.quantity}</dd>
            {(
              [
                ["rx_med_strength", m.strength],
                ["rx_med_dose", m.dose],
                ["rx_med_frequency", m.frequency],
                ["rx_med_duration", m.duration],
              ] as const
            )
              .filter(([, value]) => value && value !== "-")
              .map(([label, value]) => (
                <div className="cx-dl-row" key={label}>
                  <dt>{t(label)}</dt>
                  <dd>
                    <bdi>{value}</bdi>
                  </dd>
                </div>
              ))}
            {m.special_instructions && (
              <>
                <dt>{t("rx_instructions")}</dt>
                <dd>{m.special_instructions}</dd>
              </>
            )}
          </dl>
        </div>
      ))}
      {data.notes && (
        <>
          <h2 className="cx-sheet-h">{t("rx_notes_title")}</h2>
          <p>{data.notes}</p>
        </>
      )}
      {data.code && (
        <>
          <h2 className="cx-sheet-h">{t("rx_code_label")}</h2>
          <bdi className="cx-code cx-mono" dir="ltr">
            {data.code}
          </bdi>
        </>
      )}
      <footer className="cx-sheet-foot">{t("rx_sheet_footer")}</footer>
    </article>
  );
}

// Opens the browser print dialog ("Save as PDF" or a printer). The file name carries no patient data.
export function SavePdfButton({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  function save() {
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
    <>
      <button
        type="button"
        className={`cx-btn is-secondary ${className}`}
        onClick={save}
      >
        {t("rx_save_pdf")}
      </button>
    </>
  );
}
