// Local PostgreSQL evidence (synthetic data): partial dispensing and cross-pharmacy history in the open portal.
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
  const reference = await tx(
    async (c) =>
      (await scalar(c, "select public.reveal_doctor_reference($1)", [r.id]))
        .reference,
    "doctor",
  );
  const code = await tx(
    async (c) =>
      (await scalar(c, "select public.reveal_doctor_short_code($1)", [r.id]))
        .code,
    "doctor",
  );
  return { ...r, code, reference };
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

const two = (identifier = ID) => ({
  name: "SYNTHETIC SUBJECT",
  identifier,
  notes: "",
  items: [
    { medication_name: "MED A", strength: "t", dose: "t", frequency: "t", duration: "t", quantity: 10, special_instructions: "" },
    { medication_name: "MED B", strength: "t", dose: "t", frequency: "t", duration: "t", quantity: 3, special_instructions: "" },
  ],
});
const fill = (l, items, label = "Pharmacy Alpha", request = randomUUID(), identity = true) =>
  anon((c) =>
    scalar(c, "select public.public_fill_prescription($1,$2,$3,$4,$5,$6)", [
      l.lookup_id,
      l.prescription_id,
      request,
      identity,
      JSON.stringify(items),
      label,
    ]),
  );
const qty = (l, name) => l.items.find((i) => i.medication_name === name);

test("lookup returns doctor, clinic, item ids with prescribed/filled/remaining and an empty history", async () => {
  const r = await issue(two());
  const l = await lookup(ID, r.code);
  assert.equal(l.state, "eligible");
  assert.equal(l.doctor_name, "SYNTHETIC DOCTOR");
  assert.equal(l.clinic_name, "SYNTHETIC CLINIC");
  assert.deepEqual(l.history, []);
  assert.deepEqual(
    l.items.map((i) => [i.medication_name, i.quantity, i.filled, i.remaining]),
    [
      ["MED A", 10, 0, 10],
      ["MED B", 3, 0, 3],
    ],
  );
  assert.ok(l.items.every((i) => /^[0-9a-f-]{36}$/.test(i.id)));
  assert.equal(JSON.stringify(l).includes(ID), false);
});

test("partial fill at one pharmacy, history visible at another, then the rest completes the prescription", async () => {
  const r = await issue(two());
  const l1 = await lookup(ID, r.code);
  const a = qty(l1, "MED A");
  const b = qty(l1, "MED B");
  const req = randomUUID();
  const f1 = await fill(l1, [{ item_id: a.id, quantity: 4 }], "  Pharmacy Alpha  ", req);
  assert.equal(f1.state, "partial");
  assert.equal(f1.completes, false);
  assert.equal(f1.pharmacy_label, "Pharmacy Alpha");
  assert.deepEqual(f1.items, [{ item_id: a.id, medication_name: "MED A", quantity: 4 }]);
  // Same request replays the same receipt; nothing is recorded twice.
  assert.deepEqual(await fill(l1, [{ item_id: a.id, quantity: 4 }], "Pharmacy Alpha", req), { ...f1, replayed: true });
  // The same lookup cannot be reused once the history changed.
  assert.equal((await fill(l1, [{ item_id: a.id, quantity: 1 }])).code, "PT409");

  const l2 = await lookup(ID, r.code);
  assert.equal(l2.state, "partial");
  assert.deepEqual([qty(l2, "MED A").filled, qty(l2, "MED A").remaining], [4, 6]);
  assert.equal(l2.history.length, 1);
  assert.equal(l2.history[0].pharmacy, "Pharmacy Alpha");
  assert.equal(l2.history[0].complete, false);
  assert.deepEqual(l2.history[0].items, [{ medication_name: "MED A", quantity: 4 }]);
  for (const bad of [
    [{ item_id: a.id, quantity: 7 }],
    [{ item_id: a.id, quantity: 0 }],
    [{ item_id: randomUUID(), quantity: 1 }],
    [
      { item_id: a.id, quantity: 1 },
      { item_id: a.id, quantity: 1 },
    ],
    [{ item_id: a.id, quantity: 1, extra: 1 }],
    [{ item_id: a.id, quantity: "1" }],
    [],
  ])
    assert.equal((await fill(l2, bad, "Pharmacy Beta")).code, "22023", JSON.stringify(bad));
  assert.equal((await fill(l2, [{ item_id: a.id, quantity: 1 }], "")).code, "22023");
  assert.equal((await fill(l2, [{ item_id: a.id, quantity: 1 }], "x")).code, "22023");
  assert.equal((await fill(l2, [{ item_id: a.id, quantity: 1 }], "Pharmacy Beta", randomUUID(), false)).code, "22023");

  const f2 = await fill(
    l2,
    [
      { item_id: a.id, quantity: 6 },
      { item_id: b.id, quantity: 3 },
    ],
    "Pharmacy Beta",
  );
  assert.equal(f2.state, "dispensed");
  assert.equal(f2.completes, true);
  const done = await lookup(ID, r.code);
  assert.equal(done.state, "dispensed");
  assert.equal(done.lookup_id, undefined);
  assert.deepEqual(
    done.history.map((h) => [h.pharmacy, h.complete]),
    [
      ["Pharmacy Alpha", false],
      ["Pharmacy Beta", true],
    ],
  );
  assert.ok(done.items.every((i) => i.remaining === 0));
  const completion = (
    await db.owner.query("select access_method,pharmacy_label from public.dispensations where prescription_id=$1", [r.id])
  ).rows;
  assert.deepEqual(completion, [{ access_method: "public_code", pharmacy_label: "Pharmacy Beta" }]);
  const rec = await anon((c) => scalar(c, "select public.public_recover_fill($1,$2)", [req, l1.lookup_id]));
  assert.equal(rec.id, f1.id);
  assert.equal(rec.replayed, true);
});

