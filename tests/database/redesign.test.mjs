import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { startTestDatabase } from "./local-postgres.mjs";

let db;
const id = Object.fromEntries(
  [
    "doctor",
    "other",
    "colleague",
    "unapproved",
    "inactive",
    "pharmacist",
    "competitor",
    "outsider",
    "clinic",
    "otherClinic",
    "pharmacy",
    "otherPharmacy",
  ].map((k) => [k, randomUUID()]),
);
const session = Object.fromEntries(
  Object.keys(id).map((k) => [k, randomUUID()]),
);
const scalar = async (c, sql, args = []) =>
  Object.values((await c.query(sql, args)).rows[0])[0];
async function context(c, actor = "doctor", role = "authenticated") {
  await c.query(`set local role ${role}`);
  await c.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
    [
      JSON.stringify({ sub: id[actor], role, session_id: session[actor] }),
      id[actor] ?? "",
    ],
  );
}
async function tx(fn, actor = "doctor", role = "authenticated") {
  const c = await db.connect();
  try {
    await c.query("begin");
    await context(c, actor, role);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}
const payload = (identifier = "٠٠٠۰۱۲۳۴") => ({
  name: "SYNTHETIC SUBJECT",
  country: "EG",
  type: "national_id",
  identifier,
  notes: "",
  items: [
    {
      medication_name: "SYNTHETIC MEDICATION",
      strength: "test",
      dose: "test",
      frequency: "test",
      duration: "test",
      quantity: 2,
      special_instructions: "",
    },
  ],
});
const issue = (request = randomUUID(), value = payload(), actor = "doctor") =>
  tx(
    (c) =>
      scalar(c, "select public.issue_form_prescription($1,$2,true)", [
        request,
        value,
      ]),
    actor,
  );
const search = (identifier = "00001234", offset = 0, actor = "pharmacist") =>
  tx(
    (c) =>
      scalar(
        c,
        "select public.search_pharmacy_identity('EG','national_id',$1,$2)",
        [identifier, offset],
      ),
    actor,
  );
const select = (s, p, actor = "pharmacist") =>
  tx(
    (c) =>
      scalar(c, "select public.select_pharmacy_prescription($1,$2)", [s, p]),
    actor,
  );
const dispense = (
  l,
  request = randomUUID(),
  actor = "pharmacist",
  identity = true,
  full = true,
) =>
  tx(
    (c) =>
      scalar(
        c,
        "select public.dispense_pharmacy_prescription($1,$2,$3,$4,$5)",
        [l.lookup_id, l.prescription_id, request, identity, full],
      ),
    actor,
  );
async function denied(fn, code = "42501") {
  await assert.rejects(fn, (e) => e.code === code);
}
async function selected(prescription, actor = "pharmacist") {
  const s = await search("00001234", 0, actor);
  assert.ok(s.matches.some((m) => m.id === prescription.id));
  return select(s.search_id, prescription.id, actor);
}
before(async () => {
  db = await startTestDatabase({ through: "20261106120000_multiclinic_form.sql" });
  await db.owner.query(
    "insert into public.clinics(id,name) values($1,'SYNTHETIC A'),($2,'SYNTHETIC B')",
    [id.clinic, id.otherClinic],
  );
  await db.owner.query(
    "insert into public.clinic_entitlements(clinic_id,is_active) values($1,true),($2,true)",
    [id.clinic, id.otherClinic],
  );
  await db.owner.query(
    "insert into public.pharmacies(id,name) values($1,'SYNTHETIC P1'),($2,'SYNTHETIC P2')",
    [id.pharmacy, id.otherPharmacy],
  );
  for (const actor of [
    "doctor",
    "other",
    "colleague",
    "unapproved",
    "inactive",
    "pharmacist",
    "competitor",
    "outsider",
  ]) {
    await db.owner.query("insert into auth.users(id) values($1)", [id[actor]]);
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [session[actor], id[actor]],
    );
    if (actor === "outsider") continue;
    const pharmacy = ["pharmacist", "competitor"].includes(actor);
    await db.owner.query(
      "insert into public.app_users(id,role,pharmacy_id) values($1,$2,$3)",
      [
        id[actor],
        pharmacy ? "pharmacist" : "doctor",
        pharmacy
          ? actor === "pharmacist"
            ? id.pharmacy
            : id.otherPharmacy
          : null,
      ],
    );
    if (!pharmacy) {
      await db.owner.query("insert into public.prescribers values($1,$2,$3)", [
        id[actor],
        `SYNTHETIC ${actor}`,
        actor !== "unapproved",
      ]);
      await db.owner.query(
        "insert into public.clinic_memberships values($1,$2,$3)",
        [
          id[actor],
          actor === "other" ? id.otherClinic : id.clinic,
          actor !== "inactive",
        ],
      );
    }
  }
  await db.owner.query(
    "select vault.create_secret($1,'al_eyada_rx.lookup.v1')",
    [randomBytes(32).toString("hex")],
  );
});
beforeEach(async () => {
  await db.owner.query("delete from rx_private.pharmacy_rate_limits");
});
after(async () => {
  if (db) await db.stop();
});

