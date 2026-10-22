import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { startTestDatabase } from "./local-postgres.mjs";
import {
  capture,
  restore,
  identifyEndpoint,
} from "../../scripts/portable-recovery.mjs";
import {
  createArchive,
  readArchive,
  recordHash,
  MAX_FRAME,
} from "../../scripts/recovery-archive.mjs";
import { migrationFiles } from "../../scripts/recovery-catalog.mjs";
let source, target, folder, archive;
const pass = randomBytes(32).toString("hex"),
  doctor = randomUUID(),
  session = randomUUID(),
  fakeToken = randomBytes(16).toString("hex");
const scalar = async (c, sql, args = []) =>
  Object.values((await c.query(sql, args)).rows[0])[0];
const same = (a, b, message) => assert.ok(a === b, message);
async function fixture(db) {
  await db.owner
    .query(`alter table auth.users add column email text,add column encrypted_password text,add column recovery_token text,add column email_confirmed_at timestamptz,add column phone_confirmed_at timestamptz,add column confirmed_at timestamptz generated always as (least(email_confirmed_at,phone_confirmed_at)) stored;
 create table auth.identities(id uuid primary key,user_id uuid not null references auth.users(id),identity_data jsonb not null);
 create table auth.schema_migrations(version text primary key);insert into auth.schema_migrations values('local-harness-only');
 create table auth.refresh_tokens(id bigserial primary key,user_id uuid,token text);
 create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users(id),secret text);
 create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);`);
  for (const file of await migrationFiles())
    await db.owner.query(
      "insert into supabase_migrations.schema_migrations values($1,$2,$3)",
      [file.name.slice(0, 14), [], file.name.slice(15, -4)],
    );
}
async function context(c, sessionId = session) {
  await c.query("set local role authenticated");
  await c.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
    [
      JSON.stringify({
        sub: doctor,
        role: "authenticated",
        session_id: sessionId,
      }),
      doctor,
    ],
  );
}
async function seed() {
  await source.owner.query(
    "insert into auth.users(id,email,encrypted_password,recovery_token) values($1,$2,$3,$4)",
    [
      doctor,
      "synthetic@example.invalid",
      randomBytes(32).toString("hex"),
      fakeToken,
    ],
  );
  await source.owner.query("insert into auth.identities values($1,$2,$3)", [
    randomUUID(),
    doctor,
    { email: "synthetic@example.invalid" },
  ]);
  await source.owner.query(
    `update auth.users set email_confirmed_at='2026-10-20T03:04:05.123456Z',raw_user_meta_data='{"large":900719925474099312345}'::jsonb where id=$1`,
    [doctor],
  );
  await source.owner.query(
    "insert into auth.sessions(id,user_id) values($1,$2)",
    [session, doctor],
  );
  await source.owner.query(
    "insert into auth.refresh_tokens(user_id,token) values($1,$2)",
    [doctor, randomBytes(32).toString("hex")],
  );
  await source.owner.query(
    "insert into public.app_users(id,role) values($1,'doctor')",
    [doctor],
  );
  await source.owner.query(
    "select vault.create_secret($1,'al_eyada_rx.lookup.v1')",
    [randomBytes(32).toString("hex")],
  );
  for (let n = 0; n < 2; n++) {
    await source.owner.query("begin");
    await context(source.owner);
    const d = await scalar(
      source.owner,
      "select public.save_doctor_draft($1,$2,$3,'',null,null)",
      [
        randomUUID(),
        { name: "SYNTHETIC LOCAL RECOVERY SUBJECT", patient_identifier: "" },
        JSON.stringify(
          [1, 2].map((quantity) => ({
            medication_name: "NON-CLINICAL TEST",
            strength: "test",
            dose: "test",
            frequency: "test",
            duration: "test",
            quantity,
            special_instructions: "",
          })),
        ),
      ],
    );
    const review = await scalar(
      source.owner,
      "select public.get_doctor_issue_review($1)",
      [d.id],
    );
    await scalar(
      source.owner,
      "select public.issue_doctor_prescription($1,$2,$3,$4)",
      [d.id, d.updated_at, review.fingerprint, randomUUID()],
    );
    if (n === 1) {
      const version = await scalar(
        source.owner,
        "select updated_at::text from public.prescriptions where id=$1",
        [d.id],
      );
      await scalar(
        source.owner,
        "select public.cancel_doctor_prescription($1,$2,$3,$4)",
        [d.id, version, randomUUID(), "entered_in_error"],
      );
    }
    await source.owner.query("commit");
  }
}
before(async () => {
  source = await startTestDatabase();
  target = await startTestDatabase();
  await fixture(source);
  await fixture(target);
  await seed();
  folder = await mkdtemp(resolve(".local/recovery-test-"));
  archive = join(folder, "source.rxenc");
});
after(async () => {
  await source?.stop();
  await target?.stop();
  if (folder) {
    assert.equal(dirname(folder), resolve(".local"));
    await rm(folder, { recursive: true, force: true });
  }
});
const options = () => ({
  connection: target.connection,
  target: "local-target",
  path: archive,
  receiptPath: join(folder, `${randomUUID()}.receipt`),
  passphrase: pass,
  adapter: true,
  isolated: true,
});
const reject = async (fn, code) => assert.rejects(fn, (e) => e.code === code);

