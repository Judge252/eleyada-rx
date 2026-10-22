"use client";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/ui";
import type { DraftRecord } from "@/lib/drafts/validation";
import {
  cancellationReasons,
  lifecycleError,
  type Lifecycle,
  type CancellationReason,
} from "@/lib/issuance/validation";

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ar-EG", {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: "Africa/Cairo",
      }).format(new Date(value))
    : "غير متاح";
const labels = {
  draft: "مسودة غير مُصدرة",
  issued: "مُصدرة — نسخة اختبار",
  cancelled: "ملغاة — غير صالحة للصرف",
  expired: "منتهية الصلاحية — غير صالحة للصرف",
};
export function IssuedDocument({
  record,
  initial,
  doctorEmail,
}: {
  record: DraftRecord;
  initial: Lifecycle | null;
  doctorEmail: string;
}) {
  const router = useRouter();
  const [lifecycle, setLifecycle] = useState(initial);
  const [reference, setReference] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [reason, setReason] = useState<CancellationReason>("entered_in_error");
  const [confirmed, setConfirmed] = useState(false);
  const cancelRequest = useRef<object | null>(null);
  const [cancelAttempted, setCancelAttempted] = useState(false);
  const [originalVersion] = useState(record.updated_at);
  useEffect(() => {
    const clear = () => setReference(null);
    const hidden = () => {
      if (document.visibilityState === "hidden") clear();
    };
    window.addEventListener("afterprint", clear);
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("afterprint", clear);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    if (!lifecycle?.expires_at || lifecycle.status !== "issued") return;
    const delay = Math.max(
      0,
      Date.parse(lifecycle.expires_at) - Date.parse(lifecycle.database_time),
    );
    const timer = setTimeout(
      () => {
        setLifecycle((old) => (old ? { ...old, status: "expired" } : old));
        setReference(null);
      },
      Math.min(delay, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [lifecycle]);
  async function perform(operation: "reveal" | "cancel", print = false) {
    if (busy.current) return;
    if (operation === "cancel" && !confirmed) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    setReference(null);
    if (operation === "cancel" && !cancelRequest.current) {
      cancelRequest.current = {
        operation,
        requestId: crypto.randomUUID(),
        version: originalVersion,
        reason,
        confirmed: true,
      };
      setCancelAttempted(true);
    }
    try {
      const res = await fetch(
        `/api/doctor/prescriptions/${record.id}/lifecycle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(
            operation === "cancel" ? cancelRequest.current : { operation },
          ),
          signal: AbortSignal.timeout(12_000),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.message);
        return;
      }
      if (operation === "cancel") {
        setLifecycle((old) =>
          old
            ? {
                ...old,
                status: "cancelled",
                cancellation: {
                  reason,
                  cancelled_at: body.result.cancelled_at,
                },
              }
            : old,
        );
        setMessage("أُلغيت الوصفة. احتُفظ بتاريخها وسبب الإلغاء.");
        router.refresh();
      } else {
        flushSync(() => {
          setReference(body.result.reference);
          setLifecycle(body.result);
        });
        if (print) window.print();
      }
    } catch {
      setMessage(lifecycleError());
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const eligible = lifecycle?.status === "issued" && !lifecycle.dispensed;
  return (
    <>
      <section className="panel form-section no-print">
        {!lifecycle && (
          <p role="alert">
            تعذّر التحقق من دورة الوصفة. يلزم تفعيل قاعدة البيانات أو استعادة
            الاتصال قبل الطباعة أو الإلغاء.
          </p>
        )}
        <p>
          الرمز يظهر مؤقتًا فقط. الطباعة تسترجع الرمز نفسه وتتحقق من الحالة
          مجددًا. حالة الصرف مستقلة عن حالة الإصدار؛ لا تستخدم نسخة الاختبار
          للعلاج.
        </p>
        <div className="draft-actions">
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() => perform("reveal")}
          >
            إظهار الرمز المرجعي
          </button>
          <button
            className="button button-primary"
            disabled={pending}
            onClick={() => perform("reveal", true)}
          >
            استرجاع النسخة وطباعتها
          </button>
          {reference && (
            <button
              className="button button-secondary"
              onClick={() => setReference(null)}
            >
              إخفاء الرمز
            </button>
          )}
        </div>
        {eligible && (
          <div className="field">
            <label htmlFor="cancellation-reason">سبب الإلغاء</label>
            <select
              id="cancellation-reason"
              disabled={pending || cancelAttempted}
              value={reason}
              onChange={(e) => setReason(e.target.value as CancellationReason)}
            >
              {Object.entries(cancellationReasons).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                disabled={pending}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              أؤكد إلغاء هذه الوصفة نهائيًا؛ لن تصبح قابلة للصرف.
            </label>
            <button
              className="button button-danger"
              disabled={!confirmed || pending}
              onClick={() => perform("cancel")}
            >
              {pending
                ? "جارٍ التحقق…"
                : cancelAttempted
                  ? "إعادة محاولة طلب الإلغاء نفسه"
                  : "تأكيد إلغاء الوصفة"}
            </button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      <article
        className={`prescription-document panel issued-document ${reference ? "reference-ready" : ""}`}
      >
        {!!record.dispensations?.length && (
          <section className="document-warning">
            <strong>صرف كامل مسجل — نسخة تاريخية</strong>
            <p>
              الصيدلية:{" "}
              {record.dispensations[0].pharmacy?.name ?? "صيدلية شريكة"} • وقت
              الصرف: {date(record.dispensations[0].dispensed_at)}
            </p>
          </section>
        )}
        <div className="document-header">
          <Brand compact />
          <div className="document-label">
            <strong>
              {lifecycle ? labels[lifecycle.status] : "الحالة غير متاحة"}
            </strong>
            <span>نسخة تجريبية اصطناعية</span>
          </div>
        </div>
        <div className="document-warning">
          <strong>
            {lifecycle?.dispensed
              ? "مصروفة بالكامل — نسخة تاريخية"
              : lifecycle
                ? labels[lifecycle.status]
                : "لا تستخدم هذه النسخة"}
          </strong>
          <p>
            اختبار برمجي فقط — غير معتمدة للاستخدام الطبي. الصلاحية التجريبية
            سبعة أيام، وليست سياسة طبية أو قانونية معتمدة. هذا الاعتماد داخل
            التطبيق لا يمثل توقيعًا رقميًا معترفًا به قانونًا.
          </p>
        </div>
        <section className="document-patient">
          <div>
            <span>اسم المريض</span>
            <strong>{record.patient.name}</strong>
          </div>
          <div>
            <span>معرّف المريض</span>
            <strong>{record.patient.patient_identifier || "غير مسجل"}</strong>
          </div>
          <div>
            <span>وقت الإصدار الأصلي</span>
            <strong>{date(lifecycle?.issued_at ?? record.issued_at)}</strong>
          </div>
          <div>
            <span>انتهاء الصلاحية</span>
            <strong>{date(lifecycle?.expires_at ?? record.expires_at)}</strong>
          </div>
        </section>
        <section className="reference-section">
          <h2>الرمز المرجعي</h2>
          {reference ? (
            <strong className="secure-reference" dir="ltr">
              {reference}
            </strong>
          ) : (
            <p>
              مخفي — استرجعه عبر الزر المصرّح به. الطباعة غير متاحة قبل
              الاسترجاع.
            </p>
          )}
          <p>لا ترسل الرمز في الروابط. يحتفظ المريض بالنسخة الورقية بسرية.</p>
        </section>
        <section className="document-medications">
          <h2>الأدوية ({record.items.length})</h2>
          {record.items.map((item, index) => (
            <div className="document-medication" key={index}>
              <div className="medication-name">
                <span className="medication-number">{index + 1}</span>
                <h3>{item.medication_name}</h3>
                <span className="med-strength">{item.strength}</span>
              </div>
              <dl className="medication-properties">
                {[
                  ["الجرعة", item.dose],
                  ["التكرار", item.frequency],
                  ["المدة", item.duration],
                  ["الكمية", item.quantity],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {item.special_instructions && (
                <p className="medication-instructions">
                  تعليمات خاصة: {item.special_instructions}
                </p>
              )}
            </div>
          ))}
        </section>
        {record.doctor_notes && (
          <section className="document-patient">
            <div>
              <span>ملاحظات الطبيب</span>
              <p>{record.doctor_notes}</p>
            </div>
          </section>
        )}
        {lifecycle?.cancellation && (
          <p className="document-warning">
            أُلغيت في {date(lifecycle.cancellation.cancelled_at)} —{" "}
            {cancellationReasons[lifecycle.cancellation.reason]}
          </p>
        )}
        <div className="document-bottom">
          <section>
            <h2>حساب الطبيب</h2>
            <p dir="ltr">{doctorEmail}</p>
          </section>
          <section>
            <strong>لا يوجد توقيع أو ختم قانوني</strong>
            <p>
              الاسم المهني ورقم التسجيل وتفاصيل العيادة المعتمدة لم تُستكمل بعد.
            </p>
          </section>
        </div>
        <footer className="document-footer">
          العيادة Rx • نسخة اختبار فقط • آخر تحقق من قاعدة البيانات:{" "}
          {date(lifecycle?.database_time ?? null)} • حالة الصرف مستقلة عن دورة
          الإصدار
        </footer>
      </article>
      <p className="print-blocked-message">
        النسخة غير جاهزة للطباعة. استرجع الحالة والرمز عبر زر الطباعة أولًا.
      </p>
    </>
  );
}
