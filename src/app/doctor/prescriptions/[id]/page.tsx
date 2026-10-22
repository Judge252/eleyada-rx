import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { getDoctorDraft } from "@/lib/drafts/data";
import { BackLink, PageHeading } from "@/components/ui";
import { DraftDocument } from "@/components/doctor/draft-document";
import { DeleteDraft } from "@/components/doctor/delete-draft";
import { PrintButton } from "@/components/doctor/print-button";
import { IssuedDocument } from "@/components/doctor/issued-document";
import { getLifecycle } from "@/lib/issuance/data";

export default async function PrescriptionDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const account = await requireRole("doctor");
  const { id } = await params;
  const record = await getDoctorDraft(id);
  if (!record) notFound();
  const lifecycle = record.status === "draft" ? null : await getLifecycle(id);
  const { saved } = await searchParams;
  return (
    <>
      <BackLink />
      <div className="no-print">
        <PageHeading
          eyebrow="سجلات الطبيب"
          title={
            record.status === "draft" ? "المسودة المحفوظة" : "سجل للقراءة فقط"
          }
          description={
            record.status === "draft"
              ? "لم تُصدر — لا يوجد رمز صرف أو اعتماد."
              : "المحتوى الصادر محفوظ للقراءة فقط. استرجاع الرمز والطباعة والإلغاء عبر التحقق المصرّح به."
          }
          action={record.status === "draft" ? <PrintButton /> : undefined}
        />
        {saved === "1" && (
          <p className="review-notice" role="status">
            المسودة محفوظة. البيانات أدناه هي النسخة الحالية من قاعدة البيانات؛
            لم تُصدر.
          </p>
        )}
        {record.status === "draft" && (
          <div className="draft-actions">
            <Link
              className="button button-primary"
              href={`/doctor/prescriptions/${id}/issue`}
            >
              مراجعة المسودة للإصدار
            </Link>
            <Link
              className="button button-secondary"
              href={`/doctor/prescriptions/${id}/edit`}
            >
              تعديل المسودة
            </Link>
            <DeleteDraft key={id} id={id} version={record.updated_at} />
          </div>
        )}
      </div>
      {record.status === "draft" ? (
        <DraftDocument
          patient={record.patient}
          items={record.items}
          notes={record.doctor_notes ?? ""}
          doctorEmail={account.email}
          savedAt={record.updated_at}
        />
      ) : (
        <IssuedDocument
          key={id}
          record={record}
          initial={lifecycle}
          doctorEmail={account.email}
        />
      )}
    </>
  );
}
