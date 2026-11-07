import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { startTestDatabase } from "./local-postgres.mjs";
import { localPostgrest } from "./postgrest-server.mjs";
import { sanitizeTestErrors } from "../sanitize-test-errors.mjs";
sanitizeTestErrors("REDESIGN_HTTP");
test("real local PostgREST commits issue/search/selection/full dispensing/recovery and denies a second pharmacy", async () => {
  let db, rest;
  try {
    db = await startTestDatabase({ legacyDoctorFixtures: true, through: "20261106120000_multiclinic_form.sql" });
    const ids = [randomUUID(), randomUUID(), randomUUID()],
      sessions = ids.map(() => randomUUID()),
      pharmacies = [randomUUID(), randomUUID()];
    await db.owner.query(
      "insert into public.pharmacies(id,name) values($1,'SYNTHETIC 1'),($2,'SYNTHETIC 2')",
      pharmacies,
    );
    for (let i = 0; i < 3; i++) {
      await db.owner.query("insert into auth.users(id) values($1)", [ids[i]]);
      await db.owner.query(
        "insert into auth.sessions(id,user_id) values($1,$2)",
        [sessions[i], ids[i]],
      );
      await db.owner.query(
        "insert into public.app_users(id,role,pharmacy_id) values($1,$2,$3)",
        [
          ids[i],
          i === 0 ? "doctor" : "pharmacist",
          i === 0 ? null : pharmacies[i - 1],
        ],
      );
    }
    await db.owner.query(
      "select vault.create_secret($1,'al_eyada_rx.lookup.v1')",
      [randomBytes(32).toString("hex")],
    );
    const password = randomBytes(32).toString("hex");
    await db.owner.query(
      `create role local_redesign_rest login noinherit password '${password}'; grant authenticated,anon to local_redesign_rest;`,
    );
    rest = await localPostgrest(db, { user: "local_redesign_rest", password });
    const clients = ids.map(
      (sub, i) =>
        new PostgrestClient(rest.base, {
          headers: {
            Authorization: `Bearer ${rest.token({ sub, role: "authenticated", session_id: sessions[i] })}`,
          },
        }),
    );
    const rpc = async (i, name, args) => {
      const r = await clients[i].rpc(name, args);
      assert.equal(r.error, null, `${name}:${r.error?.code}`);
      return r.data;
    };
    assert.equal((await rpc(0, "get_prescriber_context", {})).entitled, true);
    const request = randomUUID();
    const input = {
      p_request_id: request,
      p_confirmed: true,
      p_payload: {
        name: "SYNTHETIC SUBJECT",
        country: "EG",
        type: "national_id",
        identifier: "٠٠٠۰۱۲۳۴",
        notes: "",
        items: [
          {
            medication_name: "SYNTHETIC",
            strength: "test",
            dose: "test",
            frequency: "test",
            duration: "test",
            quantity: 1,
            special_instructions: "",
          },
        ],
      },
    };
    const issued = await rpc(0, "issue_form_prescription", input);
    assert.equal(issued.status, "issued");
    assert.equal(
      (await rpc(0, "issue_form_prescription", input)).id,
      issued.id,
    );
    assert.equal(
      (await rpc(0, "recover_form_receipt", { p_request_id: request })).id,
      issued.id,
    );
    const lookups = [];
    for (const i of [1, 2]) {
      const found = await rpc(i, "search_pharmacy_identity", {
        p_country: "EG",
        p_type: "national_id",
        p_identifier: "00001234",
        p_offset: 0,
      });
      assert.equal(found.matches.length, 1);
      lookups.push(
        await rpc(i, "select_pharmacy_prescription", {
          p_search_id: found.search_id,
          p_prescription_id: issued.id,
        }),
      );
    }
    const dispenseRequest = randomUUID();
    const args = {
      p_request_id: dispenseRequest,
      p_lookup_id: lookups[0].lookup_id,
      p_prescription_id: issued.id,
      p_identity_confirmed: true,
      p_full_confirmed: true,
    };
    const complete = await rpc(1, "dispense_pharmacy_prescription", args);
    assert.equal(complete.state, "dispensed");
    assert.equal(
      (
        await rpc(1, "recover_dispensing_receipt", {
          p_request_id: dispenseRequest,
        })
      ).prescription_id,
      issued.id,
    );
    const conflict = await clients[2].rpc("dispense_pharmacy_prescription", {
      ...args,
      p_request_id: randomUUID(),
      p_lookup_id: lookups[1].lookup_id,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.error.code, "PT409");
    const changed = await clients[0].rpc("issue_form_prescription", {
      ...input,
      p_payload: { ...input.p_payload, notes: "changed" },
    });
    assert.equal(changed.status, 409);
    const anonymous = await new PostgrestClient(rest.base).rpc(
      "issue_form_prescription",
      input,
    );
    assert.equal(anonymous.status, 401);
  } finally {
    if (rest) await rest.stop();
    if (db) await db.stop();
  }
});
