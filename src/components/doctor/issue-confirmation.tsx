"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Review } from "@/lib/issuance/validation";
import { lifecycleError } from "@/lib/issuance/validation";
export function IssueConfirmation({ review }: { review: Review }) {
  const router = useRouter();
  // Preserve this exact review, version and request ID on EVERY retry, including prop refresh.
  const [request] = useState(() => ({
    operation: "issue",
    requestId: crypto.randomUUID(),
    version: review.payload.updated_at,
    fingerprint: review.fingerprint,
    confirmed: true,
  }));
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  async function issue() {
    if (busy.current || !confirmed) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const res = await fetch(
        `/api/doctor/prescriptions/${review.payload.id}/lifecycle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(12_000),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.message);
        return;
      }
      // Discard the code from this response. The detail page can recover the SAME code.
      router.replace(`/doctor/prescriptions/${review.payload.id}`);
      router.refresh();
    } catch {
      setMessage(lifecycleError());
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="panel form-section no-print">
      <p>
        الإصدار يثبت هذه النسخة المحفوظة نهائيًا. الصلاحية التجريبية سبعة أيام
        من وقت قاعدة البيانات. لم تُعتمد سياسة الاستخدام الطبي أو التوقيع
        القانوني بعد.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        راجعت بيانات المريض والأدوية وترتيبها، وأؤكد إصدار هذه النسخة المحفوظة
        للاختبار الاصطناعي فقط.
      </label>
      <button
        className="button button-primary"
        disabled={!confirmed || pending}
        onClick={issue}
      >
        {pending ? "جارٍ تأكيد الإصدار…" : "تأكيد الإصدار النهائي"}
      </button>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
