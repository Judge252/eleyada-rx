import { T } from "@/lib/i18n/client";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { getDoctorDraft } from "@/lib/drafts/data";
import { PrescriptionForm } from "@/components/doctor/prescription-form";
import { BackLink } from "@/components/ui";
export default async function EditDraft({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await requireRole("doctor");
  const { id } = await params;
  const initial = await getDoctorDraft(id);
  if (!initial) notFound();
  if (initial.status !== "draft")
    return (
      <>
        <BackLink />
        <h1>
          <T text="السجل غير قابل للتعديل" />
        </h1>
        <p>
          <T text="السجلات المُصدرة أو النهائية محمية؛ لا يمكن تحويلها إلى مسودة." />
        </p>
      </>
    );
  return (
    <PrescriptionForm
      key={initial.id}
      initial={initial}
      requestId={randomUUID()}
      doctorEmail={account.email}
    />
  );
}
