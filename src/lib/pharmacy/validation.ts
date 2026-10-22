import { object, UUID, type DraftItem } from "../drafts/validation";
export type PharmacyInput =
  | { operation: "lookup"; reference: string }
  | {
      operation: "dispense";
      lookupId: string;
      prescriptionId: string;
      requestId: string;
      identityConfirmed: true;
      fullConfirmed: true;
    };
export type PharmacyResult =
  | {
      state: "eligible";
      prescription_id: string;
      lookup_id: string;
      confirmation_expires_at: string;
      issued_at: string;
      expires_at: string;
      database_time: string;
      patient: { name: string; patient_identifier: string | null };
      items: DraftItem[];
    }
  | { state: "cancelled" | "expired"; database_time: string }
  | { state: "dispensed"; dispensed_at: string; replayed?: boolean };
export function validatePharmacy(value: unknown): PharmacyInput | null {
  if (!object(value)) return null;
  const keys =
    value.operation === "lookup"
      ? ["operation", "reference"]
      : value.operation === "dispense"
        ? [
            "operation",
            "lookupId",
            "prescriptionId",
            "requestId",
            "identityConfirmed",
            "fullConfirmed",
          ]
        : [];
  if (
    !keys.length ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    return null;
  if (value.operation === "lookup")
    return typeof value.reference === "string" && value.reference.length <= 80
      ? (value as PharmacyInput)
      : null;
  if (
    ![value.lookupId, value.prescriptionId, value.requestId].every(
      (v) => typeof v === "string" && UUID.test(v),
    ) ||
    value.identityConfirmed !== true ||
    value.fullConfirmed !== true
  )
    return null;
  return value as PharmacyInput;
}
export function pharmacyError(code?: string) {
  if (code === "42501")
    return "الوصول مرفوض. تحقق من الجلسة وحساب الصيدلي والصيدلية.";
  if (code === "PT404")
    return "تعذّر العثور على وصفة بهذا الرمز. راجع الرمز مع المريض.";
  if (code === "PT429")
    return "بلغت الحد المسموح للمحاولات. انتظر قبل إعادة المحاولة؛ تكرار الطلب لن يرفع الحد.";
  if (code === "PT409")
    return "تغيّرت الأهلية أو انتهى التأكيد. لم يُسجل صرف جديد. أعد البحث والمراجعة؛ إعادة المحاولة هنا تحفظ الطلب الأصلي.";
  if (code === "22023")
    return "الطلب غير صالح. أكّد الهوية وصرف جميع الأدوية دون تعديلها.";
  if (code === "PGRST202" || code === "PT503")
    return "خدمة الصيدلية غير متاحة حاليًا؛ يلزم تفعيل قاعدة البيانات. لم يتم تأكيد صرف.";
  return "تعذّر تأكيد النتيجة. أعد محاولة الطلب نفسه أو أعد البحث عن الرمز للتحقق؛ لا تفترض أن الصرف فشل.";
}
