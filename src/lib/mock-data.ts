import type { Prescription } from "@/types/prescription";

// Entirely fictional fixtures. No clinical advice, real identities or valid prescriptions.
// Medication text deliberately contains no actionable drug/dose combination.
export const demoDoctor = {
  name: "طبيب العيادة التجريبي",
  specialty: "ملف تعريفي توضيحي • لا يمثل طبيبًا حقيقيًا",
};
export const demoDate = "2026-10-19";
export const prescriptions: Prescription[] = [
  {
    id: "rx-001",
    patientName: "مريض تجريبي ٠١",
    patientIdentifier: "DEMO-P001",
    date: demoDate,
    status: "ready",
    referenceCode: "DEMO-RX-1001",
    medications: [
      {
        id: "med-1",
        name: "دواء توضيحي A — غير مخصص للاستخدام",
        strength: "تركيز تجريبي",
        dose: "جرعة توضيحية",
        frequency: "تكرار تجريبي",
        duration: "مدة توضيحية",
        quantity: "1",
        instructions: "بيانات لاختبار العرض فقط؛ لا تُستخدم للعلاج أو الصرف.",
      },
      {
        id: "med-2",
        name: "دواء توضيحي B — غير مخصص للاستخدام",
        strength: "تركيز تجريبي",
        dose: "جرعة توضيحية",
        frequency: "تكرار تجريبي",
        duration: "مدة توضيحية",
        quantity: "2",
        instructions: "مثال على تعليمات الطبيب، ولا يمثل توصية طبية.",
      },
    ],
  },
  {
    id: "rx-002",
    patientName: "مريض تجريبي ٠٢",
    patientIdentifier: "DEMO-P002",
    date: demoDate,
    status: "dispensed",
    referenceCode: "DEMO-RX-1002",
    medications: [
      {
        id: "med-3",
        name: "دواء توضيحي C — غير مخصص للاستخدام",
        strength: "تركيز تجريبي",
        dose: "جرعة توضيحية",
        frequency: "تكرار تجريبي",
        duration: "مدة توضيحية",
        quantity: "1",
        instructions: "بيانات توضيحية فقط.",
      },
    ],
  },
  {
    id: "rx-003",
    patientName: "مريض تجريبي ٠٣",
    patientIdentifier: "DEMO-P003",
    date: demoDate,
    status: "draft",
    referenceCode: "DEMO-RX-1003",
    medications: [
      {
        id: "med-4",
        name: "دواء توضيحي D — غير مخصص للاستخدام",
        strength: "تركيز تجريبي",
        dose: "جرعة توضيحية",
        frequency: "تكرار تجريبي",
        duration: "مدة توضيحية",
        quantity: "3",
        instructions: "مسودة توضيحية غير معتمدة.",
      },
    ],
  },
  {
    id: "rx-004",
    patientName: "مريض تجريبي ٠٤",
    patientIdentifier: "DEMO-P004",
    date: "2026-10-18",
    status: "ready",
    referenceCode: "DEMO-RX-1004",
    medications: [
      {
        id: "med-5",
        name: "دواء توضيحي E — غير مخصص للاستخدام",
        strength: "تركيز تجريبي",
        dose: "جرعة توضيحية",
        frequency: "تكرار تجريبي",
        duration: "مدة توضيحية",
        quantity: "2",
        instructions: "بيانات توضيحية فقط.",
      },
    ],
  },
  {
    id: "rx-005",
    patientName: "مريض تجريبي ٠٥",
    patientIdentifier: "DEMO-P005",
    date: "2026-10-18",
    status: "dispensed",
    referenceCode: "DEMO-RX-1005",
    medications: [
      {
        id: "med-6",
        name: "دواء توضيحي F — غير مخصص للاستخدام",
        strength: "تركيز تجريبي",
        dose: "جرعة توضيحية",
        frequency: "تكرار تجريبي",
        duration: "مدة توضيحية",
        quantity: "1",
        instructions: "بيانات توضيحية فقط.",
      },
    ],
  },
];

export const statusLabels = {
  ready: "جاهزة • تجريبي",
  dispensed: "صُرفت • محاكاة",
  draft: "مسودة تجريبية",
} as const;

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("ar-EG").format(value);
}
