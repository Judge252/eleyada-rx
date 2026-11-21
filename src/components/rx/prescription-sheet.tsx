"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
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

type PdfResult = { url: string; preview: string; name: string };

// Renders the sheet (same fonts, RTL shaping and layout as on screen) into an A4 PDF in the browser.
// Nothing is uploaded or stored; the file name carries no patient data.
async function buildPdf(sheet: HTMLElement): Promise<PdfResult> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ]);
  // Lay the sheet out at a fixed A4-like width so phones and desktops produce the same document.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dir = document.documentElement.dir || "rtl";
  host.style.cssText =
    "position:fixed;top:0;left:-10000px;width:760px;background:#fff;pointer-events:none;";
  const clone = sheet.cloneNode(true) as HTMLElement;
  clone.style.margin = "0";
  clone.style.width = "760px";
  clone.style.maxWidth = "none";
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    await Promise.all(
      Array.from(clone.querySelectorAll("img")).map((img) =>
        img.complete ? null : img.decode().catch(() => null),
      ),
    );
    const canvas = await toCanvas(clone, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      width: clone.offsetWidth,
      height: clone.offsetHeight,
    });
    const pdf = new jsPDF({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
      compress: true,
    });
    const margin = 12;
    const contentW = 210 - margin * 2;
    const contentH = 297 - margin * 2;
    const pxPerMm = canvas.width / contentW;
    const pagePx = Math.floor(contentH * pxPerMm);
    for (let y = 0, page = 0; y < canvas.height; y += pagePx, page++) {
      const sliceH = Math.min(pagePx, canvas.height - y);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if (page > 0) pdf.addPage();
      pdf.addImage(
        slice.toDataURL("image/jpeg", 0.92),
        "JPEG",
        margin,
        margin,
        contentW,
        sliceH / pxPerMm,
      );
    }
    pdf.setProperties({ title: "Clinic RX prescription", creator: "Clinic RX" });
    return {
      url: URL.createObjectURL(pdf.output("blob")),
      preview: canvas.toDataURL("image/png"),
      name: `ClinicRX-Rx-${new Date().toISOString().slice(0, 10)}.pdf`,
    };
  } finally {
    host.remove();
  }
}

function downloadPdf(result: PdfResult) {
  const a = document.createElement("a");
  a.href = result.url;
  a.download = result.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Preview / download a real PDF file, plus the browser print dialog. Uses the sheet in the same panel.
export function SavePdfButton({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const anchor = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [pdf, setPdf] = useState<PdfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf.url);
    },
    [pdf],
  );

  async function ensure(): Promise<PdfResult | null> {
    if (pdf) return pdf;
    const sheet = anchor.current
      ?.closest("section")
      ?.querySelector<HTMLElement>(".cx-sheet");
    if (!sheet) return null;
    setBusy(true);
    setFailed(false);
    try {
      const result = await buildPdf(sheet);
      setPdf(result);
      return result;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (await ensure()) dialog.current?.showModal();
  }
  async function save() {
    const result = await ensure();
    if (result) downloadPdf(result);
  }
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
    <>
      <span ref={anchor} hidden />
      <button
        type="button"
        className={`cx-btn ${className}`}
        disabled={busy}
        onClick={preview}
      >
        {busy ? t("rx_pdf_generating") : t("rx_pdf_preview")}
      </button>
      <button
        type="button"
        className="cx-btn is-secondary"
        disabled={busy}
        onClick={save}
      >
        {t("rx_pdf_download")}
      </button>
      <button type="button" className="cx-btn is-secondary" onClick={print}>
        {t("rx_print")}
      </button>
      {failed && (
        <span className="cx-hint" role="alert">
          {t("rx_pdf_failed")}
        </span>
      )}
      <dialog
        ref={dialog}
        className="cx-pdf-dialog cx-noprint"
        aria-label={t("rx_pdf_preview")}
      >
        {pdf && (
          <>
            <div className="cx-pdf-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pdf.preview} alt={t("rx_sheet_title")} />
            </div>
            <div className="cx-pdf-actions">
              <button
                type="button"
                className="cx-btn"
                onClick={() => downloadPdf(pdf)}
              >
                {t("rx_pdf_download")}
              </button>
              <a
                className="cx-btn is-secondary"
                href={pdf.url}
                target="_blank"
                rel="noopener"
              >
                {t("rx_pdf_open")}
              </a>
              <button
                type="button"
                className="cx-btn is-secondary"
                onClick={() => dialog.current?.close()}
              >
                {t("rx_pdf_close")}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
