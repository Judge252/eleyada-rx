import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startTestDatabase } from "./local-postgres.mjs";

let db;
test("corrective migration changes only three application conflict codes and preserves the full authorization contract", async () => {
  const original = await readFile(
    "supabase/migrations/20261021210732_doctor_draft_workflow.sql",
    "utf8",
  );
  const corrected = await readFile(
    "supabase/migrations/20261021215141_doctor_draft_conflict_response.sql",
    "utf8",
  );
  const expected = original
    .slice(original.indexOf("create function public.save_doctor_draft("))
    .replaceAll("create function public.", "create or replace function public.")
    .replaceAll("errcode='40001'", "errcode='PT409'");
  assert.equal(
    corrected.slice(
      corrected.indexOf("create or replace function public.save_doctor_draft("),
    ),
    expected,
  );
  assert.equal((corrected.match(/errcode='PT409'/g) ?? []).length, 3);
  const functions = (
    await db.owner.query(
      "select prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('save_doctor_draft','delete_doctor_draft')",
    )
  ).rows;
  assert.equal(functions.length, 2);
  assert.ok(functions.every((row) => !row.prosrc.includes("errcode='40001'")));
});
const ids = Object.fromEntries(
  [
    "doctor",
    "pharmacist",
    "inactive",
    "outsider",
    "pharmacy",
    "doctorSession",
    "pharmacistSession",
    "inactiveSession",
    "outsiderSession",
  ].map((k) => [k, randomUUID()]),
);
const medication = () => ({
  medication_name: "SYNTHETIC NOT FOR TREATMENT",
  strength: "test",
  dose: "test",
  frequency: "test",
  duration: "test",
  quantity: 1,
  special_instructions: "",
});
const payload = () => ({
  request: randomUUID(),
  patient: { name: "SYNTHETIC LOCAL SUBJECT", patient_identifier: "TEST ONLY" },
  items: [medication()],
  notes: "",
  id: null,
  version: null,
});
async function context(client, actor = "doctor", role = "authenticated") {
  await client.query(`set local role ${role}`);
  const sub = ids[actor];
  await client.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [
      sub ?? "",
      JSON.stringify({
        sub,
        role,
        session_id: ids[`${actor}Session`],
        user_metadata: { role: "doctor" },
      }),
    ],
  );
}
async function as(actor, operation, role = "authenticated") {
  const c = await db.connect();
  try {
    await c.query("begin");
    await context(c, actor, role);
    return await operation(c);
  } finally {
    await c.query("rollback");
    await c.end();
  }
}
const save = async (c, p) =>
  (
    await c.query(
      "select public.save_doctor_draft($1,$2,$3,$4,$5,$6) as result",
      [p.request, p.patient, JSON.stringify(p.items), p.notes, p.id, p.version],
    )
  ).rows[0].result;
const counts = async (c) =>
  (
    await c.query(
      "select (select count(*) from public.patients)::int as patients,(select count(*) from public.prescriptions)::int as headers,(select count(*) from public.prescription_items)::int as items,(select count(*) from public.audit_events)::int as audits",
    )
  ).rows[0];
const deny = (operation, code) =>
  assert.rejects(operation, (e) => {
    assert.equal(e.code, code);
    return true;
  });
before(async () => {
  db = await startTestDatabase({ legacyDoctorFixtures: true });
  for (const key of ["doctor", "pharmacist", "inactive", "outsider"]) {
    await db.owner.query("insert into auth.users(id) values($1)", [ids[key]]);
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [ids[`${key}Session`], ids[key]],
    );
  }
  await db.owner.query(
    "insert into public.pharmacies(id,name) values($1,'SYNTHETIC PHARMACY')",
    [ids.pharmacy],
  );
  await db.owner.query(
    "insert into public.app_users(id,role,pharmacy_id,is_active) values($1,'doctor',null,true),($2,'pharmacist',$4,true),($3,'pharmacist',$4,false)",
    [ids.doctor, ids.pharmacist, ids.inactive, ids.pharmacy],
  );
});
after(async () => {
  if (db) await db.stop();
});

