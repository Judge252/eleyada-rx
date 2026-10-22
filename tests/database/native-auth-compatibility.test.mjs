import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { startTestDatabase } from "./local-postgres.mjs";
const originalPath =
  "supabase/migrations/20261022010926_prescription_issuance.sql";
const correctionPath =
  "supabase/migrations/20261022024957_doctor_lifecycle_native_auth.sql";
const originalHash =
  "0CA80078C4120FDC056EBCBD7C4F7FC8AF0C0BE819AC9CA72FBECFE6A16049B4";
const scalar = async (c, sql, args = []) =>
  Object.values((await c.query(sql, args)).rows[0])[0];
test("frozen migration hash and four minimal corrected RPC body substitutions are exact", async () => {
  const original = await readFile(originalPath, "utf8"),
    corrected = await readFile(correctionPath, "utf8");
  assert.equal(
    createHash("sha256").update(original).digest("hex").toUpperCase(),
    originalHash,
  );
  for (const name of [
    "issue_doctor_prescription",
    "get_doctor_lifecycle",
    "reveal_doctor_reference",
    "cancel_doctor_prescription",
  ]) {
    const start = original.indexOf(`create function public.${name}(`),
      end = original.indexOf("\n$$;", start) + 4;
    let expected = original
      .slice(start, end)
      .replace("create function", "create or replace function")
      .replaceAll("auth.uid()", "rx_private.lifecycle_actor_id()");
    if (name === "issue_doctor_prescription")
      expected = expected.replaceAll(
        "'status',p.status,",
        "'status',case when p.status='issued' and p.expires_at<=clock_timestamp() then 'expired' else p.status::text end,",
      );
    assert.ok(corrected.includes(expected), `Unexpected ${name} correction`);
  }
});
test("host-matching auth ownership reproduces original denial; additive correction works without auth grants or privilege broadening", async () => {
  const db = await startTestDatabase({ applyMigrations: false });
  const c = db.owner,
    doctor = randomUUID(),
    session = randomUUID();
  try {
    await c.query(`create role local_platform_owner nologin;
      create role local_migration_owner nologin createrole bypassrls;
      grant create on database eyada_phase2_test to local_migration_owner;
      alter schema public owner to local_migration_owner;
      alter schema auth owner to local_platform_owner;
      alter function auth.uid() owner to local_platform_owner;
      alter function auth.jwt() owner to local_platform_owner;
      grant usage on schema auth to local_migration_owner;
      grant usage on schema extensions,vault to local_migration_owner with grant option;
      grant execute on function extensions.digest(text,text) to local_migration_owner with grant option;
      grant select,references on auth.users,auth.sessions to local_migration_owner;
      grant select on vault.decrypted_secrets,vault.secrets to local_migration_owner;
      grant execute on function vault.create_secret(text,text,text,uuid) to local_migration_owner;
      set role local_migration_owner`);
    for (const file of db.migrations.filter(
      (f) => f <= "20261022010926_prescription_issuance.sql",
    ))
      await c.query(await readFile(`supabase/migrations/${file}`, "utf8"));
    assert.equal(
      await scalar(
        c,
        "select has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        c,
        "select has_schema_privilege('rx_lifecycle_executor','auth','USAGE')",
      ),
      false,
    );
    await c.query("reset role");
    await c.query("insert into auth.users(id) values($1)", [doctor]);
    await c.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      session,
      doctor,
    ]);
    await c.query("insert into public.app_users(id,role) values($1,'doctor')", [
      doctor,
    ]);
    await c.query("select vault.create_secret($1,'al_eyada_rx.lookup.v1')", [
      randomBytes(32).toString("hex"),
    ]);
    async function actor() {
      await c.query("set local role authenticated");
      await c.query(
        "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
        [
          JSON.stringify({
            sub: doctor,
            role: "authenticated",
            session_id: session,
          }),
          doctor,
        ],
      );
    }
    const med = {
      medication_name: "SYNTHETIC LOCAL ONLY",
      strength: "test",
      dose: "test",
      frequency: "test",
      duration: "test",
      quantity: 1,
      special_instructions: "",
    };
    async function draft() {
      const d = await scalar(
        c,
        "select public.save_doctor_draft($1,$2,$3,'',null,null)",
        [
          randomUUID(),
          { name: "SYNTHETIC LOCAL SUBJECT", patient_identifier: "" },
          JSON.stringify([med]),
        ],
      );
      const review = await scalar(
        c,
        "select public.get_doctor_issue_review($1)",
        [d.id],
      );
      return { ...d, review, request: randomUUID() };
    }
    const issue = (d) =>
      scalar(c, "select public.issue_doctor_prescription($1,$2,$3,$4)", [
        d.id,
        d.updated_at,
        d.review.fingerprint,
        d.request,
      ]);
    await c.query("begin");
    await actor();
    const d = await draft();
    await c.query("savepoint denied");
    await assert.rejects(
      issue(d),
      (e) => e.code === "42501" && /schema auth/.test(e.message),
    );
    await c.query("rollback to denied");
    await c.query("commit");
    await c.query("set role local_migration_owner");
    await c.query(await readFile(correctionPath, "utf8"));
    await c.query(await readFile("supabase/migrations/20261022173000_pharmacy_full_dispensing.sql", "utf8"));
    assert.equal(await scalar(c,"select has_schema_privilege('rx_pharmacy_executor','auth','USAGE')"),false);
    assert.equal(
      await scalar(c, "select current_user"),
      "local_migration_owner",
    );
    assert.equal(
      await scalar(
        c,
        "select has_schema_privilege('rx_lifecycle_executor','auth','USAGE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        c,
        "select pg_has_role('local_migration_owner','rx_lifecycle_executor','SET')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        c,
        "select pg_has_role('authenticated','rx_lifecycle_executor','MEMBER')",
      ),
      false,
    );
    await c.query("reset role");
    await c.query("begin");
    await actor();
    const issued = await issue(d),
      retry = await issue(d),
      reveal = await scalar(c, "select public.reveal_doctor_reference($1)", [
        d.id,
      ]);
    assert.ok(
      issued.reference === retry.reference &&
        issued.reference === reveal.reference,
      "Code changed",
    );
    // Restore pre-expiry status case: no job updates the stored issued status.
    await c.query("reset role");
    await c.query(
      "alter table public.prescriptions disable trigger guard_prescription",
    );
    await c.query(
      "update public.prescriptions set issued_at=clock_timestamp()-interval '168 hours',expires_at=clock_timestamp() where id=$1",
      [d.id],
    );
    await c.query(
      "alter table public.prescriptions enable trigger guard_prescription",
    );
    await actor();
    const expiredRetry = await issue(d);
    assert.equal(expiredRetry.status, "expired");
    assert.ok(
      expiredRetry.reference === issued.reference,
      "Expired retry changed code",
    );
    const next = await draft();
    await issue(next);
    const version = await scalar(
      c,
      "select updated_at::text from public.prescriptions where id=$1",
      [next.id],
    );
    const cancelled = await scalar(
      c,
      "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
      [next.id, version, randomUUID()],
    );
    assert.equal(cancelled.id, next.id);
    // Exercise the new workflow with platform-owned Auth and no grant-option delegation.
    const rx = await draft();
    const issuedRx = await issue(rx);
    const pharmacist = randomUUID(), pharmacy = randomUUID(), pharmacistSession = randomUUID();
    await c.query("reset role");
    await c.query("insert into auth.users(id) values($1)",[pharmacist]);
    await c.query("insert into auth.sessions(id,user_id) values($1,$2)",[pharmacistSession,pharmacist]);
    await c.query("insert into public.pharmacies(id,name) values($1,'SYNTHETIC NATIVE OWNER')",[pharmacy]);
    await c.query("insert into public.app_users(id,role,pharmacy_id) values($1,'pharmacist',$2)",[pharmacist,pharmacy]);
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:pharmacist,role:"authenticated",session_id:pharmacistSession})]);
    const found = await scalar(c,"select public.lookup_pharmacy_prescription($1)",[issuedRx.reference]);
    assert.equal(found.state,"eligible");
    const full = await scalar(c,"select public.dispense_pharmacy_prescription($1,$2,$3,true,true)",[found.lookup_id,rx.id,randomUUID()]);
    assert.equal(full.state,"dispensed");
    await c.query("rollback");
  } finally {
    await c.query("rollback");
    await c.query("reset role");
    await db.stop();
  }
});
