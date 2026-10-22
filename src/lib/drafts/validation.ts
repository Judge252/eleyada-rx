export const MAX_ITEMS = 30;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const itemFields = {
  medication_name: { label: "اسم الدواء", max: 200 },
  strength: { label: "التركيز", max: 120 },
  dose: { label: "الجرعة", max: 200 },
  frequency: { label: "التكرار", max: 200 },
  duration: { label: "المدة", max: 120 },
  special_instructions: { label: "تعليمات خاصة (اختياري)", max: 2000 },
} as const;
export type DraftItem = Record<keyof typeof itemFields, string> & {
  quantity: number;
};

// Deliberately project SQL rows: editor input must not inherit sort_order/IDs.
export function editableItem(
  row: Omit<DraftItem, "special_instructions"> & {
    special_instructions: string | null;
  },
): DraftItem {
  return {
    medication_name: row.medication_name,
    strength: row.strength,
    dose: row.dose,
    frequency: row.frequency,
    duration: row.duration,
    quantity: row.quantity,
    special_instructions: row.special_instructions ?? "",
  };
}
export type PatientChoice =
  | { id: string }
  | { name: string; patient_identifier: string };
export type DraftInput = {
  requestId: string;
  prescriptionId: string | null;
  expectedUpdatedAt: string | null;
  patient: PatientChoice;
  doctorNotes: string;
  items: DraftItem[];
};
export type PatientOption = {
  id: string;
  name: string;
  patient_identifier: string | null;
};
export type DraftRecord = {
  id: string;
  patient_id: string;
  status: "draft" | "issued" | "cancelled" | "expired";
  created_at: string;
  updated_at: string;
  issued_at: string | null;
  expires_at: string | null;
  doctor_notes: string | null;
  patient: PatientOption;
  items: DraftItem[];
  dispensations?: {
    id: string;
    dispensed_at: string;
    pharmacy: { name: string } | null;
  }[];
};
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const exact = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).every((k) => keys.includes(k));
export function validateDraft(value: unknown): {
  data?: DraftInput;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (
    !object(value) ||
    !exact(value, [
      "requestId",
      "prescriptionId",
      "expectedUpdatedAt",
      "patient",
      "doctorNotes",
      "items",
    ])
  )
    return { errors: { form: "بيانات المسودة غير صحيحة." } };
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId))
    errors.form = "أعد فتح النموذج لإنشاء طلب حفظ صحيح.";
  if (
    value.prescriptionId !== null &&
    (typeof value.prescriptionId !== "string" ||
      !UUID.test(value.prescriptionId))
  )
    errors.form = "معرّف المسودة غير صحيح.";
  const versionValid =
    typeof value.expectedUpdatedAt === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value.expectedUpdatedAt,
    ) &&
    Number.isFinite(Date.parse(value.expectedUpdatedAt));
  if (
    (value.prescriptionId !== null && !versionValid) ||
    (value.prescriptionId === null && value.expectedUpdatedAt !== null)
  )
    errors.form = "أعد تحميل المسودة قبل الحفظ.";
  const patient = value.patient;
  if (!object(patient))
    errors.patient = "اختر مريضًا أو أدخل بيانات مريض جديد.";
  else if ("id" in patient) {
    if (
      !exact(patient, ["id"]) ||
      typeof patient.id !== "string" ||
      !UUID.test(patient.id)
    )
      errors.patient = "اختر مريضًا صحيحًا.";
  } else {
    if (!exact(patient, ["name", "patient_identifier"]))
      errors.patient = "بيانات المريض غير صحيحة.";
    if (
      typeof patient.name !== "string" ||
      !patient.name.trim() ||
      patient.name.trim().length > 200
    )
      errors.patientName = "أدخل اسمًا من ١ إلى ٢٠٠ حرف.";
    if (
      typeof patient.patient_identifier !== "string" ||
      patient.patient_identifier.trim().length > 120
    )
      errors.patientIdentifier = "المعرّف الاختياري لا يتجاوز ١٢٠ حرفًا.";
  }
  if (typeof value.doctorNotes !== "string" || value.doctorNotes.length > 4000)
    errors.doctorNotes = "الملاحظات لا تتجاوز ٤٠٠٠ حرف.";
  if (
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > MAX_ITEMS
  )
    errors.items = "أضف من دواء واحد إلى ٣٠ دواءً.";
  else
    value.items.forEach((item, index) => {
      if (
        !object(item) ||
        !exact(item, [...Object.keys(itemFields), "quantity"])
      ) {
        errors.items = "بيانات الدواء غير صحيحة.";
        return;
      }
      for (const [key, { label, max }] of Object.entries(itemFields)) {
        const text = item[key];
        if (
          typeof text !== "string" ||
          text.length > max ||
          (key !== "special_instructions" && !text.trim())
        )
          errors[`${index}-${key}`] =
            `${label}: أدخل قيمة صحيحة لا تتجاوز ${max} حرفًا.`;
      }
      if (
        typeof item.quantity !== "number" ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 1000000
      )
        errors[`${index}-quantity`] = "الكمية عدد صحيح من ١ إلى ١٠٠٠٠٠٠.";
    });
  if (Object.keys(errors).length) return { errors };
  const data = value as unknown as DraftInput;
  return {
    data: {
      ...data,
      patient:
        "id" in data.patient
          ? data.patient
          : {
              name: data.patient.name.trim(),
              patient_identifier: data.patient.patient_identifier.trim(),
            },
    },
    errors,
  };
}
