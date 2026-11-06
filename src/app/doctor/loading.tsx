"use client";
import { useI18n } from "@/lib/i18n/client";
export default function Loading() {
  const { t } = useI18n();
  return (
    <div className="panel form-section" role="status">
      <p>{t("جارٍ تحميل سجلات الطبيب…")}</p>
    </div>
  );
}
