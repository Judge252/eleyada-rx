"use client";
import { useI18n } from "@/lib/i18n/client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { deleteDraft } from "@/lib/drafts/actions";
export function DeleteDraft({ id, version }: { id: string; version: string }) {
  const { t } = useI18n();
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
      setMessage(t("تعذّر تأكيد الحذف. تحقق من اللوحة قبل المحاولة."));
    }
    locked.current = false;
    setPending(false);
  }
  return (
    <div className="no-print">
      {!confirm ? (
        <Button variant="danger" onClick={() => setConfirm(true)}>
          {t("حذف المسودة")}{" "}
        </Button>
      ) : (
        <div className="review-notice">
          <p>
            {t("حذف هذه المسودة وأدويتها نهائيًا؟ سيظل سجل المريض محفوظًا.")}
          </p>
          <Button variant="danger" disabled={pending} onClick={remove}>
            {pending ? t("جارٍ الحذف…") : t("تأكيد حذف المسودة")}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirm(false)}
          >
            {t("تراجع")}{" "}
          </Button>
        </div>
      )}
      {message && <p role="alert">{t(message)}</p>}
    </div>
  );
}
