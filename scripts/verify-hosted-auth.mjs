// Real hosted Auth/API verification. No fixtures or administrative access.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { privateLine } from "./private-input.mjs";
nextEnv.loadEnvConfig(process.cwd());
console.log("Waiting for approved account credentials through private JSON stdin.");
const values = JSON.parse(await privateLine());
const pendingMigration = process.argv.includes("--pending-migration");
for (const role of ["doctor","pharmacist"]) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
  const login = await client.auth.signInWithPassword(values[role]);
  values[role].password = "";
  assert.equal(login.error,null,"Approved hosted account must authenticate");
  try {
    assert.equal(login.data.user.role,"authenticated");
    assert.equal((await client.auth.getUser()).data.user.id,login.data.user.id);
    const member = await client.from("app_users").select("id,role,pharmacy_id,is_active").single();
    assert.equal(member.error,null);
    assert.equal(member.data.role,role);
    assert.equal(member.data.is_active,true);
    assert.equal(member.data.id,login.data.user.id);
    for (const change of [{role:role === "doctor" ? "pharmacist" : "doctor"},{pharmacy_id:crypto.randomUUID()},{is_active:false}]) {
      const denied = await client.from("app_users").update(change).eq("id",login.data.user.id);
      assert.equal(denied.error?.code,"42501");
    }
    const audit = await client.from("audit_events").select("id");
    assert.equal(audit.error?.code,"42501");
    const digest = await client.from("prescriptions").select("reference_digest");
    assert.equal(digest.error?.code,"42501");
    if (role === "pharmacist") {
      for (const table of ["patients","prescriptions","prescription_items","dispensations"]) {
        const hidden = await client.from(table).select("id");
        assert.equal(hidden.error,null);
        assert.deepEqual(hidden.data,[]);
      }
      if (!pendingMigration) {
        const pharmacy = await client.from("pharmacies").select("id,name").single();
        assert.equal(pharmacy.error,null);
        assert.equal(pharmacy.data.name,"Ahmed");
        assert.equal(pharmacy.data.id,member.data.pharmacy_id);
      }
    }
    if (!pendingMigration) {
      const session = await client.rpc("has_active_session");
      assert.equal(session.error,null);
      assert.equal(session.data,true);
    }
    console.log(`PASS: real ${role} login, verified identity, own active membership and least-privilege API access`);
  } finally { await client.auth.signOut({scope:"local"}); }
}
console.log(pendingMigration ? "Policy-dependent application/session tests remain pending approval." : "PASS: hosted Auth/API verification complete");
