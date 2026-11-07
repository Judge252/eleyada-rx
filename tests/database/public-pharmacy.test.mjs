// Local PostgreSQL evidence (synthetic data): Israel-only identity, open pharmacy portal capability,
// honest anonymous attribution, persistent budgets. Not hosted evidence.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { startTestDatabase } from "./local-postgres.mjs";

let db;
const id = Object.fromEntries(
  ["doctor", "pharmacist", "clinic", "pharmacy"].map((k) => [k, randomUUID()]),
);
const session = { doctor: randomUUID(), pharmacist: randomUUID() };
const scalar = async (c, sql, args = []) =>
  Object.values((await c.query(sql, args)).rows[0])[0];
async function tx(fn, actor = null, role = "authenticated") {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query(
      "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
      [
        JSON.stringify(
          actor
            ? { sub: id[actor], role, session_id: session[actor] }
            : { role },
        ),
        actor ? id[actor] : "",
      ],
    );
    const result = await fn(c);
    await c.query("commit");
    return result;
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}
const anon = (fn) => tx(fn, null, "anon");
const payload = (identifier = "٠٠٠۰۱۲۳۴۵", name = "SYNTHETIC SUBJECT") => ({
  name,
  identifier,
  notes: "",
  items: [
    {
      medication_name: "SYNTHETIC MEDICATION",
      strength: "t",
      dose: "t",
      frequency: "t",
      duration: "t",
      quantity: 2,
      special_instructions: "",
    },
  ],
});
async function issue(value = payload()) {
  const r = await tx(
    (c) =>
      scalar(c, "select public.issue_form_prescription($1,$2,true)", [
        randomUUID(),
        value,
      ]),
    "doctor",
  );
  const code = await tx(
    async (c) =>
      (await scalar(c, "select public.reveal_doctor_reference($1)", [r.id]))
        .reference,
    "doctor",
  );
  return { ...r, code };
}
const lookup = (identifier, code, client = null) =>
  anon((c) =>
    scalar(c, "select public.public_lookup_prescription($1,$2,$3)", [
      identifier,
      code,
      client,
    ]),
  );
const dispense = (
  l,
  request = randomUUID(),
  label = null,
  identity = true,
  full = true,
) =>
  anon((c) =>
    scalar(
      c,
      "select public.public_dispense_prescription($1,$2,$3,$4,$5,$6)",
      [l.lookup_id, l.prescription_id, request, identity, full, label],
    ),
  );
const ID = "000012345";
const failure = {
  code: "PT404",
  message: "Public request unavailable",
  details: null,
  hint: null,
};
before(async () => {
  db = await startTestDatabase();
  const q = (s, a) => db.owner.query(s, a);
  await q("insert into public.clinics(id,name) values($1,'SYNTHETIC CLINIC')", [
    id.clinic,
  ]);
  await q(
    "insert into public.clinic_entitlements(clinic_id,is_active) values($1,true)",
    [id.clinic],
  );
  await q("insert into public.pharmacies(id,name) values($1,'SYNTHETIC P')", [
    id.pharmacy,
  ]);
  for (const a of ["doctor", "pharmacist"]) {
    await q("insert into auth.users(id) values($1)", [id[a]]);
    await q("insert into auth.sessions(id,user_id) values($1,$2)", [
      session[a],
      id[a],
    ]);
    await q(
      "insert into public.app_users(id,role,pharmacy_id) values($1,$2,$3)",
      [id[a], a, a === "pharmacist" ? id.pharmacy : null],
    );
  }
  await q("insert into public.prescribers values($1,'SYNTHETIC DOCTOR',true)", [
    id.doctor,
  ]);
  await q("insert into public.clinic_memberships values($1,$2,true)", [
    id.doctor,
    id.clinic,
  ]);
  await q("select vault.create_secret($1,'al_eyada_rx.lookup.v1')", [
    randomBytes(32).toString("hex"),
  ]);
});
beforeEach(() => db.owner.query("delete from rx_private.access_limits"));
after(async () => db && db.stop());