test("one repeatable-read snapshot captures clinical/Auth/private/history/secrets despite concurrent committed writes", async () => {
  const result = await capture({
    connection: source.connection,
    project: "local-source",
    path: archive,
    passphrase: pass,
    adapter: true,
    onSnapshot: async () => {
      await source.owner.query(
        "insert into public.patients(name) values('SYNTHETIC AFTER SNAPSHOT')",
      );
    },
  });
  assert.equal(result.tables["public.patients"], 2);
  assert.equal(result.secrets.references, 2);
  assert.equal(
    +(await scalar(source.owner, "select count(*) from public.patients")),
    3,
  );
  let m,
    done = false;
  let ciphertext = 0,
    secrets = 0;
  for await (const r of readArchive(archive, pass)) {
    if (r.kind === "manifest") m = r;
    if (r.kind === "secret") secrets++;
    if (r.kind === "ciphertext") ciphertext++;
    if (r.kind === "complete") done = true;
  }
  assert.ok(done);
  assert.equal(secrets, 3);
  assert.equal(ciphertext, 3);
  assert.equal(m.counts["auth.sessions"], "1");
  assert.ok(m.excludedAuth.includes("auth.sessions"));
  assert.equal(m.authPolicy, "fresh-sign-in-no-sessions-reset-user-tokens");
  const encrypted = await readFile(archive);
  assert.ok(
    !encrypted.includes(Buffer.from(fakeToken)),
    "No clear token bytes in encrypted archive",
  );
});
test("wrong passphrase, corrupted/truncated headers and frames fail without target writes", async () => {
  await reject(
    restore({ ...options(), passphrase: randomBytes(32).toString("hex") }),
    "ARCHIVE_AUTHENTICATION_OR_FORMAT",
  );
  const bytes = await readFile(archive);
  for (const data of [
    bytes.subarray(0, 4),
    bytes.subarray(0, bytes.length - 1),
    Buffer.concat([bytes, Buffer.from("x")]),
    (() => {
      const b = Buffer.from(bytes);
      b[b.length - 20] ^= 1;
      return b;
    })(),
  ]) {
    const path = join(folder, `${randomUUID()}.bad`);
    await writeFile(path, data);
    await assert.rejects(
      restore({ ...options(), path }),
      (e) => typeof e.code === "string",
    );
    same(
      +(await scalar(target.owner, "select count(*) from vault.secrets")),
      0,
      "No partial Vault records",
    );
    same(
      +(await scalar(
        target.owner,
        "select count(*) from public.prescriptions",
      )),
      0,
      "No partial clinical records",
    );
  }
});
test("authenticated but incomplete/wrong-count/misordered archives fail closed and restore trigger modes on rollback", async () => {
  const records = [];
  for await (const r of readArchive(archive, pass)) records.push(r);
  for (const mutate of [
    (rs) => rs.slice(0, -1),
    (rs) =>
      rs.filter(
        (r) => !(r.kind === "row" && r.table === "public.prescription_items"),
      ),
    (rs) =>
      rs.map((r) =>
        r.kind === "manifest"
          ? { ...r, counts: { ...r.counts, "public.patients": "999" } }
          : r,
      ),
  ]) {
    const path = join(folder, `${randomUUID()}.bad`),
      w = await createArchive(path, pass),
      hash = recordHash();
    const altered = mutate(records);
    for (const r of altered) {
      if (r.kind === "complete")
        await w.write({ ...r, streamHash: hash.digest() });
      else {
        hash.add(r);
        await w.write(r);
      }
    }
    await w.seal();
    await w.publish();
    await assert.rejects(
      restore({ ...options(), path }),
      (e) => typeof e.code === "string",
    );
    same(
      +(await scalar(
        target.owner,
        "select count(*) from pg_trigger where not tgisinternal and tgenabled='D'",
      )),
      0,
      "User trigger state restored on rollback",
    );
    same(
      +(await scalar(target.owner, "select count(*) from vault.secrets")),
      0,
      "Native-API adapter writes rolled back",
    );
  }
});
test("incompatible/nonempty target, active Auth traffic, missing table and unsupported Auth state are rejected", async () => {
  const traffic = await target.connect();
  await traffic.query(
    "set application_name='gotrue-local-probe';set statement_timeout='4s'",
  );
  const running = traffic.query("select pg_sleep(3)");
  try {
    await reject(restore(options()), "TARGET_NOT_ISOLATED");
  } finally {
    await running;
    await traffic.end();
  }
  await target.owner.query(
    "alter table public.patients add column local_incompatible text",
  );
  await reject(restore(options()), "INCOMPATIBLE_TARGET");
  await target.owner.query(
    "alter table public.patients drop column local_incompatible",
  );
  const blocker = randomUUID();
  await target.owner.query("insert into auth.users(id) values($1)", [blocker]);
  await reject(restore(options()), "TARGET_NOT_EMPTY");
  await target.owner.query("delete from auth.users where id=$1", [blocker]);
  await source.owner.query(
    "alter table auth.identities rename to local_missing_identities",
  );
  await reject(
    capture({
      connection: source.connection,
      project: "local-source",
      path: join(folder, "missing.rxenc"),
      passphrase: pass,
      adapter: true,
    }),
    "UNKNOWN_AUTH_TABLE",
  );
  await source.owner.query(
    "alter table auth.local_missing_identities rename to identities",
  );
  const factor = randomUUID();
  await source.owner.query("insert into auth.mfa_factors values($1,$2,$3)", [
    factor,
    doctor,
    randomBytes(32).toString("hex"),
  ]);
  await reject(
    capture({
      connection: source.connection,
      project: "local-source",
      path: join(folder, "mfa.rxenc"),
      passphrase: pass,
      adapter: true,
    }),
    "UNSUPPORTED_AUTH_CONFIGURATION_NOT_EMPTY",
  );
  await source.owner.query("delete from auth.mfa_factors where id=$1", [
    factor,
  ]);
});
test("interruptions and late failures rollback, with no abandoned plaintext or disabled triggers", async () => {
  const controller = new AbortController(),
    path = join(folder, "interrupted.rxenc");
  await reject(
    capture({
      connection: source.connection,
      project: "local-source",
      path,
      passphrase: pass,
      adapter: true,
      signal: controller.signal,
      onSnapshot: () => controller.abort(),
    }),
    "INTERRUPTED",
  );
  assert.ok(
    !(await readdir(folder)).some((f) => f.startsWith("interrupted.rxenc")),
  );
  await reject(
    restore({
      ...options(),
      onBeforeCommit: () => {
        throw new Error("Synthetic local failure before COMMIT");
      },
    }),
    "RESTORE_FAILED_ROLLED_BACK",
  );
  same(
    +(await scalar(target.owner, "select count(*) from public.prescriptions")),
    0,
    "Late failure leaves no prescriptions",
  );
  same(
    +(await scalar(target.owner, "select count(*) from vault.secrets")),
    0,
    "Late failure leaves no encrypted artifacts",
  );
  same(
    +(await scalar(
      target.owner,
      "select count(*) from pg_trigger where not tgisinternal and tgenabled='D'",
    )),
    0,
    "Original trigger modes remain",
  );
  assert.ok(
    !(await readdir(folder)).some((f) => f.includes(".incomplete-")),
    "Failure removes encrypted incomplete files",
  );
});
test("verification-only restore rolls back all native-API adapter artifacts and Auth/clinical data", async () => {
  const result = await restore({ ...options(), verifyOnly: true });
  assert.equal(result.status, "RESTORE_VERIFIED_ROLLED_BACK");
  assert.equal(
    +(await scalar(target.owner, "select count(*) from vault.secrets")),
    0,
  );
  assert.equal(
    +(await scalar(target.owner, "select count(*) from auth.users")),
    0,
  );
  assert.equal(
    +(await scalar(target.owner, "select count(*) from public.prescriptions")),
    0,
  );
});
test("complete restore preserves values, historical times, digests and IDs; maps Vault IDs; requires fresh session", async () => {
  const o = options();
  const result = await restore(o);
  assert.equal(result.status, "RESTORED");
  assert.equal(result.secretCount, 3);
  assert.equal(
    +(await scalar(target.owner, "select count(*) from public.prescriptions")),
    2,
  );
  assert.equal(
    +(await scalar(
      target.owner,
      "select count(*) from public.prescription_items",
    )),
    4,
  );
  assert.equal(
    +(await scalar(target.owner, "select count(*) from public.patients")),
    2,
  );
  assert.equal(
    +(await scalar(target.owner, "select count(*) from auth.sessions")),
    0,
  );
  assert.equal(
    +(await scalar(target.owner, "select count(*) from auth.refresh_tokens")),
    0,
  );
  same(
    await scalar(
      target.owner,
      "select recovery_token from auth.users where id=$1",
      [doctor],
    ),
    "",
    "Live recovery token cleared",
  );
  same(
    await scalar(
      source.owner,
      "select encrypted_password from auth.users where id=$1",
      [doctor],
    ),
    await scalar(
      target.owner,
      "select encrypted_password from auth.users where id=$1",
      [doctor],
    ),
    "Auth password hash preserved",
  );
  const sourceRefs = (
    await source.owner.query(
      "select prescription_id::text as id,rx_private.recover_reference(prescription_id) as code,vault_secret_id::text as artifact from rx_private.issuance_receipts order by prescription_id",
    )
  ).rows;
  const targetRefs = (
    await target.owner.query(
      "select prescription_id::text as id,rx_private.recover_reference(prescription_id) as code,vault_secret_id::text as artifact from rx_private.issuance_receipts order by prescription_id",
    )
  ).rows;
  assert.equal(sourceRefs.length, targetRefs.length);
  for (let i = 0; i < sourceRefs.length; i++) {
    same(sourceRefs[i].id, targetRefs[i].id, "Prescription ID");
    same(sourceRefs[i].code, targetRefs[i].code, "Reference equality");
    assert.ok(
      sourceRefs[i].artifact !== targetRefs[i].artifact,
      "Native API assigns new artifact UUID",
    );
  }
  for (const table of [
    "public.prescriptions",
    "public.prescription_items",
    "public.audit_events",
    "rx_private.cancellation_receipts",
  ]) {
    const sourceValue = await scalar(
      source.owner,
      `select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text from ${table} t`,
    );
    // Source gained one post-snapshot patient creation audit; restrict audit comparison to archive count via restore's canonical verifier.
    if (table !== "public.audit_events")
      same(
        sourceValue,
        await scalar(
          target.owner,
          `select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text from ${table} t`,
        ),
        "Historical value equality",
      );
  }
  let mappings = 0;
  for await (const r of readArchive(o.receiptPath, pass))
    if (r.kind === "vault_id_map") mappings++;
  assert.equal(mappings, 3);
  await target.owner.query("begin");
  await context(target.owner);
  await assert.rejects(
    target.owner.query("select public.reveal_doctor_reference($1)", [
      sourceRefs[0].id,
    ]),
    (e) => e.code === "42501",
  );
  await target.owner.query("rollback");
  await target.owner.query("begin");
  await target.owner.query("set local role authenticated");
  await assert.rejects(
    target.owner.query("select reference_digest from public.prescriptions"),
    (e) => e.code === "42501",
  );
  await target.owner.query("rollback");
  await assert.rejects(
    target.owner.query(
      "update public.patients set name='SYNTHETIC CORRECTION' where id=(select patient_id from public.prescriptions limit 1)",
    ),
    (e) => e.code === "23514",
  );
  await assert.rejects(
    target.owner.query("delete from public.prescriptions"),
    (e) => e.code === "23514",
  );
  assert.equal(
    +(await scalar(
      target.owner,
      "select count(*) from pg_tables where schemaname='public' and rowsecurity",
    )),
    7,
  );
  await reject(restore(options()), "TARGET_NOT_EMPTY");
});
test("archive bounds reject oversized records and endpoint checks reject source/mismatched/non-TLS targets", async () => {
  const w = await createArchive(join(folder, "oversized.rxenc"), pass);
  await reject(w.write({ data: "x".repeat(MAX_FRAME) }), "ARCHIVE_FRAME_SIZE");
  await w.abort();
  for (const connection of [
    {
      host: "db.wrong.supabase.co",
      port: 5432,
      database: "postgres",
      user: "postgres",
      ssl: { rejectUnauthorized: true },
    },
    {
      host: `db.${"a".repeat(20)}.supabase.co`,
      port: 6543,
      database: "postgres",
      ssl: { rejectUnauthorized: true },
    },
    {
      host: `db.${"a".repeat(20)}.supabase.co`,
      port: 5432,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  ])
    assert.throws(() => identifyEndpoint(connection, "a".repeat(20)));
});
