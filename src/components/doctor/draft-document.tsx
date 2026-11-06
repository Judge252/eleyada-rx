"use client";
import { useI18n } from "@/lib/i18n/client";
import { Brand } from "@/components/ui";
import type { DraftItem, PatientOption } from "@/lib/drafts/validation";

export function DraftDocument({
  patient,
  items,
  notes,
  doctorEmail,
  savedAt,
}: {
  patient: PatientOption;
  items: DraftItem[];
  notes: string;
  doctorEmail: string;
  savedAt: string | null;
}) {
  const { t, locale } = useI18n();
  return (
    <article className="prescription-document panel">
      <div className="document-header">
        <Brand compact />
        <div className="document-label">
          <strong>{t("مسودة غير مُصدرة")}</strong>
          <span>{savedAt ? t("مسودة محفوظة") : t("معاينة غير محفوظة")}</span>
        </div>
      </div>
      <div className="document-warning">
        <strong>
          {t(
            "مسودة غير صالحة للصرف أو العلاج — لم تُصدر ولم تُعتمد. لا يوجد رمز صرف.",
          )}{" "}
        </strong>
      </div>
      <section className="document-patient" aria-label={t("بيانات المسودة")}>
        <div>
          <span>{t("اسم المريض")}</span>
          <strong>{patient.name}</strong>
        </div>
        <div>
          <span>{t("معرّف المريض")}</span>
          <strong>{patient.patient_identifier || t("غير مسجل")}</strong>
        </div>
        <div>
          <span>{savedAt ? t("آخر حفظ") : t("حالة الحفظ")}</span>
          <strong>
            {savedAt
              ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Africa/Cairo",
                }).format(new Date(savedAt))
              : t("لم تُحفظ")}
          </strong>
        </div>
        <div>
          <span>{t("الحالة")}</span>
          <strong>{t("مسودة — غير مُصدرة")}</strong>
        </div>
      </section>
      <section className="document-medications">
        <h2>
          {t("الأدوية (")}
          {items.length})
        </h2>
        {items.map((item, index) => (
          <div className="document-medication" key={index}>
            <div className="medication-name">
              <span className="medication-number">{index + 1}</span>
              <h3>{item.medication_name}</h3>
              <span className="med-strength">{item.strength}</span>
            </div>
            <dl className="medication-properties">
              {[
                [t("الجرعة"), item.dose],
                [t("التكرار"), item.frequency],
                [t("المدة"), item.duration],
                [t("الكمية"), item.quantity],
              ].map(([label, value]) => (
                <div key={t(label)}>
                  <dt>{t(label)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {item.special_instructions && (
              <p className="medication-instructions">
                {t("تعليمات خاصة:")} {item.special_instructions}
              </p>
            )}
          </div>
        ))}
      </section>
      {notes && (
        <section className="document-patient">
          <div>
            <span>{t("ملاحظات الطبيب")}</span>
            <p>{notes}</p>
          </div>
        </section>
      )}
      <div className="document-bottom">
        <section>
          <h2>{t("حساب الطبيب")}</h2>
          <p dir="ltr">{doctorEmail}</p>
        </section>
        <section>
          <strong>{t("لم تُصدر — غير صالحة للصرف")}</strong>
          <p>{t("حفظ المسودة لا يمثل موافقة أو توقيعًا إلكترونيًا.")}</p>
        </section>
      </div>
      <footer className="document-footer">
        {t(
          "العيادة Rx • مسودة فقط • لا يوجد رمز مرجعي للصرف • غير صالحة للاستخدام الطبي",
        )}{" "}
      </footer>
    </article>
  );
}
