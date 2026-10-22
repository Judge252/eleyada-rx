"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { deleteDraft } from "@/lib/drafts/actions";
export function DeleteDraft({ id, version }: { id: string; version: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [expectedVersion] = useState(version);
  const locked = useRef(false);
  async function remove() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      const result = await deleteDraft(id, expectedVersion);
      if (result.id) {
        router.replace("/doctor?deleted=1");
        router.refresh();
        return;
      }
      setMessage(result.message);
    } catch {
      setMessage("تعذّر تأكيد الحذف. تحقق من اللوحة قبل المحاولة.");
    }
    locked.current = false;
    setPending(false);
  }
  return (
    <div className="no-print">
      {!confirm ? (
        <Button variant="danger" onClick={() => setConfirm(true)}>
          حذف المسودة
        </Button>
      ) : (
        <div className="review-notice">
          <p>حذف هذه المسودة وأدويتها نهائيًا؟ سيظل سجل المريض محفوظًا.</p>
          <Button variant="danger" disabled={pending} onClick={remove}>
            {pending ? "جارٍ الحذف…" : "تأكيد حذف المسودة"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirm(false)}
          >
            تراجع
          </Button>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