test("competing fills from two pharmacies on the same numbers: exactly one succeeds", async () => {
  const r = await issue(two());
  const l1 = await lookup(ID, r.code);
  const l2 = await lookup(ID, r.code);
  const a1 = qty(l1, "MED A").id;
  const out = await Promise.all([
    fill(l1, [{ item_id: a1, quantity: 10 }], "Pharmacy One"),
    fill(l2, [{ item_id: a1, quantity: 10 }], "Pharmacy Two"),
  ]);
  assert.equal(out.filter((x) => x.state === "partial").length, 1);
  assert.equal(out.filter((x) => x.code === "PT409").length, 1);
  const sum = await db.owner.query(
    "select coalesce(sum(fi.quantity),0)::int s from rx_private.fill_items fi join rx_private.fills f on f.id=fi.fill_id where f.prescription_id=$1",
    [r.id],
  );
  assert.equal(sum.rows[0].s, 10);
});

test("cancelled prescriptions keep showing history but cannot be filled; the old full endpoint is closed", async () => {
  const r = await issue(two());
  const l1 = await lookup(ID, r.code);
  await fill(l1, [{ item_id: qty(l1, "MED B").id, quantity: 1 }], "Pharmacy Alpha");
  const l2 = await lookup(ID, r.code);
  await db.owner.query("update public.prescriptions set status='cancelled' where id=$1", [r.id]);
  assert.equal((await fill(l2, [{ item_id: qty(l2, "MED B").id, quantity: 1 }])).code, "PT409");
  const c = await lookup(ID, r.code);
  assert.equal(c.state, "cancelled");
  assert.equal(c.history.length, 1);
  assert.equal(c.lookup_id, undefined);
  await assert.rejects(() => dispense(l2), (e) => e.code === "42501");
  await assert.rejects(
    () => anon((x) => x.query("select public.public_recover_dispensing($1,$2)", [randomUUID(), l2.lookup_id])),
    (e) => e.code === "42501",
  );
});

test("history is append-only and private; anonymous cannot read fill tables or helpers", async () => {
  const r = await issue(two());
  const l = await lookup(ID, r.code);
  await fill(l, [{ item_id: qty(l, "MED A").id, quantity: 2 }], "Pharmacy Alpha");
  for (const sql of ["update rx_private.fills set pharmacy_label='xx'", "delete from rx_private.fill_items"])
    await assert.rejects(() => db.owner.query(sql), (e) => e.code === "23514" || /append|immutable|history/i.test(e.message), sql);
  for (const sql of ["select * from rx_private.fills", "select * from rx_private.fill_items"])
    await assert.rejects(() => anon((c) => c.query(sql)), (e) => e.code === "42501", sql);
  await assert.rejects(
    () => anon((c) => c.query("select rx_private.public_fill_state($1)", [r.id])),
    (e) => e.code === "42501",
  );
});