test("draft RPCs are invoker, fixed-search-path, authenticated-only; digests remain excluded", async () => {
  const rows = (
    await db.owner.query(`select p.proname,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
    from pg_proc p where p.oid in ('public.save_doctor_draft(uuid,jsonb,jsonb,text,uuid,timestamptz)'::regprocedure,'public.delete_doctor_draft(uuid,timestamptz)'::regprocedure)`)
  ).rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.prosecdef, false);
    assert.ok(row.proconfig.includes('search_path=""'));
    assert.equal(row.anon, false);
    assert.equal(row.service, false);
    assert.equal(row.authenticated, true);
  }
  await deny(
    as("doctor", (c) =>
      c.query("select reference_digest from public.prescriptions"),
    ),
    "42501",
  );
});

test("anonymous, pharmacist, inactive and unassigned identities cannot save or delete", async () => {
  for (const [actor, role] of [
    [null, "anon"],
    ["pharmacist", "authenticated"],
    ["inactive", "authenticated"],
    ["outsider", "authenticated"],
  ]) {
    await deny(
      as(actor, (c) => save(c, payload()), role),
      "42501",
    );
    await deny(
      as(
        actor,
        (c) =>
          c.query("select public.delete_doctor_draft($1,now())", [
            randomUUID(),
          ]),
        role,
      ),
      "42501",
    );
  }
});

test("revoked sessions and inactive doctor lose mutation access, despite valid-looking claims", async () => {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("delete from auth.sessions where id=$1", [ids.doctorSession]);
    await context(c);
    await deny(save(c, payload()), "42501");
  } finally {
    await c.query("rollback");
    await c.end();
  }
  const d = await db.connect();
  try {
    await d.query("begin");
    await d.query("update public.app_users set is_active=false where id=$1", [
      ids.doctor,
    ]);
    await context(d);
    await deny(save(d, payload()), "42501");
  } finally {
    await d.query("rollback");
    await d.end();
  }
});

