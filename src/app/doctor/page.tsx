import { LocalizedElement } from "@/lib/i18n/client";
import { T } from "@/lib/i18n/client";
import Link from "next/link";
import { Plus, FileText, Clock3, UserRound, Info } from "lucide-react";
import { PageHeading } from "@/components/ui";
import { PrescriptionTable } from "@/components/doctor/prescription-table";
import { listDoctorDrafts } from "@/lib/drafts/data";

export default async function DoctorDashboard({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; deleted?: string }>;
}) {
  const params = await searchParams;
  const page =
    params.page && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1;
  const data = await listDoctorDrafts(page);
  const stats = [
    {
      label: "إجمالي السجلات",
      value: data.total,
      icon: FileText,
      note: "السجلات المصرح بها في قاعدة البيانات",
    },
    {
      label: "مسودات غير مُصدرة",
      value: data.drafts,
      icon: Clock3,
      note: "غير صالحة للصرف",
    },
    {
      label: "المرضى المسجلون",
      value: data.patients,
      icon: UserRound,
      note: "سجلات العيادة المحفوظة",
    },
    {
      label: "سجلات للقراءة فقط",
      value: data.total - data.drafts,
      icon: Info,
      note: "محتوى صادر محفوظ — لا تعديل أو حذف",
    },
    {
      label: "عمليات صرف كامل",
      value: data.completions,
      icon: Info,
      note: "صرف مسجل مستقل عن حالة الإصدار",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="مساحة الطبيب"
        title="نظرة عامة"
        description="مسودات الطبيب المحفوظة في قاعدة البيانات."
        action={
          <Link
            className="button button-primary"
            href="/doctor/prescriptions/new"
          >
            <Plus size={19} />
            <T text="إنشاء مسودة" />
          </Link>
        }
      />
      {params.deleted === "1" && (
        <p className="review-notice" role="status">
          <T text="حُذفت المسودة وأدويتها. احتُفظ بسجل المريض." />
        </p>
      )}
      <LocalizedElement
        as="section"
        className="stats-grid"
        aria-label="إحصاءات قاعدة البيانات"
      >
        {stats.map(({ label, value, icon: Icon, note }) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>
                <T text={label} />
              </span>
              <div className="stat-icon icon-navy">
                <Icon size={21} />
              </div>
            </div>
            <strong className="stat-value">
              {value.toLocaleString("he-IL")}
            </strong>
            <p>
              <T text={note} />
            </p>
          </article>
        ))}
      </LocalizedElement>
      <PrescriptionTable rows={data.rows} total={data.total} page={page} />
      <section className="review-notice">
        <Info size={21} />
        <p>
          <T text="حفظ المسودة لا يُصدرها. يلزم فتحها ومراجعتها وتأكيد الإصدار بشكل منفصل. الصلاحية التجريبية سبعة أيام؛ غير معتمدة للاستخدام الطبي. صرف الصيدلية المسجل يظهر منفصلًا عن حالة الإصدار." />
        </p>
      </section>
    </>
  );
}
