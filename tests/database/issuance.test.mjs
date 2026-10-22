import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startTestDatabase } from "./local-postgres.mjs";
let db;
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
const med = (n) => ({
  medication_name: `SYNTHETIC LOCAL ITEM ${n}`,
  strength: "test",
  dose: "test",
  frequency: "test",
  duration: "test",
  quantity: n,
  special_instructions: "",
});
async function context(c, actor = "doctor", role = "authenticated") {
  await c.query(`set local role ${role}`);
  await c.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [
      ids[actor] ?? "",
      JSON.stringify({
        sub: ids[actor],
        role,
        session_id: ids[`${actor}Session`],
        user_metadata: { role: "doctor" },
      }),
    ],
  );
}
async function transaction(
  fn,
  actor = "doctor",
  role = "authenticated",
  commit = false,
) {
  const c = await db.connect();
  try {
    await c.query("begin");
    await context(c, actor, role);
    const result = await fn(c);
    if (commit) await c.query("commit");
    return result;
  } finally {
    await c.query("rollback");
    await c.end();
  }
}
const scalar = async (c, sql, args = []) =>
  Object.values((await c.query(sql, args)).rows[0])[0];
async function draft(c) {
  const d = await scalar(
    c,
    "select public.save_doctor_draft($1,$2,$3,'',null,null)",
    [
      randomUUID(),
      { name: "SYNTHETIC LOCAL SUBJECT", patient_identifier: "TEST" },
      JSON.stringify([med(1), med(2)]),
    ],
  );
  const review = await scalar(c, "select public.get_doctor_issue_review($1)", [
    d.id,
  ]);
  return { ...d, review, request: randomUUID() };
}
const issue = (c, d, overrides = {}) => {
  const input = {
    id: d.id,
    version: d.updated_at,
    fingerprint: d.review.fingerprint,
    request: d.request,
    ...overrides,
  };
  return scalar(c, "select public.issue_doctor_prescription($1,$2,$3,$4)", [
    input.id,
    input.version,
    input.fingerprint,
    input.request,
  ]);
};
const cancel = (
  c,
  d,
  version,
  request = randomUUID(),
  reason = "entered_in_error",
) =>
  scalar(c, "select public.cancel_doctor_prescription($1,$2,$3,$4)", [
    d.id,
    version,
    request,
    reason,
  ]);
const denial = (p, code) =>
  assert.rejects(p, (e) => {
    assert.equal(e.code, code);
    return true;
  });
async function rejected(c, fn, code) {
  await c.query("savepoint rejected");
  await denial(fn(), code);
  await c.query("rollback to rejected");
}
const counts = (c) =>
  scalar(
    c,
    `select jsonb_build_array((select count(*) from public.prescriptions),(select count(*) from public.audit_events),(select count(*) from vault.secrets),(select count(*) from rx_private.issuance_receipts),(select count(*) from rx_private.cancellation_receipts))`,
  );