test("country/type cannot be supplied; issuer fixed to IL; Arabic digits normalize; zeros preserved; format strict", async () => {
  const r = await issue();
  const row = (
    await db.owner.query(
      "select country,document_type,identifier from rx_private.patient_identities i join public.prescriptions p on p.patient_id=i.patient_id where p.id=$1",
      [r.id],
    )
  ).rows[0];
  assert.deepEqual(row, {
    country: "IL",
    document_type: "national_id",
    identifier: ID,
  });
  for (const bad of [
    { ...payload(), country: "EG" },
    { ...payload(), type: "residence" },
    payload("12345678"),
    payload("0000-12345"),
    payload("00001234a"),
    payload("0000123456"),
  ])
    await assert.rejects(
      () =>
        tx(
          (c) =>
            scalar(c, "select public.issue_form_prescription($1,$2,true)", [
              randomUUID(),
              bad,
            ]),
          "doctor",
        ),
      (e) => e.code === "22023",
    );
});
test("national ID alone, wrong code, wrong ID and malformed input are indistinguishable and disclose nothing", async () => {
  const r = await issue();
  const wrongCode = r.code.slice(0, -1) + (r.code.endsWith("0") ? "1" : "0");
  for (const x of [
    await lookup(ID, "x"),
    await lookup(ID, wrongCode),
    await lookup("999999999", r.code),
    await lookup("bad", r.code),
  ])
    assert.deepEqual(x, failure);
  const ok = await lookup("٠٠٠٠١٢٣٤٥", r.code);
  assert.equal(ok.state, "eligible");
  assert.equal(ok.prescription_id, r.id);
  assert.equal(ok.patient.name, "SYNTHETIC SUBJECT");
  assert.equal(JSON.stringify(ok).includes(ID), false);
  assert.deepEqual(Object.keys(ok).sort(), [
    "confirmation_expires_at",
    "database_time",
    "expires_at",
    "issued_at",
    "items",
    "lookup_id",
    "patient",
    "prescription_id",
    "state",
  ]);
});
test("a code returns only its own prescription, not the patient's other prescriptions", async () => {
  const a = await issue(payload(ID, "SUBJECT A"));
  const b = await issue(payload(ID, "SUBJECT B"));
  const ra = await lookup(ID, a.code);
  assert.equal(ra.prescription_id, a.id);
  assert.equal(ra.patient.name, "SUBJECT A");
  assert.equal((await lookup(ID, b.code)).prescription_id, b.id);
});
test("anonymous has no table, private-schema or legacy RPC access; ID-only search and self-activation are closed", async () => {
  for (const sql of [
    "select * from public.prescriptions",
    "select * from public.patients",
    "select * from public.dispensations",
    "select * from rx_private.public_lookups",
    "select * from rx_private.patient_identities",
    "select * from rx_private.access_limits",
    "select public.search_pharmacy_identity('IL','national_id','000012345',0)",
    "select public.lookup_pharmacy_prescription('x')",
    "select public.request_prescriber_access('a@b.co','onboard','n','c')",
    "select rx_private.public_resolve('000012345','x')",
    "select public.get_prescriber_context()",
  ])
    await assert.rejects(
      () => anon((c) => c.query(sql)),
      (e) => e.code === "42501",
      sql,
    );
  await assert.rejects(
    () =>
      tx(
        (c) =>
          c.query(
            "select public.search_pharmacy_identity('IL','national_id','000012345',0)",
          ),
        "pharmacist",
      ),
    (e) => e.code === "42501",
  );
  await assert.rejects(
    () =>
      tx(
        (c) =>
          c.query(
            "select public.request_prescriber_access('a@b.co','onboard','n','c')",
          ),
        "doctor",
      ),
    (e) => e.code === "42501",
  );
});
test("dispensing needs both confirmations; completes once; label unverified; no pharmacy identity invented", async () => {
  const r = await issue();
  const l = await lookup(ID, r.code);
  assert.equal((await dispense(l, randomUUID(), null, false, true)).code, "22023");
  assert.equal((await dispense(l, randomUUID(), null, true, false)).code, "22023");
  assert.equal((await dispense(l, randomUUID(), "x".repeat(121))).code, "22023");
  const req = randomUUID();
  const d = await dispense(l, req, "  Synthetic Pharmacy  ");
  assert.equal(d.state, "dispensed");
  assert.equal(d.replayed, false);
  assert.deepEqual(await dispense(l, req, "other label"), {
    ...d,
    replayed: true,
  });
  assert.equal((await dispense(l, randomUUID())).code, "PT409");
  const rows = (
    await db.owner.query(
      "select access_method,pharmacy_id,pharmacist_user_id,pharmacy_label from public.dispensations where prescription_id=$1",
      [r.id],
    )
  ).rows;
  assert.deepEqual(rows, [
    {
      access_method: "public_code",
      pharmacy_id: null,
      pharmacist_user_id: null,
      pharmacy_label: "Synthetic Pharmacy",
    },
  ]);
  const rec = await anon((c) =>
    scalar(c, "select public.public_recover_dispensing($1,$2)", [
      req,
      l.lookup_id,
    ]),
  );
  assert.equal(rec.id, d.id);
  assert.equal(
    (
      await anon((c) =>
        scalar(c, "select public.public_recover_dispensing($1,$2)", [
          randomUUID(),
          l.lookup_id,
        ]),
      )
    ).code,
    "PT404",
  );
  assert.equal((await lookup(ID, r.code)).state, "dispensed");
  const legacy = await tx(
    (c) => scalar(c, "select public.lookup_pharmacy_prescription($1)", [r.code]),
    "pharmacist",
  );
  assert.equal(legacy.state, "dispensed");
});
test("competing public requests: exactly one completion", async () => {
  const r = await issue();
  const l1 = await lookup(ID, r.code);
  const l2 = await lookup(ID, r.code);
  const out = await Promise.all([dispense(l1), dispense(l2), dispense(l1)]);
  assert.equal(
    out.filter((x) => x.state === "dispensed" && x.replayed === false).length,
    1,
  );
  assert.equal(
    Number(
      (
        await db.owner.query(
          "select count(*) from public.dispensations where prescription_id=$1",
          [r.id],
        )
      ).rows[0].count,
    ),
    1,
  );
});
test("cancelled prescriptions cannot be dispensed after lookup; expired lookups are rejected", async () => {
  const c1 = await issue();
  const lc = await lookup(ID, c1.code);
  await tx(
    (c) =>
      c.query(
        "select public.cancel_doctor_prescription($1,(select updated_at from public.prescriptions where id=$1),$2,'entered_in_error')",
        [c1.id, randomUUID()],
      ),
    "doctor",
  );
  assert.equal((await dispense(lc)).code, "PT409");
  assert.equal((await lookup(ID, c1.code)).state, "cancelled");
  const e1 = await issue();
  const le = await lookup(ID, e1.code);
  // Direct owner-side backdating (test-only; trigger bypass) makes the confirmation expire without touching the prescription.
  await db.owner.query(
    "alter table rx_private.public_lookups disable trigger immutable_public_lookup",
  );
  await db.owner.query(
    "update rx_private.public_lookups set created_at=created_at-interval '1 hour',expires_at=expires_at-interval '1 hour' where id=$1",
    [le.lookup_id],
  );
  await db.owner.query(
    "alter table rx_private.public_lookups enable trigger immutable_public_lookup",
  );
  assert.equal((await dispense(le)).code, "PT409");
});
test("persistent per-ID, per-client and login budgets commit and isolate subjects", async () => {
  const r = await issue();
  for (let i = 0; i < 15; i++) assert.equal((await lookup(ID, "x")).code, "PT404");
  assert.equal((await lookup(ID, r.code)).code, "PT429");
  assert.equal((await lookup("111111111", "x")).code, "PT404");
  const client = "a".repeat(64);
  for (let i = 0; i < 40; i++)
    await lookup(`2000000${String(i).padStart(2, "0")}`, "x", client);
  assert.equal((await lookup("333333333", "x", client)).code, "PT429");
  const login = (u) =>
    anon((c) => scalar(c, "select public.consume_login_attempt($1,null)", [u]));
  for (let i = 0; i < 12; i++) assert.equal(await login("dr.test"), true);
  assert.equal(await login("dr.test"), false);
  assert.equal(await login("dr.other"), true);
  assert.equal(await login("Bad Name"), false);
});
test("prefer headers cannot roll back budgets", async () => {
  await assert.rejects(
    () =>
      anon(async (c) => {
        await c.query(
          "select set_config('request.headers','{\"prefer\":\"tx=rollback\"}',true)",
        );
        return c.query(
          "select public.public_lookup_prescription('000012345','x',null)",
        );
      }),
    (e) => e.code === "42501",
  );
});
