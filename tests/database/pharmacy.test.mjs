import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startTestDatabase } from "./local-postgres.mjs";
import { sanitizeTestErrors } from "../sanitize-test-errors.mjs";
sanitizeTestErrors("PHARMACY_SQL");
let db;
const ids = Object.fromEntries(
  [
    "doctor",
    "one",
    "two",
    "three",
    "four",
    "inactive",
    "unassigned",
    "pharmacy",
    "otherPharmacy",
  ].map((k) => [k, randomUUID()]),
);
const sessions = Object.fromEntries(
  Object.keys(ids).map((k) => [k, randomUUID()]),
);
const scalar = async (c, sql, args = []) =>
  Object.values((await c.query(sql, args)).rows[0])[0];
const safeTest = (name, fn) =>
  test(name, async () => {
    try {
      await fn();
    } catch (e) {
      const line =
        e.stack?.match(/pharmacy\.test\.mjs:(\d+):/)?.[1] ?? "unknown";
      throw Error(
        `PHARMACY_CHECK_FAILED_${name.replace(/[^a-z0-9]/gi, "_")}_${e.code ?? "ASSERTION"}_LINE_${line}`,
      );
    }
  });
async function context(c, actor = "one", role = "authenticated") {
  await c.query(`set local role ${role}`);
  await c.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
    [
      JSON.stringify({
        sub: ids[actor],
        role,
        session_id: sessions[actor],
        user_metadata: { role: "doctor" },
      }),
      ids[actor] ?? "",
    ],
  );
  await c.query("set local statement_timeout='5s'");
}
async function tx(fn, actor = "one", commit = true, role = "authenticated") {
  const c = await db.connect();
  try {
    await c.query("begin");
    await context(c, actor, role);
    const result = await fn(c);
    await c.query(commit ? "commit" : "rollback");
    return result;
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}
const lookup = (code, actor = "one") =>
  tx(
    (c) => scalar(c, "select public.lookup_pharmacy_prescription($1)", [code]),
    actor,
  );
const args = (l, request = randomUUID()) => [
  l.lookup_id,
  l.prescription_id,
  request,
  true,
  true,
];
const dispense = (a, actor = "one") =>
  tx(
    (c) =>
      scalar(
        c,
        "select public.dispense_pharmacy_prescription($1,$2,$3,$4,$5)",
        a,
      ),
    actor,
  );
const denied = async (fn, code = "42501") => {
  let caught;
  try {
    await fn();
  } catch (e) {
    caught = e.code;
  }
  assert.equal(caught, code);
};
const med = (n) => ({
  medication_name: `SYNTHETIC LOCAL ${n}`,
  strength: `test${n}`,
  dose: "test",
  frequency: "test",
  duration: "test",
  quantity: n + 2,
  special_instructions: "SYNTHETIC ONLY",
});
async function issued() {
  return tx(async (c) => {
    const d = await scalar(
      c,
      "select public.save_doctor_draft($1,$2,$3,'',null,null)",
      [
        randomUUID(),
        { name: "SYNTHETIC LOCAL", patient_identifier: "TEST ONLY" },
        JSON.stringify([med(1), med(2)]),
      ],
    );
    const review = await scalar(
      c,
      "select public.get_doctor_issue_review($1)",
      [d.id],
    );
    const i = await scalar(
      c,
      "select public.issue_doctor_prescription($1,$2,$3,$4)",
      [d.id, d.updated_at, review.fingerprint, randomUUID()],
    );
    const version = await scalar(
      c,
      "select updated_at::text from public.prescriptions where id=$1",
      [d.id],
    );
    return { ...i, version };
  }, "doctor");
}
const counts = () =>
  scalar(
    db.owner,
    "select jsonb_build_array((select count(*) from public.dispensations),(select count(*) from rx_private.dispensing_receipts),(select count(*) from public.audit_events))",
  );
async function expireHeader(id, interval = "-1 second") {
  await db.owner.query("begin");
  await db.owner.query(
    "alter table public.prescriptions disable trigger guard_prescription",
  );
  await db.owner.query(
    "update public.prescriptions set issued_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()+$2::interval where id=$1",
    [id, interval],
  );
  await db.owner.query(
    "alter table public.prescriptions enable trigger guard_prescription",
  );
  await db.owner.query("commit");
}
async function waitLock(c) {
  for (let i = 0; i < 100; i++) {
    if (
      await scalar(
        db.owner,
        "select wait_event_type='Lock' from pg_stat_activity where pid=$1",
        [c.processID],
      )
    )
      return;
    await delay(10);
  }
  assert.fail("Bounded lock wait not observed");
}
before(async () => {
  db = await startTestDatabase();
  await db.owner.query(
    "insert into public.pharmacies(id,name) values($1,'SYNTHETIC ONE'),($2,'SYNTHETIC TWO')",
    [ids.pharmacy, ids.otherPharmacy],
  );
  for (const actor of [
    "doctor",
    "one",
    "two",
    "three",
    "four",
    "inactive",
    "unassigned",
  ]) {
    await db.owner.query("insert into auth.users(id) values($1)", [ids[actor]]);
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [sessions[actor], ids[actor]],
    );
    if (actor !== "unassigned")
      await db.owner.query(
        "insert into public.app_users(id,role,pharmacy_id,is_active) values($1,$2,$3,$4)",
        [
          ids[actor],
          actor === "doctor" ? "doctor" : "pharmacist",
          actor === "doctor"
            ? null
            : actor === "two"
              ? ids.otherPharmacy
              : ids.pharmacy,
          actor !== "inactive",
        ],
      );
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

safeTest(
  "narrow role grants RLS native Auth isolation and no general browsing",
  async () => {
    const r = (
      await db.owner.query(
        "select rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit from pg_roles where rolname='rx_pharmacy_executor'",
      )
    ).rows[0];
    assert.ok(Object.values(r).every((v) => v === false));
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db.owner,
          "select pg_has_role($1,'rx_pharmacy_executor','SET')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db.owner,
          "select has_column_privilege($1,'public.prescriptions','reference_digest','SELECT')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db.owner,
          "select has_function_privilege($1,'rx_private.pharmacy_context(boolean)','EXECUTE')",
          [role],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db.owner,
        "select has_schema_privilege('rx_pharmacy_executor','auth','USAGE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db.owner,
        "select has_column_privilege('rx_pharmacy_executor','public.prescriptions','reference_digest','SELECT')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db.owner,
        "select has_schema_privilege('rx_pharmacy_executor','vault','USAGE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db.owner,
        "select exists(select 1 from pg_auth_members where roleid='rx_pharmacy_executor'::regrole and (inherit_option or set_option))",
      ),
      false,
    );
    const f = (
      await db.owner.query(
        "select prosecdef,proconfig,proowner::regrole::text owner from pg_proc where proname in ('lookup_pharmacy_prescription','dispense_pharmacy_prescription')",
      )
    ).rows;
    assert.equal(f.length, 2);
    assert.ok(
      f.every(
        (r) =>
          r.prosecdef &&
          r.owner === "rx_pharmacy_executor" &&
          r.proconfig.includes('search_path=""'),
      ),
    );
    await tx(async (c) => {
      for (const t of [
        "patients",
        "prescriptions",
        "prescription_items",
        "dispensations",
      ])
        assert.equal(+(await scalar(c, `select count(*) from public.${t}`)), 0);
    });
  },
);
safeTest(
  "lookup normalization minimal disclosure ordered values and full atomic completion survives new session",
  async () => {
    const p = await issued();
    const l = await lookup(p.reference.toLowerCase().replaceAll("-", " "));
    assert.equal(l.state, "eligible");
    assert.equal(l.items.length, 2);
    assert.ok(
      l.items.every((item, index) =>
        Object.entries(med(index + 1)).every(
          ([key, value]) => item[key] === value,
        ),
      ),
    );
    assert.ok(
      !JSON.stringify(l).includes(p.reference) &&
        !Object.hasOwn(l, "reference_digest") &&
        !Object.hasOwn(l, "doctor_notes"),
    );
    const a = args(l);
    const result = await dispense(a);
    assert.equal(result.state, "dispensed");
    assert.equal(result.replayed, false);
    const replay = await dispense(a);
    assert.equal(replay.replayed, true);
    assert.ok(
      replay.id === result.id && replay.dispensed_at === result.dispensed_at,
    );
    const freshSession = randomUUID();
    await db.owner.query("update auth.sessions set id=$1 where id=$2", [
      freshSession,
      sessions.one,
    ]);
    sessions.one = freshSession;
    assert.equal((await dispense(a)).replayed, true);
    const again = await lookup(p.reference);
    assert.equal(again.state, "dispensed");
    assert.equal(again.dispensed_at, result.dispensed_at);
    assert.ok(
      !Object.hasOwn(again, "patient") && !Object.hasOwn(again, "items"),
    );
    const d = (
      await db.owner.query(
        "select pharmacy_id,pharmacist_user_id from public.dispensations where prescription_id=$1",
        [p.id],
      )
    ).rows[0];
    assert.ok(
      d.pharmacy_id === ids.pharmacy && d.pharmacist_user_id === ids.one,
    );
    assert.equal(
      (
        await tx(
          (c) => scalar(c, "select public.get_doctor_lifecycle($1)", [p.id]),
          "doctor",
        )
      ).dispensed,
      true,
    );
    assert.equal(
      await scalar(
        db.owner,
        "select status::text from public.prescriptions where id=$1",
        [p.id],
      ),
      "issued",
    );
  },
);
safeTest(
  "anonymous doctor inactive unassigned revoked pharmacy and forged metadata denied",
  async () => {
    const p = await issued();
    for (const actor of ["doctor", "inactive", "unassigned"])
      await denied(() => lookup(p.reference, actor));
    await denied(() =>
      tx(
        (c) =>
          scalar(c, "select public.lookup_pharmacy_prescription($1)", [
            p.reference,
          ]),
        "one",
        true,
        "anon",
      ),
    );
    await db.owner.query(
      "update public.pharmacies set is_active=false where id=$1",
      [ids.otherPharmacy],
    );
    await denied(() => lookup(p.reference, "two"));
    await db.owner.query(
      "update public.pharmacies set is_active=true where id=$1",
      [ids.otherPharmacy],
    );
    await db.owner.query("delete from auth.sessions where id=$1", [
      sessions.two,
    ]);
    await denied(() => lookup(p.reference, "two"));
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [sessions.two, ids.two],
    );
  },
);
safeTest(
  "invalid and unknown references persist rate budgets across committed connections",
  async () => {
    for (let n = 0; n < 10; n++)
      assert.equal(
        (await lookup(n % 2 ? "RX1-K1-" + "A".repeat(32) : "bad code")).code,
        "PT404",
      );
    assert.equal((await lookup("bad code")).code, "PT429");
    assert.equal(
      +(await scalar(
        db.owner,
        "select attempts from rx_private.pharmacy_rate_limits where scope='lookup_actor_minute' and subject_id=$1",
        [ids.one],
      )),
      11,
    );
  },
);
safeTest(
  "pharmacy shared quota hour quota and rejected confirmations cannot bypass durable limiter",
  async () => {
    for (const actor of ["one", "three", "four"])
      for (let n = 0; n < 10; n++)
        assert.equal((await lookup("bad", actor)).code, "PT404");
    assert.equal(
      (await lookup("bad", "inactive").catch((e) => ({ code: e.code }))).code,
      "42501",
    );
    // Reset only actor minute; the shared pharmacy remains exhausted.
    await db.owner.query(
      "update rx_private.pharmacy_rate_limits set window_start=clock_timestamp()-interval '2 minutes' where scope='lookup_actor_minute' and subject_id=$1",
      [ids.one],
    );
    assert.equal((await lookup("bad")).code, "PT429");
    for (let n = 0; n < 20; n++)
      assert.equal(
        (await dispense([randomUUID(), randomUUID(), randomUUID(), true, true]))
          .code,
        "PT409",
      );
    assert.equal(
      (await dispense([randomUUID(), randomUUID(), randomUUID(), true, true]))
        .code,
      "PT429",
    );
    await db.owner.query("delete from rx_private.pharmacy_rate_limits");
    await lookup("bad");
    await db.owner.query(
      "update rx_private.pharmacy_rate_limits set attempts=100 where scope='lookup_actor_hour' and subject_id=$1",
      [ids.one],
    );
    assert.equal((await lookup("bad")).code, "PT429");
  },
);
safeTest(
  "confirmation binds exact prescription actor pharmacy session and expiry",
  async () => {
    const p = await issued(),
      q = await issued(),
      l = await lookup(p.reference);
    const before = await counts();
    assert.equal(
      (await dispense([l.lookup_id, q.id, randomUUID(), true, true])).code,
      "PT409",
    );
    assert.equal((await dispense(args(l), "two")).code, "PT409");
    assert.equal(
      (await dispense([l.lookup_id, p.id, randomUUID(), false, true])).code,
      "22023",
    );
    const old = sessions.one;
    sessions.one = randomUUID();
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [sessions.one, ids.one],
    );
    assert.equal((await dispense(args(l))).code, "PT409");
    sessions.one = old;
    await db.owner.query(
      "alter table rx_private.pharmacy_lookups disable trigger immutable_pharmacy_lookup",
    );
    await db.owner.query(
      "update rx_private.pharmacy_lookups set created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [l.lookup_id],
    );
    await db.owner.query(
      "alter table rx_private.pharmacy_lookups enable trigger immutable_pharmacy_lookup",
    );
    assert.equal((await dispense(args(l))).code, "PT409");
    assert.ok(JSON.stringify(await counts()) === JSON.stringify(before));
  },
);
safeTest(
  "concurrent same request and changed retries yield one completion and PT409",
  async () => {
    const p = await issued(),
      l = await lookup(p.reference),
      a = args(l);
    const r = await Promise.all([dispense(a), dispense(a)]);
    assert.ok(
      r.every((x) => x.state === "dispensed") &&
        r[0].id === r[1].id &&
        r.some((x) => x.replayed),
    );
    assert.equal((await dispense(args(l))).code, "PT409");
    assert.equal(
      +(await scalar(
        db.owner,
        "select count(*) from public.dispensations where prescription_id=$1",
        [p.id],
      )),
      1,
    );
  },
);
safeTest(
  "cross pharmacy competition and cancellation serialize on parent both orders",
  async () => {
    const p = await issued(),
      one = await lookup(p.reference),
      two = await lookup(p.reference, "two");
    const results = await Promise.all([
      dispense(args(one)),
      dispense(args(two), "two"),
    ]);
    assert.equal(results.filter((r) => r.state === "dispensed").length, 1);
    assert.equal(results.filter((r) => r.code === "PT409").length, 1);
    const q = await issued(),
      l = await lookup(q.reference),
      holder = await db.connect();
    try {
      await holder.query("begin");
      await context(holder, "doctor");
      await scalar(
        holder,
        "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
        [q.id, q.version, randomUUID()],
      );
      const c = await db.connect();
      await c.query("begin");
      await context(c);
      const pending = scalar(
        c,
        "select public.dispense_pharmacy_prescription($1,$2,$3,$4,$5)",
        args(l),
      );
      await waitLock(c);
      await holder.query("commit");
      assert.equal((await pending).code, "PT409");
      await c.query("commit");
      await c.end();
    } finally {
      await holder.query("rollback");
      await holder.end();
    }
    const z = await issued(),
      zl = await lookup(z.reference),
      disp = await db.connect(),
      cancel = await db.connect();
    try {
      await disp.query("begin");
      await context(disp);
      await scalar(
        disp,
        "select public.dispense_pharmacy_prescription($1,$2,$3,$4,$5)",
        args(zl),
      );
      await cancel.query("begin");
      await context(cancel, "doctor");
      const promise = scalar(
        cancel,
        "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
        [z.id, z.version, randomUUID()],
      ).then(
        () => null,
        (e) => e.code,
      );
      await waitLock(cancel);
      await disp.query("commit");
      assert.equal(await promise, "PT409");
      await cancel.query("rollback");
    } finally {
      await disp.query("rollback");
      await cancel.query("rollback");
      await disp.end();
      await cancel.end();
    }
  },
);
safeTest(
  "expiry and terminal states disclose no clinical details and forbid dispensing",
  async () => {
    const p = await issued(),
      l = await lookup(p.reference);
    await expireHeader(p.id);
    const expired = await lookup(p.reference);
    assert.equal(expired.state, "expired");
    assert.ok(!Object.hasOwn(expired, "patient"));
    assert.equal((await dispense(args(l))).code, "PT409");
    const q = await issued();
    await tx(
      (c) =>
        scalar(
          c,
          "select public.cancel_doctor_prescription($1,$2,$3,'entered_in_error')",
          [q.id, q.version, randomUUID()],
        ),
      "doctor",
    );
    assert.equal((await lookup(q.reference)).state, "cancelled");
  },
);
safeTest(
  "after parent lock wait authorization and expiry rechecked with rollback and independent end",
  async () => {
    for (const mode of ["revoked", "inactive", "pharmacy", "expiry"]) {
      const p = await issued(),
        l = await lookup(p.reference),
        holder = await db.connect(),
        c = await db.connect();
      if (mode === "expiry") await expireHeader(p.id, "1 second");
      try {
        await holder.query("begin");
        await holder.query(
          "select id from public.prescriptions where id=$1 for update",
          [p.id],
        );
        await c.query("begin");
        await context(c);
        const promise = scalar(
          c,
          "select public.dispense_pharmacy_prescription($1,$2,$3,$4,$5)",
          args(l),
        ).then(
          (value) => ({ value }),
          (e) => ({ error: e.code }),
        );
        await waitLock(c);
        if (mode === "revoked")
          await db.owner.query("delete from auth.sessions where id=$1", [
            sessions.one,
          ]);
        if (mode === "inactive")
          await db.owner.query(
            "update public.app_users set is_active=false where id=$1",
            [ids.one],
          );
        if (mode === "pharmacy")
          await db.owner.query(
            "update public.pharmacies set is_active=false where id=$1",
            [ids.pharmacy],
          );
        if (mode === "expiry") await delay(1200);
        await holder.query("commit");
        const r = await promise;
        assert.equal(
          mode === "expiry" ? r.value?.code : r.error,
          mode === "expiry" ? "PT409" : "42501",
        );
        await c.query("rollback");
        assert.equal(
          +(await scalar(
            db.owner,
            "select count(*) from public.dispensations where prescription_id=$1",
            [p.id],
          )),
          0,
        );
        assert.notEqual(
          await scalar(
            db.owner,
            "select state from pg_stat_activity where pid=$1",
            [c.processID],
          ),
          "active",
        );
      } finally {
        await holder.query("rollback");
        await c.query("rollback");
        await holder.end();
        await c.end();
        if (mode === "revoked")
          await db.owner.query(
            "insert into auth.sessions(id,user_id) values($1,$2)",
            [sessions.one, ids.one],
          );
        if (mode === "inactive")
          await db.owner.query(
            "update public.app_users set is_active=true where id=$1",
            [ids.one],
          );
        if (mode === "pharmacy")
          await db.owner.query(
            "update public.pharmacies set is_active=true where id=$1",
            [ids.pharmacy],
          );
      }
    }
  },
);
safeTest(
  "late receipt failure rolls back completion and audit but retains attempted request limit",
  async () => {
    const p = await issued(),
      l = await lookup(p.reference),
      before = await counts();
    await db.owner.query(
      "create function rx_private.test_receipt_fail() returns trigger language plpgsql as $$begin raise exception 'Synthetic failure' using errcode='23505';end$$;create trigger test_receipt_fail before insert on rx_private.dispensing_receipts for each row execute function rx_private.test_receipt_fail()",
    );
    try {
      assert.equal((await dispense(args(l))).code, "PT409");
      assert.ok(JSON.stringify(before) === JSON.stringify(await counts()));
      assert.equal(
        +(await scalar(
          db.owner,
          "select attempts from rx_private.pharmacy_rate_limits where scope='dispense_actor_minute' and subject_id=$1",
          [ids.one],
        )),
        1,
      );
    } finally {
      await db.owner.query(
        "drop trigger test_receipt_fail on rx_private.dispensing_receipts;drop function rx_private.test_receipt_fail()",
      );
    }
    assert.equal((await dispense(args(l))).state, "dispensed");
  },
);
safeTest(
  "completed clinical content receipts and audit stay immutable and no patient browsing after lookup",
  async () => {
    const p = await issued(),
      l = await lookup(p.reference);
    await dispense(args(l));
    await tx(async (c) => {
      for (const table of [
        "prescriptions",
        "patients",
        "prescription_items",
        "dispensations",
      ])
        assert.equal(
          +(await scalar(c, `select count(*) from public.${table}`)),
          0,
        );
    });
    await denied(
      () =>
        db.owner.query(
          "delete from public.dispensations where prescription_id=$1",
          [p.id],
        ),
      "23514",
    );
    await denied(
      () =>
        db.owner.query(
          "delete from rx_private.dispensing_receipts where prescription_id=$1",
          [p.id],
        ),
      "23514",
    );
    await denied(
      () =>
        db.owner.query(
          "update public.prescriptions set doctor_notes='FORBIDDEN' where id=$1",
          [p.id],
        ),
      "23514",
    );
  },
);