test("approved subscribed prescriber atomically issues; normalized exact identity and immutable actor", async () => {
  const r = await issue();
  assert.equal(r.status, "issued");
  assert.equal(r.doctor_id, id.doctor);
  assert.equal(r.clinic_id, id.clinic);
  const s = await search();
  assert.ok(s.matches.some((m) => m.id === r.id));
  assert.equal(
    s.matches.find((m) => m.id === r.id).doctor_name,
    "SYNTHETIC doctor",
  );
  assert.deepEqual(
    (
      await db.owner.query(
        "select country,document_type,identifier from rx_private.patient_identities i join public.prescriptions p on p.patient_id=i.patient_id where p.id=$1",
        [r.id],
      )
    ).rows[0],
    { country: "EG", document_type: "national_id", identifier: "00001234" },
  );
  assert.equal(
    (
      await tx((c) =>
        c.query(
          "update public.prescription_items set dose='changed' where prescription_id=$1",
          [r.id],
        ),
      )
    ).rowCount,
    0,
  );
  await denied(
    () =>
      db.owner.query(
        "update public.prescription_items set dose='changed' where prescription_id=$1",
        [r.id],
      ),
    "23514",
  );
  await denied(
    () =>
      db.owner.query(
        "update rx_private.patient_identities set identifier='changed'",
      ),
    "23514",
  );
});
test("anonymous, unapproved, inactive, unassigned and revoked sessions fail closed", async () => {
  for (const actor of ["unapproved", "inactive", "outsider", "pharmacist"])
    await denied(() => issue(randomUUID(), payload(), actor));
  await denied(() =>
    tx(
      (c) =>
        scalar(c, "select public.issue_form_prescription($1,$2,true)", [
          randomUUID(),
          payload(),
        ]),
      "doctor",
      "anon",
    ),
  );
  await db.owner.query(
    "update auth.sessions set not_after=now()-interval '1 second' where id=$1",
    [session.doctor],
  );
  await denied(() => issue());
  await db.owner.query("update auth.sessions set not_after=null where id=$1", [
    session.doctor,
  ]);
});
test("inactive entitlement denies new and legacy issuance but retains record reads and cancellation", async () => {
  const r = await issue();
  const draft = await tx((c) =>
    scalar(c, "select public.save_doctor_draft($1,$2,$3,'',null,null)", [
      randomUUID(),
      { name: "SYNTHETIC", patient_identifier: "opaque" },
      JSON.stringify(payload().items),
    ]),
  );
  const review = await tx((c) =>
    scalar(c, "select public.get_doctor_issue_review($1)", [draft.id]),
  );
  await db.owner.query(
    "update public.clinic_entitlements set is_active=false where clinic_id=$1",
    [id.clinic],
  );
  try {
    await denied(() => issue(), "PT402");
    await denied(
      () =>
        tx((c) =>
          scalar(c, "select public.issue_doctor_prescription($1,$2,$3,$4)", [
            draft.id,
            draft.updated_at,
            review.fingerprint,
            randomUUID(),
          ]),
        ),
      "PT402",
    );
    assert.equal(
      await tx((c) =>
        scalar(
          c,
          "select count(*)::integer from public.prescriptions where id=$1",
          [r.id],
        ),
      ),
      1,
    );
    const version = await scalar(
      db.owner,
      "select updated_at::text from public.prescriptions where id=$1",
      [r.id],
    );
    const cancel = await tx((c) =>
      scalar(
        c,
        "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
        [r.id, version, randomUUID()],
      ),
    );
    assert.equal(cancel.id, r.id);
  } finally {
    await db.owner.query(
      "update public.clinic_entitlements set is_active=true where clinic_id=$1",
      [id.clinic],
    );
  }
});
test("all legacy doctor RLS and RPC paths isolate clinics and individual ownership", async () => {
  const r = await issue();
  const patient = await scalar(
    db.owner,
    "select patient_id from public.prescriptions where id=$1",
    [r.id],
  );
  assert.equal(
    await tx(
      (c) =>
        scalar(
          c,
          "select count(*)::integer from public.prescriptions where id=$1",
          [r.id],
        ),
      "other",
    ),
    0,
  );
  assert.equal(
    await tx(
      (c) =>
        scalar(c, "select count(*)::integer from public.patients where id=$1", [
          patient,
        ]),
      "other",
    ),
    0,
  );
  assert.equal(
    await tx(
      (c) =>
        scalar(
          c,
          "select count(*)::integer from public.prescription_items where prescription_id=$1",
          [r.id],
        ),
      "other",
    ),
    0,
  );
  await denied(() =>
    tx(
      (c) => scalar(c, "select public.get_doctor_lifecycle($1)", [r.id]),
      "other",
    ),
  );
  await denied(() =>
    tx(
      (c) => scalar(c, "select public.get_doctor_issue_review($1)", [r.id]),
      "other",
    ),
  );
  await denied(() =>
    tx(
      (c) =>
        scalar(c, "select public.save_doctor_draft($1,$2,$3,'',null,null)", [
          randomUUID(),
          { id: patient },
          JSON.stringify(payload().items),
        ]),
      "other",
    ),
  );
  const version = await scalar(
    db.owner,
    "select updated_at::text from public.prescriptions where id=$1",
    [r.id],
  );
  await denied(() =>
    tx(
      (c) =>
        scalar(
          c,
          "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
          [r.id, version, randomUUID()],
        ),
      "other",
    ),
  );
  await denied(() =>
    tx(
      (c) => scalar(c, "select public.reveal_doctor_reference($1)", [r.id]),
      "other",
    ),
  );
  assert.equal(
    await tx(
      (c) =>
        scalar(
          c,
          "select count(*)::integer from public.prescriptions where id=$1",
          [r.id],
        ),
      "colleague",
    ),
    0,
  );
});
test("stable requests replay identical results, reject changed payload and recover after lost response", async () => {
  const key = randomUUID();
  const r = await issue(key);
  const replay = await issue(key);
  assert.equal(replay.id, r.id);
  assert.equal(replay.replayed, true);
  await denied(() => issue(key, { ...payload(), notes: "changed" }), "PT409");
  await denied(() => issue(key, payload(), "other"), "PT409");
  const recovered = await tx((c) =>
    scalar(c, "select public.recover_form_receipt($1)", [key]),
  );
  assert.equal(recovered.id, r.id);
  assert.equal(
    await tx(
      (c) => scalar(c, "select public.recover_form_receipt($1)", [key]),
      "other",
    ),
    null,
  );
  const concurrentKey = randomUUID();
  const results = await Promise.all([
    issue(concurrentKey),
    issue(concurrentKey),
  ]);
  assert.equal(results[0].id, results[1].id);
});
test("exact tuple matching preserves zeros and rejects separators; multiple results require selection", async () => {
  const r = await issue();
  const another = await issue(randomUUID(), payload(), "other");
  const s = await search("٠٠٠٠١٢٣٤");
  assert.ok(s.matches.some((m) => m.id === r.id));
  assert.ok(s.matches.some((m) => m.id === another.id));
  assert.deepEqual((await search("1234")).matches, []);
  assert.deepEqual(
    (
      await tx(
        (c) =>
          scalar(
            c,
            "select public.search_pharmacy_identity('IL','national_id','00001234',0)",
          ),
        "pharmacist",
      )
    ).matches,
    [],
  );
  assert.equal((await search("0000-1234")).code, "PT404");
  assert.equal((await select(s.search_id, r.id, "competitor")).code, "PT404");
  const l = await select(s.search_id, r.id);
  assert.equal(l.state, "eligible");
  assert.equal(l.patient.name, "SYNTHETIC SUBJECT");
});
test("concurrent competing pharmacies, both confirmations, immutable receipt and recovery", async () => {
  const r = await issue();
  const a = await selected(r);
  const b = await selected(r, "competitor");
  assert.equal(
    (await dispense(a, randomUUID(), "pharmacist", false, true)).code,
    "22023",
  );
  assert.equal(
    (await dispense(a, randomUUID(), "pharmacist", true, false)).code,
    "22023",
  );
  const keyA = randomUUID(),
    keyB = randomUUID();
  const results = await Promise.all([
    dispense(a, keyA),
    dispense(b, keyB, "competitor"),
  ]);
  assert.equal(results.filter((r) => r.state === "dispensed").length, 1);
  assert.equal(results.filter((r) => r.code === "PT409").length, 1);
  const winner = results[0].state === "dispensed" ? "pharmacist" : "competitor";
  const key = winner === "pharmacist" ? keyA : keyB;
  const grant = winner === "pharmacist" ? a : b;
  assert.equal((await dispense(grant, key, winner)).replayed, true);
  assert.equal(
    (
      await tx(
        (c) => scalar(c, "select public.recover_dispensing_receipt($1)", [key]),
        winner,
      )
    ).prescription_id,
    r.id,
  );
  assert.equal(
    await tx(
      (c) => scalar(c, "select public.recover_dispensing_receipt($1)", [key]),
      winner === "pharmacist" ? "competitor" : "pharmacist",
    ),
    null,
  );
  assert.equal(
    await scalar(
      db.owner,
      "select count(*)::integer from public.dispensations where prescription_id=$1",
      [r.id],
    ),
    1,
  );
});
test("cancellation and dispensing race resolves once under the existing parent lock", async () => {
  const r = await issue();
  const l = await selected(r);
  const version = await scalar(
    db.owner,
    "select updated_at::text from public.prescriptions where id=$1",
    [r.id],
  );
  const result = await Promise.allSettled([
    dispense(l),
    tx((c) =>
      scalar(
        c,
        "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
        [r.id, version, randomUUID()],
      ),
    ),
  ]);
  const dispensed = await scalar(
    db.owner,
    "select exists(select 1 from public.dispensations where prescription_id=$1)",
    [r.id],
  );
  const status = await scalar(
    db.owner,
    "select status from public.prescriptions where id=$1",
    [r.id],
  );
  assert.ok(
    (dispensed && status === "issued") ||
      (!dispensed && status === "cancelled"),
  );
  assert.ok(result.some((r) => r.status === "fulfilled"));
});
test("expiry and stale/session-scoped grants prevent dispensing and drafts never appear", async () => {
  const r = await issue();
  const l = await selected(r);
  // Local synthetic clock fixture only: never modifies hosted/history.
  await db.owner.query(
    "alter table public.prescriptions disable trigger guard_prescription",
  );
  try {
    await db.owner.query(
      "update public.prescriptions set issued_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where id=$1",
      [r.id],
    );
  } finally {
    await db.owner.query(
      "alter table public.prescriptions enable trigger guard_prescription",
    );
  }
  assert.equal((await dispense(l)).code, "PT409");
  assert.ok(!(await search()).matches.some((m) => m.id === r.id));
  const r2 = await issue();
  const l2 = await selected(r2);
  await db.owner.query(
    "update auth.sessions set not_after=now()-interval '1 second' where id=$1",
    [session.pharmacist],
  );
  try {
    await denied(() => dispense(l2));
  } finally {
    await db.owner.query(
      "update auth.sessions set not_after=null where id=$1",
      [session.pharmacist],
    );
  }
});
test("persistent enumeration/admission counters commit, audit contains no identity or clinical text", async () => {
  for (let i = 0; i < 10; i++) await search("notfound");
  assert.equal((await search()).code, "PT429");
  for (let i = 0; i < 5; i++)
    assert.equal(
      await tx(
        (c) =>
          scalar(
            c,
            "select public.request_prescriber_access('synthetic@example.invalid','onboard','SYNTHETIC','SYNTHETIC')",
          ),
        "outsider",
        "anon",
      ),
      true,
    );
  assert.equal(
    await tx(
      (c) =>
        scalar(
          c,
          "select public.request_prescriber_access('synthetic@example.invalid','onboard','SYNTHETIC','SYNTHETIC')",
        ),
      "outsider",
      "anon",
    ),
    false,
  );
  assert.equal(
    await scalar(
      db.owner,
      "select count(*)::integer from rx_private.onboarding_requests",
    ),
    1,
  );
  assert.equal(
    await scalar(
      db.owner,
      "select count(*)::integer from public.audit_events where metadata::text like '%00001234%' or metadata::text like '%SYNTHETIC%'",
    ),
    0,
  );
  assert.ok(
    await scalar(
      db.owner,
      "select count(*)>0 from rx_private.pharmacy_searches",
    ),
  );
});

test("identity results are bounded with explicit pagination; selection rechecks cancellation after search", async () => {
  for (let i = 0; i < 22; i++) await issue(randomUUID(), payload("00009999"));
  const first = await search("00009999");
  assert.equal(first.matches.length, 20);
  assert.equal(first.next_offset, 20);
  const second = await search("00009999", 20);
  assert.equal(second.matches.length, 2);
  assert.equal(second.next_offset, null);
  assert.equal(
    new Set([...first.matches, ...second.matches].map((m) => m.id)).size,
    22,
  );
  const chosen = first.matches[0];
  const version = await scalar(
    db.owner,
    "select updated_at::text from public.prescriptions where id=$1",
    [chosen.id],
  );
  await tx((c) =>
    scalar(
      c,
      "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
      [chosen.id, version, randomUUID()],
    ),
  );
  const deniedSelection = await select(first.search_id, chosen.id);
  assert.equal(deniedSelection.code, "PT409");
  assert.equal(deniedSelection.items, undefined);
});
