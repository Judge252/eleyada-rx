import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/server";
import { UUID, editableItem, type DraftRecord } from "./validation";

// Deliberately explicit: reference_digest is not a client-readable column.
const header =
  "id,patient_id,status,created_at,updated_at,doctor_notes,issued_at,expires_at" as const;
export async function listDoctorDrafts(page: number) {
  const account = await requireRole("doctor");
  const client = await createServerSupabaseClient();
  const [records, total, drafts, patients, completions] = await Promise.all([
    client
      .from("prescriptions")
      .select(
        `${header},patient:patients(id,name,patient_identifier),items:prescription_items(id),dispensations(id,dispensed_at)`,
      )
      .eq("doctor_user_id", account.id)
      .order("created_at", { ascending: false })
      .range((page - 1) * 25, page * 25 - 1),
    client
      .from("prescriptions")
      .select("id", { count: "exact", head: true })
      .eq("doctor_user_id", account.id),
    client
      .from("prescriptions")
      .select("id", { count: "exact", head: true })
      .eq("doctor_user_id", account.id)
      .eq("status", "draft"),
    client.from("patients").select("id", { count: "exact", head: true }),
    client.from("dispensations").select("id", { count: "exact", head: true }),
  ]);
  if (
    records.error ||
    total.error ||
    drafts.error ||
    patients.error ||
    completions.error
  )
    throw new Error("DOCTOR_DATA_UNAVAILABLE");
  const issued = records.data.find((row) => row.status === "issued");
  let databaseTime: number | null = null;
  if (issued) {
    const clock = await client
      .rpc("get_doctor_lifecycle", { p_id: issued.id })
      .abortSignal(AbortSignal.timeout(10_000));
    const value = clock.data as { database_time?: string } | null;
    if (clock.error || !value?.database_time)
      throw new Error("DOCTOR_DATA_UNAVAILABLE");
    databaseTime = Date.parse(value.database_time);
  }
  return {
    rows: records.data.map((row) => ({
      ...row,
      dispensations: row.dispensations ? [row.dispensations] : [],
      status:
        row.status === "issued" &&
        row.expires_at &&
        databaseTime !== null &&
        Date.parse(row.expires_at) <= databaseTime
          ? "expired"
          : row.status,
    })),
    total: total.count ?? 0,
    drafts: drafts.count ?? 0,
    patients: patients.count ?? 0,
    completions: completions.count ?? 0,
  };
}
export async function getDoctorDraft(id: string): Promise<DraftRecord | null> {
  const account = await requireRole("doctor");
  if (!UUID.test(id)) return null;
  const client = await createServerSupabaseClient();
  const { data, error } = await client
    .from("prescriptions")
    .select(
      `${header},patient:patients(id,name,patient_identifier),items:prescription_items(medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order),dispensations(id,dispensed_at,pharmacy:pharmacies(name))`,
    )
    .eq("doctor_user_id", account.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("DOCTOR_DATA_UNAVAILABLE");
  if (!data || !data.patient) return null;
  return {
    ...data,
    dispensations: data.dispensations ? [data.dispensations] : [],
    patient: data.patient,
    items: data.items
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(editableItem),
  };
}
