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
  return (
    <article className="prescription-document panel">
      <div className="document-header">
        <Brand compact />
        <div className="document-label">
          <span className="eyebrow">
            {review ? "مراجعة محلية" : "وصفة توضيحية"}
          </span>
          <strong>نموذج وصفة طبية</strong>
          <span>للعرض والاختبار فقط</span>
        </div>
      </div>
      <div className="document-warning">
        <BadgeInfo size={20} />
        <strong>
          نموذج تجريبي — ليس وصفة طبية قانونية ولا يُستخدم للعلاج أو الصرف.
        </strong>
      </div>
      <section className="document-patient" aria-label="معلومات المريض والوصفة">
        <div>
          <span>
            <UserRound size={15} />
            اسم المريض التجريبي
          </span>
          <strong>{prescription.patientName}</strong>
        </div>
        <div>
          <span>معرّف المريض التجريبي</span>
          <strong dir="auto">{prescription.patientIdentifier}</strong>
        </div>
        <div>
          <span>
            <CalendarDays size={15} />
            تاريخ الوصفة
          </span>
          <strong>{formatDate(prescription.date)}</strong>
        </div>
        <div>
          <span>حالة الوصفة</span>
          <StatusBadge status={prescription.status} />
        </div>
      </section>
      <section className="document-medications">
        <h2>
          <FileText size={19} />
          الأدوية الموصوفة{" "}
          <span className="count-badge">
            {formatNumber(prescription.medications.length)}
          </span>
        </h2>
        {prescription.medications.map((med, i) => (
          <div className="document-medication" key={med.id}>
            <div className="medication-name">
              <span className="medication-number">{formatNumber(i + 1)}</span>
              <h3 dir="auto">{med.name}</h3>
              <span className="med-strength" dir="auto">
                {med.strength}
              </span>
            </div>
            <dl className="medication-properties">
              <div>
                <dt>الجرعة</dt>
                <dd>{med.dose}</dd>
              </div>
              <div>
                <dt>التكرار</dt>
                <dd>{med.frequency}</dd>
              </div>
              <div>
                <dt>المدة</dt>
                <dd>{med.duration}</dd>
              </div>
              <div>
                <dt>الكمية</dt>
                <dd>{med.quantity}</dd>
              </div>
            </dl>
            {med.instructions && (
              <p className="medication-instructions">
                <strong>تعليمات خاصة:</strong> {med.instructions}
              </p>
            )}
          </div>
        ))}
      </section>
      <div className="document-bottom">
        <section>
          <h2>
            <Stethoscope size={18} />
            بيانات الطبيب
          </h2>
          <strong>{demoDoctor.name}</strong>
          <p>{demoDoctor.specialty}</p>
          <div className="approval-placeholder">
            <span className="small-dot dot-amber" />
            الاعتماد الإلكتروني: غير مُنفّذ في المرحلة الأولى
          </div>
        </section>
        <section className="reference-box">
          <span>رمز مرجعي تجريبي • غير آمن</span>
          <code>{prescription.referenceCode}</code>
          <small>ليس رمز تحقق حقيقيًا ولا إثباتًا للاعتماد</small>
        </section>
      </div>
      <footer className="document-footer">
        العيادة Rx • جميع البيانات وهمية • لا يوجد توقيع أو اعتماد إلكتروني •
        غير صالح للاستخدام الطبي
      </footer>
    </article>
  );
}
