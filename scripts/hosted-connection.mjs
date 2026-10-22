// Read-only Phase 3A probe. No account creation, sign-in or data writes.
// Run with Node's --env-file=.env.local --experimental-strip-types flags.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "../src/lib/supabase/config.ts";

const { url, publishableKey } = getSupabasePublicConfig();
assert.equal(new URL(url).hostname, "fckdsiozmufyhbnignet.supabase.co");
const response = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: publishableKey },
  signal: AbortSignal.timeout(20_000),
});
assert.equal(response.status, 200, "Hosted API must accept the configured key");
const settings = await response.json();
assert.equal(settings.disable_signup, true, "Public signup must stay disabled");
console.log("PASS: configured hosted URL/key accepted; public signup disabled");

const client = createClient(url, publishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
for (const table of [
  "pharmacies",
  "app_users",
  "patients",
  "prescriptions",
  "prescription_items",
  "dispensations",
  "audit_events",
]) {
  const { error, data } = await client.from(table).select("id").limit(1);
  assert.equal(
    error?.code,
    "42501",
    `Anonymous access must be denied: ${table}`,
  );
  assert.equal(data, null, "No sensitive rows may be returned");
  console.log(`PASS: anonymous Data API read denied for ${table}`);
}

const privateResponse = await fetch(`${url}/rest/v1/rpc/is_active_doctor`, {
  method: "POST",
  headers: {
    apikey: publishableKey,
    "Content-Type": "application/json",
    "Content-Profile": "rx_private",
  },
  body: "{}",
  signal: AbortSignal.timeout(20_000),
});
const privateResult = await privateResponse.json();
assert.equal(
  privateResult.code,
  "PGRST106",
  "Private schema must not be exposed",
);
console.log("PASS: rx_private is excluded from Data API schemas");

// Phase 4A: invalid null arguments cannot write even if a grant regresses.
for (const [name, args] of [
  [
    "save_doctor_draft",
    {
      p_request_id: null,
      p_patient: null,
      p_items: null,
      p_doctor_notes: null,
    },
  ],
  ["delete_doctor_draft", { p_id: null, p_expected_updated_at: null }],
]) {
  const denied = await client.rpc(name, args);
  assert.equal(
    denied.error?.code,
    "42501",
    `Anonymous draft RPC denied: ${name}`,
  );
  console.log(`PASS: anonymous execution denied for ${name}`);
}
