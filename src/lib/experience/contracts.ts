import {
  object,
  UUID,
  validateDraft,
  type DraftItem,
} from "../drafts/validation";

export type FormPayload = {
  name: string;
  identifier: string;
  notes: string;
  items: DraftItem[];
};
export type PrescriberContext = {
  state: "verified" | "unauthorized";
  doctor_id?: string;
  doctor_name?: string;
  clinic_id?: string;
  clinic_name?: string;
  entitled?: boolean;
};
export type Receipt = {
  id: string;
  issued_at?: string;
  expires_at?: string;
  doctor_name?: string;
  clinic_name?: string;
  prescription_id?: string;
  code?: string;
  state?: string;
  dispensed_at?: string;
  replayed?: boolean;
};
export type Selection = {
  prescription_id: string;
  lookup_id: string;
  patient: { name: string };
  items: DraftItem[];
  issued_at: string;
  expires_at: string;
};
// Israel-only release: the issuing country and document type are fixed server-side (IL / national ID).
// Exactly nine digits; Arabic-Indic/Persian digits map to ASCII; leading zeros kept as a string.
// No checksum: no authoritative Israeli source was verified for one (see docs/REDESIGN_HANDOFF.md).
export function normalizeIsraeliId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value
    .replace(/^ +| +$/g, "")
    .replace(/[٠-٩۰-۹]/g, (c) =>
      String(c.charCodeAt(0) - (c <= "٩" ? 1632 : 1776)),
    );
  return /^[0-9]{9}$/.test(id) ? id : null;
}
// Patient-held access code: six digits (Arabic-Indic/Persian digits converted), or the older long RX1 reference.
export function normalizeAccessCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const code = value
    .replace(/[ -]/g, "")
    .toUpperCase()
    .replace(/[٠-٩۰-۹]/g, (c) =>
      String(c.charCodeAt(0) - (c <= "٩" ? 1632 : 1776)),
    );
  return /^[0-9]{6}$/.test(code) ||
    /^RX1K1[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{32}$/.test(code)
    ? code
    : null;
}
export function lookupInput(value: unknown) {
  if (!object(value)) return null;
  const identifier = normalizeIsraeliId(value.identifier);
  const code = normalizeAccessCode(value.code);
  return identifier && code ? { identifier, code } : null;
}
export function formPayload(value: unknown): FormPayload | null {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !==
      "identifier,items,name,notes"
  )
    return null;
  const identifier = normalizeIsraeliId(value.identifier);
  const draft = validateDraft({
    requestId: "00000000-0000-4000-8000-000000000001",
    prescriptionId: null,
    expectedUpdatedAt: null,
    patient: { name: value.name, patient_identifier: "" },
    doctorNotes: value.notes,
    items: value.items,
  });
  if (!identifier || !draft.data || !("name" in draft.data.patient)) return null;
  return {
    identifier,
    name: draft.data.patient.name,
    notes: draft.data.doctorNotes,
    items: draft.data.items,
  };
}
export function validRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export const messages = {
  unauthorized: "يلزم حساب معتمد وجلسة نشطة. أعد التحقق من هويتك.",
  inactive: "الإصدار غير متاح: يلزم تفعيل اشتراك العيادة.",
  validation: "rx_msg_validation",
  notFound: "rx_msg_not_found",
  throttled: "طلبات كثيرة. انتظر قليلًا قبل المحاولة مجددًا.",
  conflict: "تغيّرت الوصفة أو الطلب. راجع الحالة قبل المتابعة.",
  unavailable: "الخدمة غير متاحة حاليًا. لم يُؤكَّد تنفيذ العملية.",
  uncertain:
    "لم نتأكد من النتيجة. استرجع الإيصال أو أعد نفس الطلب؛ لا تبدأ طلبًا جديدًا.",
};
