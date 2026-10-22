"use server";

import { requireRole } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { object, UUID, validateDraft, type PatientOption } from "./validation";

export type DraftResult = {
  id?: string;
  message: string;
  errors?: Record<string, string>;
};
function safeError(code?: string): DraftResult {
  return {
    message:
      code === "PT409" || code === "40001"
        ? "تغيّرت المسودة. أعد تحميل الصفحة قبل المحاولة؛ لم تُستبدل التعديلات الأحدث."
        : code === "42501"
          ? "تعذّر الوصول إلى مسودة قابلة للتعديل. تحقق من الجلسة والحالة."
          : code === "22023" || code?.startsWith("23")
            ? "تعذّر الحفظ بسبب بيانات غير صحيحة. لم يُحفظ أي جزء من الطلب."
            : code === "PGRST202"
              ? "خدمة حفظ المسودات تنتظر تفعيل ترحيل قاعدة البيانات. لم تُحفظ البيانات."
              : "تعذّر إتمام العملية. إن لم تتأكد من نتيجة الحفظ، أعد المحاولة بنفس النموذج أو افتح لوحة الطبيب.",
  };
}

export async function saveDraft(input: unknown): Promise<DraftResult> {
  await requireRole("doctor");
  const { data, errors } = validateDraft(input);
  if (!data) return { message: "صحّح الحقول الموضحة قبل الحفظ.", errors };
  try {
    const client = await createServerSupabaseClient();
    const result = await client
      .rpc("save_doctor_draft", {
        p_request_id: data.requestId,
        p_patient: data.patient,
        p_items: data.items,
        p_doctor_notes: data.doctorNotes,
        p_prescription_id: data.prescriptionId ?? undefined,
        p_expected_updated_at: data.expectedUpdatedAt ?? undefined,
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (result.error) return safeError(result.error.code);
    if (
      !object(result.data) ||
      typeof result.data.id !== "string" ||
      !UUID.test(result.data.id)
    )
      return safeError();
    revalidatePath("/doctor", "layout");
    return {
      id: result.data.id,
      message: "حُفظت المسودة فقط — لم تُصدر وغير صالحة للصرف.",
    };
  } catch {
    return safeError();
  }
}

export async function deleteDraft(
  id: unknown,
  version: unknown,
): Promise<DraftResult> {
  await requireRole("doctor");
  if (
    typeof id !== "string" ||
    !UUID.test(id) ||
    typeof version !== "string" ||
    !Number.isFinite(Date.parse(version))
  )
    return { message: "معرّف أو نسخة المسودة غير صحيحة." };
  try {
    const client = await createServerSupabaseClient();
    const result = await client
      .rpc("delete_doctor_draft", {
        p_id: id,
        p_expected_updated_at: version,
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (result.error || result.data !== true)
      return safeError(result.error?.code);
    revalidatePath("/doctor", "layout");
    return { id, message: "حُذفت المسودة وأدويتها. احتُفظ بسجل المريض." };
  } catch {
    return safeError();
  }
}

export async function findPatients(
  query: unknown,
): Promise<{ patients: PatientOption[]; message: string }> {
  await requireRole("doctor");
  if (typeof query !== "string" || query.length > 120)
    return { patients: [], message: "أدخل بحثًا لا يتجاوز ١٢٠ حرفًا." };
  // Escape LIKE metacharacters; no user text is interpolated into an OR filter.
  const pattern = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
  try {
    const client = await createServerSupabaseClient();
    const result = await client
      .from("patients")
      .select("id,name,patient_identifier")
      .ilike("name", pattern)
      .order("created_at", { ascending: false })
      .limit(20);
    if (result.error)
      return { patients: [], message: "تعذّر تحميل المرضى. أعد المحاولة." };
    return {
      patients: result.data,
      message: result.data.length
        ? "أحدث ٢٠ نتيجة كحد أقصى؛ ضيّق البحث بالاسم."
        : "لا توجد نتائج. يمكنك إنشاء مريض جديد مع حفظ المسودة.",
    };
  } catch {
    return { patients: [], message: "تعذّر تحميل المرضى. أعد المحاولة." };
  }
}
