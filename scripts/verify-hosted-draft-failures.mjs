// Approved Phase 4A negative checks only: no valid save, owner SQL or account changes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { privateLine } from "./private-input.mjs";
nextEnv.loadEnvConfig(process.cwd());
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  "fckdsiozmufyhbnignet.supabase.co",
);
console.log("Waiting for approved credentials through private JSON stdin.");
const values = JSON.parse(await privateLine());
const makeClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
const doctor = makeClient();
assert.equal((await doctor.auth.signInWithPassword(values.doctor)).error, null);
values.doctor.password = "";
const counts = async () => {
  const results = await Promise.all(
    ["patients", "prescriptions", "prescription_items"].map((table) =>
      doctor.from(table).select("id", { head: true, count: "exact" }),
    ),
  );
  assert.ok(results.every((result) => !result.error));
  return results.map((result) => result.count);
};
try {
  const before = await counts();
  const payload = {
    p_request_id: crypto.randomUUID(),
    p_patient: {
      name: "SYNTHETIC REJECTED ONLY",
      patient_identifier: "TEST ONLY",
    },
    p_items: [
      {
        medication_name: "SYNTHETIC NOT FOR TREATMENT",
        strength: "test",
        dose: "test",
        frequency: "test",
        duration: "test",
        quantity: 0,
        special_instructions: "",
      },
    ],
    p_doctor_notes: "",
  };
  const invalid = await doctor
    .rpc("save_doctor_draft", payload)
    .abortSignal(AbortSignal.timeout(10000));
  assert.equal(invalid.error?.code, "22023");
  const missing = await doctor
    .rpc("save_doctor_draft", {
      ...payload,
      p_request_id: crypto.randomUUID(),
      p_patient: { id: crypto.randomUUID() },
      p_items: [{ ...payload.p_items[0], quantity: 1 }],
    })
    .abortSignal(AbortSignal.timeout(10000));
  assert.equal(missing.error?.code, "42501");
  assert.deepEqual(await counts(), before);
  console.log(
    "PASS: hosted malformed quantity and unavailable-patient RPCs reject; patient/header/item counts unchanged",
  );
  const pharmacist = makeClient();
  assert.equal(
    (await pharmacist.auth.signInWithPassword(values.pharmacist)).error,
    null,
  );
  values.pharmacist.password = "";
  try {
    const ledger = JSON.parse(
      await readFile(".local/phase4a-acceptance-records.json", "utf8"),
    );
    const hidden = await pharmacist
      .from("patients")
      .select("id")
      .eq("id", ledger.patientIds[0]);
    assert.equal(hidden.error, null);
    assert.deepEqual(hidden.data, []);
    const save = await pharmacist
      .rpc("save_doctor_draft", payload)
      .abortSignal(AbortSignal.timeout(10000));
    assert.equal(save.error?.code, "42501");
    const remove = await pharmacist
      .rpc("delete_doctor_draft", {
        p_id: ledger.draftIds[0],
        p_expected_updated_at: new Date().toISOString(),
      })
      .abortSignal(AbortSignal.timeout(10000));
    assert.equal(remove.error?.code, "42501");
    console.log(
      "PASS: real pharmacist cannot read retained synthetic patient or execute either doctor draft mutation",
    );
  } finally {
    await pharmacist.auth.signOut({ scope: "local" });
  }
} finally {
  await doctor.auth.signOut({ scope: "local" });
}
