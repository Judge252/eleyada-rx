"use client";
import { useI18n } from "@/lib/i18n/client";
import {
  FileText,
  BadgeInfo,
  UserRound,
  CalendarDays,
  Stethoscope,
} from "lucide-react";
import { Brand, StatusBadge } from "@/components/ui";
import { demoDoctor, formatDate, formatNumber } from "@/lib/mock-data";
import type { Prescription } from "@/types/prescription";

export function PrescriptionDocument({
  prescription,
  review = false,
}: {
  prescription: Prescription;
  review?: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <article className="prescription-document panel">
      <div className="document-header">
        <Brand compact />
        <div className="document-label">
          <span className="eyebrow">
            {review ? t("مراجعة محلية") : t("وصفة توضيحية")}
          </span>
          <strong>{t("نموذج وصفة طبية")}</strong>
          <span>{t("للعرض والاختبار فقط")}</span>
        </div>
      </div>
      <div className="document-warning">
        <BadgeInfo size={20} />
        <strong>
          {t(
            "نموذج تجريبي — ليس وصفة طبية قانونية ولا يُستخدم للعلاج أو الصرف.",
          )}{" "}
        </strong>
      </div>
      <section
        className="document-patient"
        aria-label={t("معلومات المريض والوصفة")}
      >
        <div>
          <span>
            <UserRound size={15} />
            {t("اسم المريض التجريبي")}{" "}
          </span>
          <strong>{prescription.patientName}</strong>
        </div>
        <div>
          <span>{t("معرّف المريض التجريبي")}</span>
          <strong dir="auto">{prescription.patientIdentifier}</strong>
        </div>
        <div>
          <span>
            <CalendarDays size={15} />
            {t("تاريخ الوصفة")}{" "}
          </span>
          <strong>{formatDate(prescription.date, locale)}</strong>
        </div>
        <div>
          <span>{t("حالة الوصفة")}</span>
          <StatusBadge status={prescription.status} />
        </div>
      </section>
      <section className="document-medications">
        <h2>
          <FileText size={19} />
          {t("الأدوية الموصوفة")}{" "}
          <span className="count-badge">
            {formatNumber(prescription.medications.length, locale)}
          </span>
        </h2>
        {prescription.medications.map((med, i) => (
          <div className="document-medication" key={med.id}>
            <div className="medication-name">
              <span className="medication-number">
                {formatNumber(i + 1, locale)}
              </span>
              <h3 dir="auto">{med.name}</h3>
              <span className="med-strength" dir="auto">
                {med.strength}
              </span>
            </div>
            <dl className="medication-properties">
              <div>
                <dt>{t("الجرعة")}</dt>
                <dd>{med.dose}</dd>
              </div>
              <div>
                <dt>{t("التكرار")}</dt>
                <dd>{med.frequency}</dd>
              </div>
              <div>
                <dt>{t("المدة")}</dt>
                <dd>{med.duration}</dd>
              </div>
              <div>
                <dt>{t("الكمية")}</dt>
                <dd>{med.quantity}</dd>
              </div>
            </dl>
            {med.instructions && (
              <p className="medication-instructions">
                <strong>{t("تعليمات خاصة:")}</strong> {med.instructions}
              </p>
            )}
          </div>
        ))}
      </section>
      <div className="document-bottom">
        <section>
          <h2>
            <Stethoscope size={18} />
            {t("بيانات الطبيب")}{" "}
          </h2>
          <strong>{demoDoctor.name}</strong>
          <p>{demoDoctor.specialty}</p>
          <div className="approval-placeholder">
            <span className="small-dot dot-amber" />
            {t("الاعتماد الإلكتروني: غير مُنفّذ في المرحلة الأولى")}{" "}
          </div>
        </section>
        <section className="reference-box">
          <span>{t("رمز مرجعي تجريبي • غير آمن")}</span>
          <code>{prescription.referenceCode}</code>
          <small>{t("ليس رمز تحقق حقيقيًا ولا إثباتًا للاعتماد")}</small>
        </section>
      </div>
      <footer className="document-footer">
        {t(
          "العيادة Rx • جميع البيانات وهمية • لا يوجد توقيع أو اعتماد إلكتروني • غير صالح للاستخدام الطبي",
        )}{" "}
      </footer>
    </article>
  );
}
