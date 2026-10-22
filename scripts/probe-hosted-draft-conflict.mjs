// One bounded authenticated conflict only; no account/owner operations.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { privateLine } from "./private-input.mjs";
nextEnv.loadEnvConfig(process.cwd());
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  "fckdsiozmufyhbnignet.supabase.co",
);
console.log("Waiting for approved doctor credentials through private stdin.");
const values = JSON.parse(await privateLine());
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  },
);
assert.equal((await client.auth.signInWithPassword(values.doctor)).error, null);
values.doctor.password = "";
const ledger = JSON.parse(
  await readFile(".local/phase4a-acceptance-records.json", "utf8"),
);
const record = () =>
  writeFile(
    ".local/phase4a-acceptance-records.json",
    JSON.stringify(ledger, null, 2),
  );
const payload = {
  p_request_id: crypto.randomUUID(),
  p_patient: { id: ledger.patientIds[0] },
  p_doctor_notes: "SYNTHETIC BOUNDED PROBE ONLY",
  p_items: [1, 2].map((index) => ({
    medication_name: `SYNTHETIC PROBE ONLY ${index}`,
    strength: "test",
    dose: "test",
    frequency: "test",
    duration: "test",
    quantity: index,
    special_instructions: "",
  })),
};
const saved = await client.rpc("save_doctor_draft", payload);
assert.ok(
  !saved.error && saved.data.id,
  "Synthetic probe creation failed; inspect safely",
);
const id = saved.data.id;
ledger.draftIds.push(id);
await record();
const started = performance.now();
const conflict = await client
  .rpc("save_doctor_draft", {
    ...payload,
    p_doctor_notes: "SYNTHETIC DIFFERENT RETRY ONLY",
  })
  .abortSignal(AbortSignal.timeout(8000));
const elapsedMs = Math.round(performance.now() - started);
if (conflict.status !== 409 || conflict.error?.code !== "PT409") {
  await writeFile(
    ".local/phase4a-correction-probe-result.json",
    JSON.stringify({
      passed: false,
      draftId: id,
      status: conflict.status,
      code: conflict.error?.code,
      elapsedMs,
    }),
  );
  throw new Error(
    "Bounded conflict did not return PT409/HTTP409; STOP further conflict attempts and inspect active calls. Probe draft retained for scoped cleanup.",
  );
}
const deleted = await client.rpc("delete_doctor_draft", {
  p_id: id,
  p_expected_updated_at: saved.data.updated_at,
});
assert.ok(
  !deleted.error && deleted.data === true,
  "Probe cleanup needs inspection",
);
ledger.deletedDraftIds.push(id);
await record();
await writeFile(
  ".local/phase4a-correction-probe-result.json",
  JSON.stringify(
    {
      passed: true,
      draftId: id,
      status: conflict.status,
      code: conflict.error.code,
      elapsedMs,
      deleted: true,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    status: 409,
    code: "PT409",
    elapsedMs,
    probeDraftDeleted: true,
  }),
);
await client.auth.signOut({ scope: "local" });
