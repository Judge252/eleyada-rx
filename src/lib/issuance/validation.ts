import {
  object,
  UUID,
  type DraftItem,
  type PatientOption,
} from "../drafts/validation";

export const cancellationReasons = {
  entered_in_error: "أُدخلت بالخطأ",
  duplicate_prescription: "وصفة مكررة",
  treatment_changed: "تغيّر العلاج",
  other_administrative_reason: "سبب إداري آخر",
} as const;
export type CancellationReason = keyof typeof cancellationReasons;
export type Review = {
  fingerprint: string;
  payload: {
    id: string;
    updated_at: string;
    doctor_notes: string | null;
    patient: PatientOption;
    items: DraftItem[];
  };
};
export type Lifecycle = {
  status: "draft" | "issued" | "expired" | "cancelled";
  issued_at: string | null;
  expires_at: string | null;
  database_time: string;
  dispensed: boolean;
  cancellation: { reason: CancellationReason; cancelled_at: string } | null;
};
export type IssuanceInput =
  | {
      operation: "issue";
      requestId: string;
      version: string;
      fingerprint: string;
      confirmed: true;
    }
  | { operation: "reveal" }
  | {
      operation: "cancel";
      requestId: string;
      version: string;
      reason: CancellationReason;
      confirmed: true;
    };
// Next's internal route URL can use localhost after proxying. Compare the browser
// Origin with the original HTTP Host and protocol, never that internal hostname.
export function sameOrigin(
  origin: string | null,
  host: string | null,
  protocol: string,
) {
  if (
    !origin ||
    !host ||
    !["http", "https"].includes(protocol) ||
    !/^[a-z0-9.:[\]-]+$/i.test(host)
  )
    return false;
  try {
    return new URL(`${protocol}://${host}`).origin === origin;
  } catch {
    return false;
  }
}
const timestamp = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
export function validateLifecycle(value: unknown): IssuanceInput | null {
  if (!object(value)) return null;
  const keys =
    value.operation === "reveal"
      ? ["operation"]
      : value.operation === "issue"
        ? ["operation", "requestId", "version", "fingerprint", "confirmed"]
        : value.operation === "cancel"
          ? ["operation", "requestId", "version", "reason", "confirmed"]
          : [];
  if (
    !keys.length ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    return null;
  if (value.operation === "reveal") return { operation: "reveal" };
  if (
    typeof value.requestId !== "string" ||
    !UUID.test(value.requestId) ||
    !timestamp(value.version) ||
    value.confirmed !== true
  )
    return null;
  if (
    value.operation === "issue" &&
    (typeof value.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.fingerprint))
  )
    return null;
  if (
    value.operation === "cancel" &&
    (typeof value.reason !== "string" ||
      !Object.hasOwn(cancellationReasons, value.reason))
  )
    return null;
  return value as IssuanceInput;
}
export function lifecycleError(code?: string) {
  if (code === "PT409")
    return "تغيّرت الوصفة أو نتيجة المراجعة. لم تُستبدل البيانات. أعد فتح السجل وراجعه؛ إعادة المحاولة هنا تحتفظ بالنسخة الأصلية.";
  if (code === "42501")
    return "الوصول مرفوض. تحقق من الجلسة وصلاحية حساب الطبيب.";
  if (code === "22023" || code?.startsWith("23"))
    return "الطلب غير صالح أو الوصفة غير مكتملة. لم تُنفّذ العملية.";
  if (code === "PGRST202" || code === "PT503")
    return "الإصدار أو استرجاع الرمز غير متاح: يلزم تفعيل قاعدة البيانات ومفاتيح Vault المعتمدة. لا تستخدم هذه النسخة للعلاج.";
  return "تعذّر تأكيد النتيجة. أعد المحاولة بنفس الطلب أو افتح السجل لاسترجاع النتيجة؛ لا تُنشئ إصدارًا بديلًا بسبب انقطاع الاتصال.";
}
