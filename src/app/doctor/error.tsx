"use client";
import { useI18n } from "@/lib/i18n/client";
import Link from "next/link";
import { Button } from "@/components/ui";
export default function DoctorError({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <section className="panel form-section" role="alert">
      <h1>{t("تعذّر تحميل سجلات الطبيب")}</h1>
      <p>
        {t("لم تُعرض بيانات بديلة أو وهمية. تحقق من الاتصال ثم أعد المحاولة.")}
      </p>
      <Button onClick={reset}>{t("إعادة المحاولة")}</Button>
      <Link href="/doctor">{t("العودة إلى لوحة الطبيب")}</Link>
    </section>
  );
}
