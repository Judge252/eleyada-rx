import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { startTestDatabase } from "./local-postgres.mjs";
import { localPostgrest } from "./postgrest-server.mjs";
import { sanitizeTestErrors } from "../sanitize-test-errors.mjs";
sanitizeTestErrors("PHARMACY_HTTP");
test("real local PostgREST across two instances commits404 409 429 budgets with no-store and SDK PT409", async () => {
  let db, first, second;
  try {
    db = await startTestDatabase();
    const actor = randomUUID(),
      session = randomUUID(),
      pharmacy = randomUUID(),
      password = randomBytes(32).toString("hex");
    await db.owner.query("insert into auth.users(id) values($1);", [actor]);
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [session, actor],
    );
    await db.owner.query(
      "insert into public.pharmacies(id,name) values($1,'SYNTHETIC HTTP')",
      [pharmacy],
    );
    await db.owner.query(
      "insert into public.app_users(id,role,pharmacy_id) values($1,'pharmacist',$2)",
      [actor, pharmacy],
    );
    await db.owner.query(
      `create role local_pharmacy_rest login noinherit password '${password}';grant authenticated,anon to local_pharmacy_rest;`,
    );
    first = await localPostgrest(db, {
      user: "local_pharmacy_rest",
      password,
      allowRollback: true,
    });
    second = await localPostgrest(db, {
      user: "local_pharmacy_rest",
      password,
    });
    const clients = [first, second].map((server) => ({
      server,
      token: server.token({
        role: "authenticated",
        sub: actor,
        session_id: session,
      }),
    }));
    for (let n = 0; n < 11; n++) {
      const c = clients[n % 2],
        r = await fetch(`${c.server.base}/rpc/lookup_pharmacy_prescription`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${c.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_reference: "malformed" }),
          signal: AbortSignal.timeout(10000),
        });
      assert.equal(r.status, n === 10 ? 429 : 404);
      assert.ok(r.headers.get("cache-control").includes("no-store"));
      assert.equal((await r.json()).code, n === 10 ? "PT429" : "PT404");
    }
    assert.equal(
      +(
        await db.owner.query(
          "select attempts from rx_private.pharmacy_rate_limits where scope='lookup_actor_minute' and subject_id=$1",
          [actor],
        )
      ).rows[0].attempts,
      11,
    );
    const sdk = new PostgrestClient(first.base, {
      headers: { Authorization: `Bearer ${clients[0].token}` },
    });
    const overridden = await fetch(
      `${first.base}/rpc/lookup_pharmacy_prescription`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clients[0].token}`,
          "Content-Type": "application/json",
          Prefer: "tx=rollback",
        },
        body: JSON.stringify({ p_reference: "malformed" }),
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.equal(overridden.status, 403);
    assert.equal((await overridden.json()).code, "42501");
    const result = await sdk.rpc("dispense_pharmacy_prescription", {
      p_lookup_id: randomUUID(),
      p_prescription_id: randomUUID(),
      p_request_id: randomUUID(),
      p_identity_confirmed: true,
      p_full_confirmed: true,
    });
    assert.equal(result.status, 409);
    assert.equal(result.error.code, "PT409");
    assert.equal(
      +(
        await db.owner.query(
          "select attempts from rx_private.pharmacy_rate_limits where scope='dispense_actor_minute' and subject_id=$1",
          [actor],
        )
      ).rows[0].attempts,
      1,
    );
    const get = await fetch(
      `${first.base}/rpc/lookup_pharmacy_prescription?p_reference=`,
      {
        headers: { Authorization: `Bearer ${clients[0].token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.equal(get.status, 405);
    // Full committed HTTP workflow, local JWT contexts and local Vault adapter only.
    const doctor = randomUUID(),
      doctorSession = randomUUID();
    await db.owner.query("insert into auth.users(id) values($1)", [doctor]);
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [doctorSession, doctor],
    );
    await db.owner.query(
      "insert into public.app_users(id,role) values($1,'doctor')",
      [doctor],
    );
    await db.owner.query(
      "select vault.create_secret($1,'al_eyada_rx.lookup.v1')",
      [randomBytes(32).toString("hex")],
    );
    await db.owner.query("begin;set local role authenticated");
    await db.owner.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: doctor,
        session_id: doctorSession,
        role: "authenticated",
      }),
    ]);
    const draft = (
      await db.owner.query(
        "select public.save_doctor_draft($1,$2,$3,'',null,null) as d",
        [
          randomUUID(),
          { name: "SYNTHETIC HTTP SUBJECT", patient_identifier: "TEST ONLY" },
          JSON.stringify(
            [1, 2].map((n) => ({
              medication_name: `SYNTHETIC HTTP ${n}`,
              strength: "test",
              dose: "test",
              frequency: "test",
              duration: "test",
              quantity: n,
              special_instructions: "",
            })),
          ),
        ],
      )
    ).rows[0].d;
    const review = (
      await db.owner.query("select public.get_doctor_issue_review($1) as r", [
        draft.id,
      ])
    ).rows[0].r;
    const issued = (
      await db.owner.query(
        "select public.issue_doctor_prescription($1,$2,$3,$4) as i",
        [draft.id, draft.updated_at, review.fingerprint, randomUUID()],
      )
    ).rows[0].i;
    await db.owner.query("commit");
    await db.owner.query("delete from rx_private.pharmacy_rate_limits");
    const found = await sdk.rpc("lookup_pharmacy_prescription", {
      p_reference: issued.reference,
    });
    assert.ok(
      !found.error &&
        found.data.state === "eligible" &&
        found.data.items.length === 2,
    );
    const confirmation = {
      p_lookup_id: found.data.lookup_id,
      p_prescription_id: found.data.prescription_id,
      p_request_id: randomUUID(),
      p_identity_confirmed: true,
      p_full_confirmed: true,
    };
    const completed = await sdk.rpc(
      "dispense_pharmacy_prescription",
      confirmation,
    ); // simulate a committed response lost to its caller
    assert.ok(!completed.error && completed.data.state === "dispensed");
    const replay = await sdk.rpc(
      "dispense_pharmacy_prescription",
      confirmation,
    );
    assert.ok(
      !replay.error &&
        replay.data.replayed &&
        replay.data.id === completed.data.id &&
        replay.data.dispensed_at === completed.data.dispensed_at,
    );
    const after = await fetch(
      `${second.base}/rpc/lookup_pharmacy_prescription`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clients[1].token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_reference: issued.reference }),
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.equal(after.status, 200);
    assert.ok(after.headers.get("cache-control").includes("no-store"));
    const state = await after.json();
    assert.ok(
      state.state === "dispensed" &&
        !Object.hasOwn(state, "patient") &&
        !Object.hasOwn(state, "items"),
    );
    assert.equal(
      +(
        await db.owner.query(
          "select count(*) from public.dispensations where prescription_id=$1",
          [draft.id],
        )
      ).rows[0].count,
      1,
    );
    console.log(
      "PASS local PostgREST14.18: two instances, committed404/409/429 counters, no-store, SDK PT409, GET denied. Not hosted Auth/Vault evidence.",
    );
  } catch (e) {
    throw Error(
      `PHARMACY_HTTP_CHECK_FAILED_${e.code ?? "ASSERTION"}_${e.stack?.match(/pharmacy-http\.test\.mjs:(\d+):/)?.[1] ?? "setup"}`,
    );
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    if (db) await db.stop();
  }
});