test("a legacy full completion counts as fully dispensed with one history entry", async () => {
  const r = await issue(two());
  const l = await lookup(ID, r.code);
  await db.owner.query(
    "insert into public.dispensations(prescription_id,dispensed_at,access_method,pharmacy_label) values($1,now(),'public_code','Legacy Pharmacy')",
    [r.id],
  );
  const later = await lookup(ID, r.code);
  assert.equal(later.state, "dispensed");
  assert.deepEqual(
    later.history.map((h) => [h.pharmacy, h.complete, h.items.length]),
    [["Legacy Pharmacy", true, 2]],
  );
  assert.equal((await fill(l, [{ item_id: qty(l, "MED A").id, quantity: 1 }])).code, "PT409");
});

test("the sheet shows the clinic's current name after a rename", async () => {
  const r = await issue(two());
  await db.owner.query("update public.clinics set name='RENAMED CLINIC' where id=$1", [id.clinic]);
  try {
    assert.equal((await lookup(ID, r.code)).clinic_name, "RENAMED CLINIC");
  } finally {
    await db.owner.query("update public.clinics set name='SYNTHETIC CLINIC' where id=$1", [id.clinic]);
  }
});

test("doctor and clinic names come in Hebrew and English for the doctor context and the pharmacy lookup", async () => {
  const r = await issue(two());
  await db.owner.query(
    "update public.prescribers set display_name_he='רופא סינתטי', display_name_en='Synthetic Doctor' where user_id=$1",
    [id.doctor],
  );
  await db.owner.query("update public.clinics set name_he='המרפאה', name_en='The Clinic' where id=$1", [id.clinic]);
  try {
    const l = await lookup(ID, r.code);
    assert.deepEqual(
      [l.doctor_name, l.doctor_name_he, l.doctor_name_en, l.clinic_name, l.clinic_name_he, l.clinic_name_en],
      ["SYNTHETIC DOCTOR", "רופא סינתטי", "Synthetic Doctor", "SYNTHETIC CLINIC", "המרפאה", "The Clinic"],
    );
    const ctx = await tx((c) => scalar(c, "select public.get_prescriber_context()"), "doctor");
    assert.deepEqual(
      [ctx.doctor_name_he, ctx.doctor_name_en, ctx.clinic_name_he, ctx.clinic_name_en],
      ["רופא סינתטי", "Synthetic Doctor", "המרפאה", "The Clinic"],
    );
    // Lookups keep working (and stay fillable) with the extra fields.
    assert.equal(l.state, "eligible");
    assert.ok(l.lookup_id);
  } finally {
    await db.owner.query("update public.prescribers set display_name_he=null, display_name_en=null where user_id=$1", [id.doctor]);
    await db.owner.query("update public.clinics set name_he=null, name_en=null where id=$1", [id.clinic]);
  }
  for (const bad of ["update public.clinics set name_he='' where id=$1", "update public.clinics set name_en='   ' where id=$1"])
    await assert.rejects(() => db.owner.query(bad, [id.clinic]), (e) => e.code === "23514");
});

test("allergy test answer is stored with the prescription, immutable, and shown to the pharmacy", async () => {
  for (const [answer, expected] of [[true, true], [false, false], [undefined, null]]) {
    const value = two();
    if (answer !== undefined) value.allergy_test = answer;
    const r = await issue(value);
    assert.equal(r.allergy_test_done, expected);
    const l = await lookup(ID, r.code);
    assert.equal(l.allergy_test_done, expected);
    assert.equal(
      await scalar(db.owner, "select allergy_test_done from public.prescriptions where id=$1", [r.id]),
      expected,
    );
  }
  // Only a boolean is accepted.
  for (const bad of ["yes", 1, null]) {
    await assert.rejects(
      () => issue({ ...two(), allergy_test: bad }),
      (e) => e.code === "22023",
    );
  }
  // Issued prescriptions cannot be changed afterwards.
  const r = await issue({ ...two(), allergy_test: false });
  await assert.rejects(
    () => db.owner.query("update public.prescriptions set allergy_test_done=true where id=$1", [r.id]),
    (e) => e.code === "23514",
  );
});
