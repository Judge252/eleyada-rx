import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { validateDraft, editableItem } from "../src/lib/drafts/validation.ts";
const input = () => ({
  requestId: randomUUID(),
  prescriptionId: null,
  expectedUpdatedAt: null,
  patient: { name: "SYNTHETIC", patient_identifier: "" },
  doctorNotes: "",
  items: [
    {
      medication_name: "TEST ONLY",
      strength: "test",
      dose: "test",
      frequency: "test",
      duration: "test",
      quantity: 1,
      special_instructions: "",
    },
  ],
});
test("server validator accepts new and selected patients, optional identifiers, all 30 ordered items", () => {
  const a = input();
  assert.ok(validateDraft(a).data);
  a.patient = { id: randomUUID() };
  a.items = Array.from({ length: 30 }, () => input().items[0]);
  assert.ok(validateDraft(a).data);
});
test("unknown payloads, role spoofing, item count/quantity/length and UUID failures are rejected", () => {
  for (const invalid of [
    null,
    [],
    "",
    {},
    { ...input(), doctor_user_id: randomUUID() },
    { ...input(), prescriptionId: "bad" },
    { ...input(), requestId: "bad" },
  ])
    assert.equal(validateDraft(invalid).data, undefined);
  for (const quantity of [0, -1, 1.2, NaN, Infinity, 1000001, "2", null]) {
    const a = input();
    a.items[0].quantity = quantity;
    assert.equal(validateDraft(a).data, undefined);
  }
  for (const mutate of [
    (a) => (a.items = []),
    (a) => (a.items = Array.from({ length: 31 }, () => input().items[0])),
    (a) => (a.patient.name = "x".repeat(201)),
    (a) => (a.patient.patient_identifier = "x".repeat(121)),
    (a) => (a.doctorNotes = "x".repeat(4001)),
    (a) => (a.items[0].strength = "x".repeat(121)),
    (a) => (a.items[0].medication_name = ""),
    (a) => (a.items[0].status = "issued"),
    (a) => (a.patient = { id: randomUUID(), name: "spoof" }),
  ]) {
    const a = input();
    mutate(a);
    assert.equal(validateDraft(a).data, undefined);
  }
});
test("editing requires a timezone-bearing, precision-preserved expected timestamp", () => {
  const a = input();
  a.prescriptionId = randomUUID();
  assert.equal(validateDraft(a).data, undefined);
  a.expectedUpdatedAt = "2026-10-22T12:34:56.123456+00:00";
  assert.equal(validateDraft(a).data.expectedUpdatedAt, a.expectedUpdatedAt);
  a.expectedUpdatedAt = "2026-10-22";
  assert.equal(validateDraft(a).data, undefined);
});

test("persisted SQL item projection can reopen and pass strict editor validation", () => {
  const a = input();
  a.items = [
    editableItem({ ...a.items[0], sort_order: 0, special_instructions: null }),
  ];
  a.prescriptionId = randomUUID();
  a.expectedUpdatedAt = "2026-10-22T12:34:56.123456+00:00";
  assert.equal(Object.hasOwn(a.items[0], "sort_order"), false);
  assert.ok(validateDraft(a).data);
});
