export type PrescriptionStatus = "ready" | "dispensed" | "draft";

export interface Medication {
  id: string;
  name: string;
  strength: string;
  dose: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
}

export interface Prescription {
  id: string;
  patientName: string;
  patientIdentifier: string;
  date: string;
  status: PrescriptionStatus;
  referenceCode: string;
  medications: Medication[];
}

export type PrescriptionDraft = Pick<
  Prescription,
  "patientName" | "patientIdentifier" | "date" | "medications"
>;
