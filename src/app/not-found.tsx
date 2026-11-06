"use client";
import { useI18n } from "@/lib/i18n/client";
import Link from "next/link";
import { Brand } from "@/components/ui";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="standalone-state">
      <Brand />
      <span className="eyebrow">{t("٤٠٤ • الصفحة غير موجودة")}</span>
      <h1>{t("لم نعثر على هذه الصفحة")}</h1>
      <p>
        {t(
          "قد يكون رابط الوصفة غير صحيح. عُد إلى لوحة الطبيب لعرض البيانات التجريبية.",
        )}{" "}
      </p>
      <Link className="button button-primary" href="/doctor">
        {t("العودة إلى لوحة الطبيب")}{" "}
      </Link>
    </main>
  );
}