test("create, commit, reopen on another connection, edit, commit, reload, delete, retain patient", async () => {
  const p = payload();
  p.items.push({
    ...medication(),
    medication_name: "SYNTHETIC SECOND ITEM",
    quantity: 3,
  });
  const first = await db.connect();
  let stored;
  try {
    await first.query("begin");
    await context(first);
    stored = await save(first, p);
    await first.query("commit");
  } finally {
    await first.end();
  }
  const second = await db.connect();
  try {
    await second.query("begin");
    await context(second);
    const loaded = (
      await second.query(
        "select id,patient_id,status,doctor_notes from public.prescriptions where id=$1",
        [stored.id],
      )
    ).rows[0];
    assert.equal(loaded.status, "draft");
    const items = (
      await second.query(
        "select medication_name,quantity from public.prescription_items where prescription_id=$1 order by sort_order",
        [stored.id],
      )
    ).rows;
    assert.equal(items.length, 2);
    assert.equal(items[1].quantity, 3);
    p.id = stored.id;
    p.version = stored.updated_at;
    p.patient = { id: loaded.patient_id };
    p.notes = "SYNTHETIC EDIT";
    p.items[0].quantity = 7;
    stored = await save(second, p);
    await second.query("commit");
  } finally {
    await second.end();
  }
  const third = await db.connect();
  try {
    await third.query("begin");
    await context(third);
    assert.equal(
      (
        await third.query(
          "select quantity from public.prescription_items where prescription_id=$1 order by sort_order",
          [stored.id],
        )
      ).rows[0].quantity,
      7,
    );
    assert.equal(
      (
        await third.query(
          "select doctor_notes from public.prescriptions where id=$1",
          [stored.id],
        )
      ).rows[0].doctor_notes,
      p.notes,
    );
    assert.equal(
      (
        await third.query(
          "select public.delete_doctor_draft($1,$2) as removed",
          [stored.id, stored.updated_at],
        )
      ).rows[0].removed,
      true,
    );
    assert.equal(
      (
        await third.query("select id from public.prescriptions where id=$1", [
          stored.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await third.query(
          "select id from public.prescription_items where prescription_id=$1",
          [stored.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await third.query("select id from public.patients where id=$1", [
          p.patient.id,
        ])
      ).rowCount,
      1,
    );
    await third.query("commit");
  } finally {
    await third.end();
  }
});

test("strict input validation rejects counts, quantities, lengths, identifiers, spoofed fields before any writes", async () => {
  const mutations = [
    (p) => (p.items = []),
    (p) => (p.items = Array.from({ length: 31 }, medication)),
    (p) => (p.items[0].quantity = 0),
    (p) => (p.items[0].quantity = 1.5),
    (p) => (p.items[0].quantity = "2"),
    (p) => (p.items[0].quantity = 1000001),
    (p) => (p.patient = { id: "not-uuid" }),
    (p) => (p.patient = { name: "", patient_identifier: "" }),
    (p) => (p.patient.name = "x".repeat(201)),
    (p) => (p.patient.patient_identifier = "x".repeat(121)),
    (p) => (p.patient = { id: randomUUID(), name: "SPOOFED IDENTITY" }),
    (p) => (p.patient.doctor_user_id = ids.pharmacist),
    (p) => (p.items[0].strength = "x".repeat(121)),
    (p) => (p.items[0].duration = "x".repeat(121)),
    (p) => (p.items[0].dose = "x".repeat(201)),
    (p) => (p.items[0].frequency = ""),
    (p) => (p.items[0].medication_name = " "),
    (p) => (p.items[0].special_instructions = "x".repeat(2001)),
    (p) => (p.items[0].status = "issued"),
    (p) => (p.notes = "x".repeat(4001)),
    (p) => (p.request = null),
  ];
  const before = await counts(db.owner);
  for (const mutate of mutations) {
    const p = payload();
    mutate(p);
    await deny(
      as("doctor", (c) => save(c, p)),
      "22023",
    );
  }
  assert.deepEqual(await counts(db.owner), before);
});

test("a real late database error rolls back patient, header, all items AND audit rows", async () => {
  await db.owner
    .query(`create function public.test_fail_item() returns trigger language plpgsql as $$ begin
    if new.sort_order=1 then raise exception 'SYNTHETIC FAILURE' using errcode='23514'; end if; return new; end; $$;
    create trigger local_test_failure before insert on public.prescription_items for each row execute function public.test_fail_item();`);
  try {
    const p = payload();
    p.items.push(medication());
    const before = await counts(db.owner);
    await deny(
      as("doctor", (c) => save(c, p)),
      "23514",
    );
    assert.deepEqual(await counts(db.owner), before);
    await as("doctor", async (c) => {
      const base = await save(c, payload());
      const current = (
        await c.query(
          "select patient_id from public.prescriptions where id=$1",
          [base.id],
        )
      ).rows[0];
      const editing = {
        ...p,
        id: base.id,
        version: base.updated_at,
        patient: { id: current.patient_id },
      };
      await c.query("savepoint late_edit");
      await deny(save(c, editing), "23514");
      await c.query("rollback to late_edit");
      const remaining = await c.query(
        "select quantity from public.prescription_items where prescription_id=$1",
        [base.id],
      );
      assert.equal(remaining.rowCount, 1);
      assert.equal(remaining.rows[0].quantity, 1);
    });
  } finally {
    await db.owner.query(
      "drop trigger local_test_failure on public.prescription_items;drop function public.test_fail_item()",
    );
  }
});

test("same create request returns same persisted draft; changed payload conflicts; edit retries are safe", async () => {
  await as("doctor", async (c) => {
    const p = payload();
    const first = await save(c, p);
    const second = await save(c, p);
    assert.equal(second.id, first.id);
    assert.equal(second.replayed, true);
    assert.equal(
      (
        await c.query(
          "select id from public.prescriptions where draft_request_id=$1",
          [p.request],
        )
      ).rowCount,
      1,
    );
    await c.query("savepoint retry");
    p.notes = "SYNTHETIC DIFFERENT REQUEST";
    await deny(save(c, p), "PT409");
    await c.query("rollback to retry");
    p.id = first.id;
    p.version = first.updated_at;
    p.patient = {
      id: (
        await c.query(
          "select patient_id from public.prescriptions where id=$1",
          [first.id],
        )
      ).rows[0].patient_id,
    };
    const edit = await save(c, p);
    const retry = await save(c, p);
    assert.equal(retry.id, edit.id);
    assert.equal(retry.replayed, true);
  });
});

test("stale edits and deletes reject instead of overwriting newer content", async () => {
  await as("doctor", async (c) => {
    const p = payload();
    const first = await save(c, p);
    p.id = first.id;
    p.version = first.updated_at;
    p.patient = {
      id: (
        await c.query(
          "select patient_id from public.prescriptions where id=$1",
          [first.id],
        )
      ).rows[0].patient_id,
    };
    p.notes = "SYNTHETIC NEWER";
    await save(c, p);
    await c.query("savepoint conflict");
    p.notes = "SYNTHETIC STALE";
    await deny(save(c, p), "PT409");
    await c.query("rollback to conflict");
    await deny(
      c.query("select public.delete_doctor_draft($1,$2)", [
        p.id,
        first.updated_at,
      ]),
      "PT409",
    );
  });
});

test("selecting an existing patient never changes identity, including issued/terminal history", async () => {
  for (const status of ["issued", "cancelled", "expired"]) {
    const c = await db.connect();
    try {
      await c.query("begin");
      await context(c);
      const p = payload();
      const created = await save(c, p);
      const patientId = (
        await c.query(
          "select patient_id from public.prescriptions where id=$1",
          [created.id],
        )
      ).rows[0].patient_id;
      await c.query("reset role");
      await c.query(
        "update public.prescriptions set status=$2,issued_at=now()-interval '1 hour',reference_digest=$3 where id=$1",
        [created.id, status, "a".repeat(64)],
      );
      await context(c);
      const next = payload();
      next.patient = { id: patientId };
      await save(c, next);
      assert.equal(
        (
          await c.query("select name from public.patients where id=$1", [
            patientId,
          ])
        ).rows[0].name,
        p.patient.name,
      );
      await c.query("savepoint immutable");
      await deny(
        c.query(
          "update public.patients set name='SYNTHETIC CHANGED' where id=$1",
          [patientId],
        ),
        "23514",
      );
      await c.query("rollback to immutable");
      await deny(
        save(c, {
          ...p,
          id: created.id,
          version: created.updated_at,
          notes: "SYNTHETIC REWRITE",
        }),
        "42501",
      );
      await c.query("rollback to immutable");
      await deny(
        c.query("select public.delete_doctor_draft($1,$2)", [
          created.id,
          created.updated_at,
        ]),
        "42501",
      );
    } finally {
      await c.query("rollback");
      await c.end();
    }
  }
});

test("nonexistent selected patient cannot leave any partial record", async () => {
  const before = await counts(db.owner);
  const p = payload();
  p.patient = { id: randomUUID() };
  await deny(
    as("doctor", (c) => save(c, p)),
    "42501",
  );
  assert.deepEqual(await counts(db.owner), before);
});

test("two live create requests serialize and commit exactly one patient/header/items set", async () => {
  const baseline = await counts(db.owner);
  const a = await db.connect(),
    b = await db.connect();
  const p = payload();
  let first;
  try {
    await a.query("begin");
    await b.query("begin");
    await context(a);
    await context(b);
    first = await save(a, p);
    const duplicate = save(b, p).then(
      (data) => ({ data }),
      (error) => ({ error }),
    );
    let locked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await db.owner.query(
        "select 1 from pg_stat_activity where wait_event_type='Lock' and query like 'select public.save_doctor_draft%'",
      );
      if (waiting.rowCount) {
        locked = true;
        break;
      }
      await delay(10);
    }
    assert.equal(locked, true);
    await a.query("commit");
    const second = await duplicate;
    assert.equal(!!second.error, false);
    assert.equal(second.data.id, first.id);
    await b.query("commit");
    assert.equal(
      (
        await db.owner.query(
          "select id from public.prescriptions where draft_request_id=$1",
          [p.request],
        )
      ).rowCount,
      1,
    );
    const finalCounts = await counts(db.owner);
    assert.equal(finalCounts.patients, baseline.patients + 1);
    assert.equal(finalCounts.headers, baseline.headers + 1);
    assert.equal(finalCounts.items, baseline.items + 1);
  } finally {
    await a.query("rollback");
    await b.query("rollback");
    await a.end();
    await b.end();
  }
});
