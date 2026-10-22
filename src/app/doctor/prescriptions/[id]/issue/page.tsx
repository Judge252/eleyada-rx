import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { UUID } from "@/lib/drafts/validation";
import { getIssueReview } from "@/lib/issuance/data";
import { BackLink, PageHeading } from "@/components/ui";
import { DraftDocument } from "@/components/doctor/draft-document";
import { IssueConfirmation } from "@/components/doctor/issue-confirmation";
export default async function IssuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await requireRole("doctor");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { review, message } = await getIssueReview(id);
  return (
    <>
      <BackLink href={`/doctor/prescriptions/${id}`}>العودة إلى السجل</BackLink>
      <PageHeading
        eyebrow="نسخة محفوظة فقط"
        title="مراجعة قبل الإصدار"
        description="هذه المراجعة من قاعدة البيانات؛ أي تعديل بعدها يستلزم مراجعة جديدة."
      />
      {review ? (
        <>
          <DraftDocument
            patient={review.payload.patient}
            items={review.payload.items}
            notes={review.payload.doctor_notes ?? ""}
            doctorEmail={account.email}
            savedAt={review.payload.updated_at}
          />
          <IssueConfirmation key={id} review={review} />
        </>
      ) : (
        <p className="review-notice" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
