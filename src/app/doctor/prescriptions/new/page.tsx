import { PrescriptionForm } from "@/components/doctor/prescription-form";
import { requireRole } from "@/lib/auth/server";
import { randomUUID } from "node:crypto";

export default async function NewPrescription() {
  const account = await requireRole("doctor");
  return (
    <PrescriptionForm requestId={randomUUID()} doctorEmail={account.email} />
  );
}