safeTest(
  "real request key collision rolls back new completion and audit without stranding another prescription",
  async () => {
    const p = await issued(),
      q = await issued(),
      lp = await lookup(p.reference),
      lq = await lookup(q.reference),
      request = randomUUID();
    await dispense(args(lp, request));
    const before = await counts();
    assert.equal((await dispense(args(lq, request))).code, "PT409");
    assert.ok(JSON.stringify(before) === JSON.stringify(await counts()));
    assert.equal(
      +(await scalar(
        db.owner,
        "select count(*) from public.dispensations where prescription_id=$1",
        [q.id],
      )),
      0,
    );
    assert.equal((await dispense(args(lq))).state, "dispensed");
  },
);
safeTest(
  "late audit failure rolls back whole completion receipt and public history",
  async () => {
    const p = await issued(),
      l = await lookup(p.reference),
      before = await counts();
    await db.owner.query(
      "create function rx_private.test_audit_fail() returns trigger language plpgsql as $$begin if new.entity_type='dispensations' then raise exception 'Synthetic audit failure' using errcode='P0001';end if;return new;end$$;create trigger test_audit_fail before insert on public.audit_events for each row execute function rx_private.test_audit_fail()",
    );
    try {
      await denied(() => dispense(args(l)), "P0001");
      assert.ok(JSON.stringify(before) === JSON.stringify(await counts()));
    } finally {
      await db.owner.query(
        "drop trigger test_audit_fail on public.audit_events;drop function rx_private.test_audit_fail()",
      );
    }
    assert.equal((await dispense(args(l))).state, "dispensed");
  },
);