before(async () => {
  db = await startTestDatabase();
  for (const actor of ["doctor", "pharmacist", "inactive", "outsider"]) {
    await db.owner.query("insert into auth.users(id) values($1)", [ids[actor]]);
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [ids[`${actor}Session`], ids[actor]],
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
  // Ephemeral fixture key only, generated in memory. Never provisioned to the hosted project.
  await db.owner.query(
    "select vault.create_secret($1,'al_eyada_rx.lookup.v1','LOCAL EPHEMERAL TEST')",
    [randomBytes(32).toString("hex")],
  );
});
after(async () => {
  if (db) await db.stop();
});

test("lifecycle role cannot log in, bypass RLS, be assumed or grant schema writes; all RPC search paths fixed", async () => {
  const r = (
    await db.owner.query(
      "select rolcanlogin,rolsuper,rolcreaterole,rolbypassrls from pg_roles where rolname='rx_lifecycle_executor'",
    )
  ).rows[0];
  assert.ok(Object.values(r).every((v) => v === false));
  for (const name of ["anon", "authenticated", "service_role"]) {
    assert.equal(
      await scalar(
        db.owner,
        "select pg_has_role($1,'rx_lifecycle_executor','MEMBER')",
        [name],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db.owner,
        "select has_schema_privilege($1,'vault','USAGE')",
        [name],
      ),
      false,
    );
  }
  assert.equal(
    await scalar(
      db.owner,
      "select has_schema_privilege('rx_lifecycle_executor','public','CREATE')",
    ),
    false,
  );
  const functions = (
    await db.owner
      .query(`select p.proname,p.prosecdef,p.proowner::regrole::text as owner,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('service_role',p.oid,'EXECUTE') as service
    from pg_proc p where p.proname in ('issue_doctor_prescription','cancel_doctor_prescription','reveal_doctor_reference','get_doctor_lifecycle','get_doctor_issue_review')`)
  ).rows;
  assert.equal(functions.length, 5);
  for (const fn of functions) {
    assert.equal(fn.anon, false);
    assert.equal(fn.service, false);
    assert.ok(fn.proconfig.includes('search_path=""'));
    if (fn.proname !== "get_doctor_issue_review") {
      assert.equal(fn.prosecdef, true);
      assert.equal(fn.owner, "rx_lifecycle_executor");
    }
  }
  for (const name of [
    "reference_digest",
    "store_reference",
    "recover_reference",
    "new_reference",
    "normalize_reference",
  ])
    assert.equal(
      await scalar(
        db.owner,
        "select bool_or(has_function_privilege('authenticated',oid,'EXECUTE')) from pg_proc where pronamespace='rx_private'::regnamespace and proname=$1",
        [name],
      ),
      false,
    );
});
test("anonymous/pharmacist/inactive/unassigned/forged metadata and revoked or inactive doctor fail every RPC", async () => {
  const d = await transaction(draft, "doctor", "authenticated", true);
  for (const [actor, role] of [
    [null, "anon"],
    ["pharmacist", "authenticated"],
    ["inactive", "authenticated"],
    ["outsider", "authenticated"],
  ]) {
    for (const operation of [
      (c) => issue(c, d),
      (c) => cancel(c, d, d.updated_at),
      (c) => scalar(c, "select public.reveal_doctor_reference($1)", [d.id]),
      (c) => scalar(c, "select public.get_doctor_issue_review($1)", [d.id]),
      (c) => scalar(c, "select public.get_doctor_lifecycle($1)", [d.id]),
    ])
      await denial(transaction(operation, actor, role), "42501");
  }
  for (const mutation of [
    "delete from auth.sessions where user_id=$1",
    "update public.app_users set is_active=false where id=$1",
  ]) {
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(mutation, [ids.doctor]);
      await context(c);
      for (const operation of [
        () => issue(c, d),
        () => cancel(c, d, d.updated_at),
        () => scalar(c, "select public.reveal_doctor_reference($1)", [d.id]),
        () => scalar(c, "select public.get_doctor_issue_review($1)", [d.id]),
        () => scalar(c, "select public.get_doctor_lifecycle($1)", [d.id]),
      ])
        await rejected(c, operation, "42501");
    } finally {
      await c.query("rollback");
      await c.end();
    }
  }
  await denial(
    transaction((c) => issue(c, d, { id: randomUUID() })),
    "42501",
  );
});
test("two medications issue once with seven days, recover same code and times; identical retries and lost response safe", async () => {
  const d = await transaction(draft, "doctor", "authenticated", true);
  const first = await transaction(
    (c) => issue(c, d),
    "doctor",
    "authenticated",
    true,
  );
  const retry = await transaction(
    (c) => issue(c, d),
    "doctor",
    "authenticated",
    true,
  );
  const revealed = await transaction(
    (c) => scalar(c, "select public.reveal_doctor_reference($1)", [d.id]),
    "doctor",
    "authenticated",
    true,
  );
  assert.ok(
    first.reference === retry.reference &&
      first.reference === revealed.reference,
    "Reference recovery changed",
  );
  assert.ok(
    first.issued_at === retry.issued_at &&
      first.expires_at === revealed.expires_at,
    "Issuance timestamps changed",
  );
  assert.equal(
    Date.parse(first.expires_at) - Date.parse(first.issued_at),
    7 * 86400000,
  );
  assert.equal(retry.replayed, true);
  const items = await scalar(
    db.owner,
    "select jsonb_agg(to_jsonb(i) order by i.sort_order,i.id) from public.prescription_items i where prescription_id=$1",
    [d.id],
  );
  assert.ok(
    JSON.stringify(items) === JSON.stringify(d.review.payload.items),
    "Issued medication values or order changed",
  );
  assert.equal(
    await scalar(
      db.owner,
      "select count(*)::int from rx_private.issuance_receipts where prescription_id=$1",
      [d.id],
    ),
    1,
  );
  assert.equal(
    await scalar(
      db.owner,
      "select count(*)::int from public.prescription_items where prescription_id=$1",
      [d.id],
    ),
    2,
  );
  await denial(
    transaction((c) => issue(c, d, { request: randomUUID() })),
    "PT409",
  );
  await denial(
    transaction((c) => issue(c, d, { fingerprint: "0".repeat(64) })),
    "PT409",
  );
  await denial(
    transaction((c) => issue(c, d, { version: new Date().toISOString() })),
    "PT409",
  );
  await transaction(async (c) => {
    await rejected(
      c,
      () => c.query("select reference_digest from public.prescriptions"),
      "42501",
    );
    await rejected(
      c,
      () => c.query("select * from vault.decrypted_secrets"),
      "42501",
    );
    await rejected(
      c,
      () => c.query("select * from rx_private.issuance_receipts"),
      "42501",
    );
    await rejected(
      c,
      () =>
        c.query("update public.prescriptions set status='issued' where id=$1", [
          d.id,
        ]),
      "42501",
    );
  });
  await transaction(async (c) => {
    assert.equal(
      await scalar(
        c,
        "select count(*)::int from public.prescriptions where id=$1",
        [d.id],
      ),
      0,
    );
    await rejected(
      c,
      () => scalar(c, "select public.reveal_doctor_reference($1)", [d.id]),
      "42501",
    );
  }, "pharmacist");
});
test("strict reference normalization, 160-bit alphabet and HMAC domain; encryption stores no plaintext", async () => {
  const codes = new Set();
  for (let n = 0; n < 40; n++) {
    const code = await scalar(db.owner, "select rx_private.new_reference()");
    assert.ok(
      /^RX1-K1-(?:[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-){7}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/.test(
        code,
      ),
      "Unexpected reference format",
    );
    codes.add(code);
    const a = await scalar(db.owner, "select rx_private.reference_digest($1)", [
      code,
    ]);
    const b = await scalar(db.owner, "select rx_private.reference_digest($1)", [
      code.toLowerCase().replaceAll("-", " "),
    ]);
    assert.ok(a === b, "Normalization mismatch");
    assert.ok(/^[0-9a-f]{64}$/.test(a));
  }
  assert.equal(codes.size, 40);
  for (const code of [
    "RX1K1" + "O".repeat(32),
    "RX1K2" + "A".repeat(32),
    "RX1K1" + "A".repeat(31),
    "ＲX1K1" + "A".repeat(32),
    "RX1\nK1" + "A".repeat(32),
  ])
    await denial(
      db.owner.query("select rx_private.normalize_reference($1)", [code]),
      "22023",
    );
  const d = await transaction(draft, "doctor", "authenticated", true);
  const issued = await transaction(
    (c) => issue(c, d),
    "doctor",
    "authenticated",
    true,
  );
  assert.equal(
    await scalar(
      db.owner,
      "select position(convert_to($2,'UTF8') in s.secret)>0 from vault.secrets s join rx_private.issuance_receipts r on r.vault_secret_id=s.id where r.prescription_id=$1",
      [d.id, issued.reference],
    ),
    false,
  );
});
test("review fingerprint catches direct patient/items/header/order changes without relying only on updated_at", async () => {
  for (const mutation of [
    (c, d) =>
      c.query(
        "update public.patients set name='SYNTHETIC CHANGED' where id=$1",
        [d.review.payload.patient.id],
      ),
    (c, d) =>
      c.query(
        "update public.prescription_items set quantity=9 where prescription_id=$1 and sort_order=0",
        [d.id],
      ),
    (c, d) =>
      c.query(
        "update public.prescriptions set doctor_notes='SYNTHETIC CHANGED' where id=$1",
        [d.id],
      ),
    async (c, d) => {
      await c.query("reset role");
      await c.query(
        "update public.prescription_items set sort_order=sort_order+2 where prescription_id=$1",
        [d.id],
      );
      await context(c);
    },
  ])
    await transaction(async (c) => {
      const d = await draft(c);
      await mutation(c, d);
      await rejected(c, () => issue(c, d), "PT409");
      assert.equal(
        await scalar(c, "select status from public.prescriptions where id=$1", [
          d.id,
        ]),
        "draft",
      );
    });
});
test("missing key, recovery tampering, late Vault/receipt/audit errors fail bounded and roll back every artifact", async () => {
  for (const failure of ["key", "vault", "receipt", "audit"]) {
    const c = await db.connect();
    try {
      await c.query("begin");
      await context(c);
      const d = await draft(c);
      await c.query("reset role");
      if (failure === "key")
        await c.query(
          "update vault.secrets set name='temporarily-missing' where name='al_eyada_rx.lookup.v1'",
        );
      else {
        const table =
          failure === "vault"
            ? "vault.secrets"
            : failure === "receipt"
              ? "rx_private.issuance_receipts"
              : "public.audit_events";
        await c.query(
          `create function public.local_fail() returns trigger language plpgsql as $$ begin raise exception 'LOCAL INJECTED FAILURE' using errcode='23514'; end $$;create trigger local_fail before insert on ${table} for each row execute function public.local_fail()`,
        );
      }
      const baseline = await counts(c);
      await context(c);
      const started = Date.now();
      await rejected(
        c,
        () => issue(c, d),
        failure === "key" || failure === "vault" ? "PT503" : "23514",
      );
      assert.ok(Date.now() - started < 3000);
      await c.query("reset role");
      assert.deepEqual(await counts(c), baseline);
      assert.equal(
        await scalar(c, "select status from public.prescriptions where id=$1", [
          d.id,
        ]),
        "draft",
      );
    } finally {
      await c.query("rollback");
      await c.end();
    }
  }
  const c = await db.connect();
  try {
    await c.query("begin");
    await context(c);
    const d = await draft(c);
    await issue(c, d);
    await c.query("reset role");
    await c.query(
      "update vault.secrets set secret=extensions.pgp_sym_encrypt('CORRUPT',r.key) from vault.local_root r where id=(select vault_secret_id from rx_private.issuance_receipts where prescription_id=$1)",
      [d.id],
    );
    await context(c);
    await denial(
      scalar(c, "select public.reveal_doctor_reference($1)", [d.id]),
      "PT503",
    );
  } finally {
    await c.query("rollback");
    await c.end();
  }
});
test("bounded digest collisions exhaust three attempts and leave no header/artifacts/audit", async () => {
  const c = await db.connect();
  try {
    await c.query("begin");
    await context(c);
    const first = await draft(c);
    await issue(c, first);
    const second = await draft(c);
    await c.query("reset role");
    await c.query(
      `create or replace function rx_private.new_reference() returns text language sql volatile security invoker set search_path='' as $$ select rx_private.recover_reference('${first.id}'::uuid); $$`,
    );
    const baseline = await counts(c);
    await context(c);
    await rejected(c, () => issue(c, second), "PT503");
    await c.query("reset role");
    assert.deepEqual(await counts(c), baseline);
  } finally {
    await c.query("rollback");
    await c.end();
  }
});
test("late cancellation audit failure rolls back receipt/status/audit, then original retry succeeds", async () => {
  const c = await db.connect();
  try {
    await c.query("begin");
    await context(c);
    const d = await draft(c);
    await issue(c, d);
    const version = await scalar(
      c,
      "select updated_at::text from public.prescriptions where id=$1",
      [d.id],
    );
    const request = randomUUID();
    await c.query("reset role");
    await c.query(`create function public.local_cancel_failure() returns trigger language plpgsql as $$ begin
      if new.metadata->>'new_status'='cancelled' then raise exception 'LOCAL AUDIT FAILURE' using errcode='23514'; end if;return new;end $$;
      create trigger local_cancel_failure before insert on public.audit_events for each row execute function public.local_cancel_failure()`);
    const baseline = await counts(c);
    await context(c);
    await rejected(c, () => cancel(c, d, version, request), "23514");
    await c.query("reset role");
    assert.deepEqual(await counts(c), baseline);
    assert.equal(
      await scalar(c, "select status from public.prescriptions where id=$1", [
        d.id,
      ]),
      "issued",
    );
    await c.query(
      "drop trigger local_cancel_failure on public.audit_events;drop function public.local_cancel_failure()",
    );
    await context(c);
    assert.equal((await cancel(c, d, version, request)).replayed, false);
  } finally {
    await c.query("rollback");
    await c.end();
  }
});
test("cancellation reason/actor/time append-only, safe identical retry and changed/stale retry rejection", async () => {
  await transaction(async (c) => {
    const d = await draft(c);
    await issue(c, d);
    const version = await scalar(
      c,
      "select updated_at::text from public.prescriptions where id=$1",
      [d.id],
    );
    const request = randomUUID();
    await rejected(c, () => cancel(c, d, d.updated_at, request), "PT409");
    await rejected(
      c,
      () => cancel(c, d, version, request, "free text"),
      "22023",
    );
    const first = await cancel(c, d, version, request);
    const second = await cancel(c, d, version, request);
    assert.equal(first.cancelled_at, second.cancelled_at);
    assert.equal(second.replayed, true);
    await rejected(c, () => cancel(c, d, version, randomUUID()), "PT409");
    await rejected(
      c,
      () => cancel(c, d, version, request, "treatment_changed"),
      "PT409",
    );
    const state = await scalar(c, "select public.get_doctor_lifecycle($1)", [
      d.id,
    ]);
    assert.equal(state.status, "cancelled");
    assert.equal(state.cancellation.reason, "entered_in_error");
    const copy = await scalar(c, "select public.reveal_doctor_reference($1)", [
      d.id,
    ]);
    assert.equal(copy.status, "cancelled");
    await c.query("reset role");
    assert.equal(
      await scalar(
        c,
        "select actor_user_id from rx_private.cancellation_receipts where prescription_id=$1",
        [d.id],
      ),
      ids.doctor,
    );
    await rejected(
      c,
      () =>
        c.query(
          "delete from rx_private.cancellation_receipts where prescription_id=$1",
          [d.id],
        ),
      "23514",
    );
    await rejected(
      c,
      () =>
        c.query(
          "delete from rx_private.issuance_receipts where prescription_id=$1",
          [d.id],
        ),
      "23514",
    );
    const unsafe = await scalar(
      c,
      "select count(*)::int from public.audit_events where metadata-array['old_status','new_status']<>'{}'::jsonb",
    );
    assert.equal(unsafe, 0);
  });
});
test("expiry boundary uses database timestamp without status job; cancel rejects expired/draft/dispensed", async () => {
  await transaction(async (c) => {
    const d = await draft(c);
    await rejected(c, () => cancel(c, d, d.updated_at), "PT409");
    await issue(c, d);
    await c.query("reset role");
    // Fixture only: turn off immutable header guard inside this rolled-back local transaction.
    await c.query(
      "alter table public.prescriptions disable trigger guard_prescription",
    );
    await c.query(
      "update public.prescriptions set issued_at=clock_timestamp()-interval '7 days',expires_at=clock_timestamp() where id=$1",
      [d.id],
    );
    await c.query(
      "alter table public.prescriptions enable trigger guard_prescription",
    );
    await context(c);
    assert.equal(
      await scalar(c, "select status from public.prescriptions where id=$1", [
        d.id,
      ]),
      "issued",
    );
    assert.equal(
      (await scalar(c, "select public.get_doctor_lifecycle($1)", [d.id]))
        .status,
      "expired",
    );
    const version = await scalar(
      c,
      "select updated_at::text from public.prescriptions where id=$1",
      [d.id],
    );
    await rejected(c, () => cancel(c, d, version), "PT409");
    const next = await draft(c);
    await issue(c, next);
    await c.query("reset role");
    await c.query(
      "insert into public.dispensations(prescription_id,pharmacy_id,pharmacist_user_id,dispensed_at) values($1,$2,$3,clock_timestamp())",
      [next.id, ids.pharmacy, ids.pharmacist],
    );
    await context(c);
    const nextVersion = await scalar(
      c,
      "select updated_at::text from public.prescriptions where id=$1",
      [next.id],
    );
    await rejected(c, () => cancel(c, next, nextVersion), "PT409");
  });
});
test("issued and cancelled contents, patient identity and references cannot be edited/deleted", async () => {
  await transaction(async (c) => {
    const d = await draft(c);
    await issue(c, d);
    for (const terminal of [false, true]) {
      if (terminal) {
        const v = await scalar(
          c,
          "select updated_at::text from public.prescriptions where id=$1",
          [d.id],
        );
        await cancel(c, d, v);
      }
      assert.equal(
        (
          await c.query(
            "update public.prescriptions set doctor_notes='SYNTHETIC CHANGE' where id=$1",
            [d.id],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (await c.query("delete from public.prescriptions where id=$1", [d.id]))
          .rowCount,
        0,
      );
      assert.equal(
        (
          await c.query(
            "update public.prescription_items set quantity=4 where prescription_id=$1",
            [d.id],
          )
        ).rowCount,
        0,
      );
      await rejected(
        c,
        () =>
          c.query(
            "update public.patients set name='SYNTHETIC CHANGE' where id=$1",
            [d.review.payload.patient.id],
          ),
        "23514",
      );
      await c.query("reset role");
      await rejected(
        c,
        () => c.query("delete from public.prescriptions where id=$1", [d.id]),
        "23514",
      );
      await context(c);
    }
  });
});
async function waitForLock(prefix) {
  for (let i = 0; i < 70; i++) {
    if (
      await scalar(
        db.owner,
        "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like $1)",
        [prefix + "%"],
      )
    )
      return;
    await delay(10);
  }
  assert.fail("Expected bounded lock wait");
}
test("blocked lifecycle call fails at database lock timeout and leaves no lingering issuance query", async () => {
  const d = await transaction(draft, "doctor", "authenticated", true);
  const a = await db.connect(),
    b = await db.connect();
  try {
    await a.query("begin");
    await b.query("begin");
    await context(a);
    await context(b);
    await a.query(
      "select id from public.prescriptions where id=$1 for update",
      [d.id],
    );
    const started = Date.now();
    await denial(issue(b, d), "55P03");
    assert.ok(Date.now() - started < 5000, "Database lock timeout exceeded");
    await b.query("rollback");
    assert.equal(
      await scalar(
        db.owner,
        "select count(*)::int from pg_stat_activity where state='active' and query like 'select public.issue_doctor_prescription%'",
      ),
      0,
    );
  } finally {
    await a.query("rollback");
    await b.query("rollback");
    await a.end();
    await b.end();
  }
});
test("competing issuance calls serialize; one receipt and identical response", async () => {
  const d = await transaction(draft, "doctor", "authenticated", true);
  const a = await db.connect(),
    b = await db.connect();
  try {
    await a.query("begin");
    await b.query("begin");
    await context(a);
    await context(b);
    const first = await issue(a, d);
    const pending = issue(b, d).then(
      (data) => ({ data }),
      (error) => ({ error }),
    );
    await waitForLock("select public.issue_doctor_prescription");
    await a.query("commit");
    const second = await pending;
    assert.equal(!!second.error, false);
    assert.ok(
      first.reference === second.data.reference,
      "Concurrent retry changed reference",
    );
    await b.query("commit");
  } finally {
    await a.query("rollback");
    await b.query("rollback");
    await a.end();
    await b.end();
  }
});
test("issuance serializes against raw item editing and draft deletion, and rejects changed review after lock", async () => {
  for (const operation of [
    "item-first",
    "issue-first-delete",
    "delete-first",
  ]) {
    const d = await transaction(draft, "doctor", "authenticated", true);
    const a = await db.connect(),
      b = await db.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      await context(a);
      await context(b);
      if (operation === "item-first") {
        await a.query(
          "update public.prescription_items set quantity=8 where prescription_id=$1",
          [d.id],
        );
        const pending = issue(b, d).then(
          (data) => ({ data }),
          (error) => ({ error }),
        );
        await waitForLock("select public.issue_doctor_prescription");
        await a.query("commit");
        assert.equal((await pending).error.code, "PT409");
      } else if (operation === "delete-first") {
        await scalar(a, "select public.delete_doctor_draft($1,$2)", [
          d.id,
          d.updated_at,
        ]);
        const pending = issue(b, d).then(
          (data) => ({ data }),
          (error) => ({ error }),
        );
        await waitForLock("select public.issue_doctor_prescription");
        await a.query("commit");
        assert.equal((await pending).error.code, "42501");
      } else {
        await issue(a, d);
        const pending = scalar(b, "select public.delete_doctor_draft($1,$2)", [
          d.id,
          d.updated_at,
        ]).then(
          (data) => ({ data }),
          (error) => ({ error }),
        );
        await waitForLock("select public.delete_doctor_draft");
        await a.query("commit");
        assert.equal((await pending).error.code, "42501");
      }
    } finally {
      await a.query("rollback");
      await b.query("rollback");
      await a.end();
      await b.end();
    }
  }
});
test("cancellation and future dispensation parent-lock contract prevents both outcomes, in either order", async () => {
  for (const cancelFirst of [true, false]) {
    const d = await transaction(draft, "doctor", "authenticated", true);
    await transaction((c) => issue(c, d), "doctor", "authenticated", true);
    const version = await scalar(
      db.owner,
      "select updated_at::text from public.prescriptions where id=$1",
      [d.id],
    );
    const a = await db.connect(),
      b = await db.connect();
    const dispense = (c) =>
      c.query(
        "insert into public.dispensations(prescription_id,pharmacy_id,pharmacist_user_id,dispensed_at) values($1,$2,$3,clock_timestamp())",
        [d.id, ids.pharmacy, ids.pharmacist],
      );
    try {
      await a.query("begin");
      await b.query("begin");
      if (cancelFirst) {
        await context(a);
        await cancel(a, d, version);
        const pending = dispense(b).then(
          (data) => ({ data }),
          (error) => ({ error }),
        );
        await waitForLock("insert into public.dispensations");
        await a.query("commit");
        assert.equal((await pending).error.code, "23514");
      } else {
        await dispense(a);
        await context(b);
        const pending = cancel(b, d, version).then(
          (data) => ({ data }),
          (error) => ({ error }),
        );
        await waitForLock("select public.cancel_doctor_prescription");
        await a.query("commit");
        assert.equal((await pending).error.code, "PT409");
      }
    } finally {
      await a.query("rollback");
      await b.query("rollback");
      await a.end();
      await b.end();
    }
  }
});
