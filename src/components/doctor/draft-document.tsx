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
  return (
    <article className="prescription-document panel">
      <div className="document-header">
        <Brand compact />
        <div className="document-label">
          <strong>مسودة غير مُصدرة</strong>
          <span>{savedAt ? "مسودة محفوظة" : "معاينة غير محفوظة"}</span>
        </div>
      </div>
      <div className="document-warning">
        <strong>
          مسودة غير صالحة للصرف أو العلاج — لم تُصدر ولم تُعتمد. لا يوجد رمز
          صرف.
        </strong>
      </div>
      <section className="document-patient" aria-label="بيانات المسودة">
        <div>
          <span>اسم المريض</span>
          <strong>{patient.name}</strong>
        </div>
        <div>
          <span>معرّف المريض</span>
          <strong>{patient.patient_identifier || "غير مسجل"}</strong>
        </div>
        <div>
          <span>{savedAt ? "آخر حفظ" : "حالة الحفظ"}</span>
          <strong>
            {savedAt
              ? new Intl.DateTimeFormat("ar-EG", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Africa/Cairo",
                }).format(new Date(savedAt))
              : "لم تُحفظ"}
          </strong>
        </div>
        <div>
          <span>الحالة</span>
          <strong>مسودة — غير مُصدرة</strong>
        </div>
      </section>
      <section className="document-medications">
        <h2>الأدوية ({items.length})</h2>
        {items.map((item, index) => (
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
      {notes && (
        <section className="document-patient">
          <div>
            <span>ملاحظات الطبيب</span>
            <p>{notes}</p>
          </div>
        </section>
      )}
      <div className="document-bottom">
        <section>
          <h2>حساب الطبيب</h2>
          <p dir="ltr">{doctorEmail}</p>
        </section>
        <section>
          <strong>لم تُصدر — غير صالحة للصرف</strong>
          <p>حفظ المسودة لا يمثل موافقة أو توقيعًا إلكترونيًا.</p>
        </section>
      </div>
      <footer className="document-footer">
        العيادة Rx • مسودة فقط • لا يوجد رمز مرجعي للصرف • غير صالحة للاستخدام
        الطبي
      </footer>
    </article>
  );
}
