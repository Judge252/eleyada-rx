import {
  object,
  UUID,
  validateDraft,
  type DraftItem,
} from "../drafts/validation";

export type FormPayload = {
  name: string;
  country: string;
  type: string;
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
  state?: string;
};
export type Match = {
  id: string;
  doctor_name: string;
  clinic_name: string;
  issued_at: string;
  expires_at: string;
};
export type Selection = {
  prescription_id: string;
  lookup_id: string;
  patient: { name: string };
  items: DraftItem[];
  issued_at: string;
  expires_at: string;
};
export const documentTypes = {
  national_id: "هوية وطنية",
  residence: "إقامة",
  other: "وثيقة هوية أخرى",
};
// ISO 3166-1 alpha-2. No implicit country, checksum, numeric conversion or separator removal.
export const countryCodes =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );
export function normalizedIdentity(value: unknown) {
  if (
    !object(value) ||
    typeof value.country !== "string" ||
    typeof value.type !== "string" ||
    typeof value.identifier !== "string"
  )
    return null;
  const country = value.country.replace(/^ +| +$/g, "").toUpperCase();
  const identifier = value.identifier
    .replace(/^ +| +$/g, "")
    .replace(/[٠-٩۰-۹]/g, (c) =>
      String(c.charCodeAt(0) - (c <= "٩" ? 1632 : 1776)),
    );
  if (
    !countryCodes.includes(country) ||
    !Object.hasOwn(documentTypes, value.type) ||
    !/^[A-Za-z0-9]{1,120}$/.test(identifier)
  )
    return null;
  return { country, type: value.type, identifier };
}
export function formPayload(value: unknown): FormPayload | null {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !==
      "country,identifier,items,name,notes,type"
  )
    return null;
  const identity = normalizedIdentity(value);
  const draft = validateDraft({
    requestId: "00000000-0000-4000-8000-000000000001",
    prescriptionId: null,
    expectedUpdatedAt: null,
    patient: { name: value.name, patient_identifier: "" },
    doctorNotes: value.notes,
    items: value.items,
  });
  if (!identity || !draft.data || !("name" in draft.data.patient)) return null;
  return {
    ...identity,
    name: draft.data.patient.name,
    notes: draft.data.doctorNotes,
    items: draft.data.items,
  };
}
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  Object.keys(v).every((k) => keys.includes(k));
export function accessInput(value: unknown) {
  if (
    !object(value) ||
    !["challenge", "verify", "onboard"].includes(String(value.operation)) ||
    typeof value.email !== "string"
  )
    return null;
  const email = value.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return null;
  if (value.operation === "challenge" && exact(value, ["operation", "email"]))
    return { operation: "challenge" as const, email };
  if (
    value.operation === "verify" &&
    exact(value, ["operation", "email", "token"]) &&
    typeof value.token === "string" &&
    /^\d{6,10}$/.test(value.token)
  )
    return { operation: "verify" as const, email, token: value.token };
  if (
    value.operation === "onboard" &&
    exact(value, ["operation", "email", "name", "clinic"]) &&
    typeof value.name === "string" &&
    typeof value.clinic === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 160 &&
    value.clinic.trim().length > 0 &&
    value.clinic.length <= 160
  )
    return {
      operation: "onboard" as const,
      email,
      name: value.name.trim(),
      clinic: value.clinic.trim(),
    };
  return null;
}
export function validRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export const messages = {
  unauthorized: "يلزم حساب معتمد وجلسة نشطة. أعد التحقق من هويتك.",
  inactive: "الإصدار غير متاح: يلزم تفعيل اشتراك العيادة.",
  validation:
    "راجع البيانات المطلوبة. استخدم بلد إصدار معتمدًا وهوية بلا مسافات داخلية أو فواصل.",
  throttled: "طلبات كثيرة. انتظر قليلًا قبل المحاولة مجددًا.",
  conflict: "تغيّرت الوصفة أو الطلب. راجع الحالة قبل المتابعة.",
  unavailable: "الخدمة غير متاحة حاليًا. لم يُؤكَّد تنفيذ العملية.",
  uncertain:
    "لم نتأكد من النتيجة. استرجع الإيصال أو أعد نفس الطلب؛ لا تبدأ طلبًا جديدًا.",
};
