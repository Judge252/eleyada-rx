import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { databaseTypes } from "../../scripts/database-types.mjs";
import { startTestDatabase } from "./local-postgres.mjs";

let database;
let owner;
const doctorSession = randomUUID();
const id = Object.fromEntries(
  [
    "doctor",
    "pharmacistA",
    "pharmacistB",
    "inactivePharmacist",
    "unassigned",
    "pharmacyA",
    "pharmacyB",
    "inactivePharmacy",
    "patient",
    "draftPatient",
    "draft",
    "issued",
    "cancelled",
    "expired",
    "pastExpiry",
    "already",
    "race",
    "itemRace",
  ].map((key) => [key, randomUUID()]),
);
const tables = [
  "pharmacies",
  "app_users",
  "patients",
  "prescriptions",
  "prescription_items",
  "dispensations",
  "audit_events",
];
const prescriptionColumns =
  "id, patient_id, doctor_user_id, status, issued_at, expires_at, doctor_notes, created_at, updated_at";
const medication = [
  "Synthetic medication — not for treatment",
  "Test strength",
  "Test dose",
  "Test frequency",
  "Test duration",
  2,
];

async function transaction(role, userId, operation, extraClaims = {}) {
  await owner.query("begin");
  try {
    assert.ok(
      ["authenticated", "anon", "postgres", "service_role"].includes(role),
    );
    await owner.query(`set local role ${role}`);
    await owner.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [
        userId ?? "",
        JSON.stringify({
          sub: userId,
          role,
          ...(userId === id.doctor ? { session_id: doctorSession } : {}),
          ...extraClaims,
        }),
      ],
    );
    return await operation(owner);
  } finally {
    await owner.query("rollback");
  }
}
const asDoctor = (operation) =>
  transaction("authenticated", id.doctor, operation);
const asPharmacist = (operation) =>
  transaction("authenticated", id.pharmacistA, operation);
const asOwner = (operation) => transaction("postgres", null, operation);
function rejectsState(promise, state) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.code, state, error.message);
    return true;
  });
}
async function insertItem(client, prescriptionId) {
  return client.query(
    `insert into public.prescription_items
    (prescription_id, medication_name, strength, dose, frequency, duration, quantity)
    values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [prescriptionId, ...medication],
  );
}
async function insertDispensation(
  client,
  prescriptionId,
  pharmacy = id.pharmacyA,
  pharmacist = id.pharmacistA,
) {
  return client.query(
    "insert into public.dispensations(prescription_id, pharmacy_id, pharmacist_user_id) values ($1,$2,$3) returning id",
    [prescriptionId, pharmacy, pharmacist],
  );
}

before(async () => {
  database = await startTestDatabase({ legacyDoctorFixtures: true });
  owner = database.owner;
  for (const user of [
    id.doctor,
    id.pharmacistA,
    id.pharmacistB,
    id.inactivePharmacist,
    id.unassigned,
  ]) {
    await owner.query("insert into auth.users(id) values ($1)", [user]);
  }
  await owner.query(
    `insert into public.pharmacies(id,name,is_active) values
    ($1,'Fictional pharmacy A',true),($2,'Fictional pharmacy B',true),($3,'Inactive fictional pharmacy',false)`,
    [id.pharmacyA, id.pharmacyB, id.inactivePharmacy],
  );
  await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    doctorSession,
    id.doctor,
  ]);
  await owner.query(
    `insert into public.app_users(id,role,pharmacy_id,is_active) values
    ($1,'doctor',null,true),($2,'pharmacist',$5,true),($3,'pharmacist',$6,true),($4,'pharmacist',$5,false)`,
    [
      id.doctor,
      id.pharmacistA,
      id.pharmacistB,
      id.inactivePharmacist,
      id.pharmacyA,
      id.pharmacyB,
    ],
  );
  await owner.query(
    "insert into public.patients(id,name,patient_identifier) values ($1,'Fictional verification subject','TEST-ONLY'),($2,'Fictional draft subject',null)",
    [id.patient, id.draftPatient],
  );
  for (const key of [
    "draft",
    "issued",
    "cancelled",
    "expired",
    "pastExpiry",
    "already",
    "race",
    "itemRace",
  ]) {
    await owner.query(
      "insert into public.prescriptions(id,patient_id,doctor_user_id) values ($1,$2,$3)",
      [id[key], key === "draft" ? id.draftPatient : id.patient, id.doctor],
    );
    await insertItem(owner, id[key]);
    if (key !== "draft" && key !== "itemRace") {
      const status = ["cancelled", "expired"].includes(key) ? key : "issued";
      // Trusted fixture setup only. No patient-facing code or issuance API exists.
      await owner.query(
        `update public.prescriptions set status=$2, issued_at=now()-interval '2 days',
        expires_at=now()+($4::integer * interval '1 day'), reference_digest=$3 where id=$1`,
        [
          id[key],
          status,
          randomBytes(32).toString("hex"),
          key === "pastExpiry" || key === "expired" ? -1 : 1,
        ],
      );
    }
  }
  await insertDispensation(owner, id.already);
  console.log(
    `Clean PostgreSQL ${(await owner.query("show server_version")).rows[0].server_version}; applied ${database.migrations.join(", ")}`,
  );
});
after(async () => {
  if (database) await database.stop();
});

test("clinical and clinic-access tables retain keys, RLS and dispensing uniqueness", async () => {
  const result = await owner.query(
    "select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename",
  );
  assert.deepEqual(
    result.rows.map((row) => row.tablename),
    [
      ...tables,
      "clinics",
      "prescribers",
      "clinic_memberships",
      "clinic_entitlements",
    ].sort(),
  );
  assert.ok(result.rows.every((row) => row.rowsecurity));
  const primaryKeys =
    await owner.query(`select table_name from information_schema.table_constraints
    where table_schema='public' and constraint_type='PRIMARY KEY'`);
  assert.equal(primaryKeys.rowCount, 11);
  const duplicate = await owner.query(
    "select contype from pg_constraint where conname='dispensations_one_per_prescription'",
  );
  assert.equal(duplicate.rows[0].contype, "u");
  const role = await asDoctor((client) =>
    client.query(
      "select current_user, current_setting('row_security') as rls, (select rolbypassrls from pg_roles where rolname=current_user) as bypass",
    ),
  );
  assert.deepEqual(role.rows[0], {
    current_user: "authenticated",
    rls: "on",
    bypass: false,
  });
});

test("generated database types match introspection of the applied migrations", async () => {
  assert.equal(
    await readFile("src/types/database.ts", "utf8"),
    await databaseTypes(database.pool),
  );
});

test("all anonymous application table reads and writes are denied by grants", async () => {
  for (const table of tables) {
    await rejectsState(
      transaction("anon", null, (client) =>
        client.query(`select id from public.${table}`),
      ),
      "42501",
    );
    await rejectsState(
      transaction("anon", null, (client) =>
        client.query(`delete from public.${table}`),
      ),
      "42501",
    );
  }
});

test("pharmacists cannot read patients, prescriptions, medication contents, other identities or dispensations", async () => {
  for (const table of [
    "patients",
    "prescriptions",
    "prescription_items",
    "dispensations",
  ]) {
    const result = await asPharmacist((client) =>
      client.query(`select id from public.${table}`),
    );
    assert.equal(result.rowCount, 0, table);
  }
  const identities = await asPharmacist((client) =>
    client.query("select id from public.app_users"),
  );
  assert.deepEqual(identities.rows, [{ id: id.pharmacistA }]);
  await rejectsState(
    asPharmacist((client) =>
      client.query("select id from public.audit_events"),
    ),
    "42501",
  );
});

test("unassigned and inactive identities have no clinical access, regardless of user-editable metadata", async () => {
  await owner.query("update auth.users set raw_user_meta_data=$2 where id=$1", [
    id.unassigned,
    { role: "doctor", pharmacy_id: id.pharmacyA },
  ]);
  for (const actor of [id.unassigned, id.inactivePharmacist, null]) {
    const rows = await transaction(
      "authenticated",
      actor,
      (client) => client.query("select id from public.patients"),
      { user_metadata: { role: "doctor" } },
    );
    assert.equal(rows.rowCount, 0);
  }
  await asOwner(async (client) => {
    await client.query(
      "update public.app_users set is_active=false where id=$1",
      [id.doctor],
    );
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id.doctor,
    ]);
    assert.equal(
      (await client.query("select id from public.patients")).rowCount,
      0,
    );
  });
});

test("no application role, including service_role, can provision roles or change pharmacy membership", async () => {
  for (const [role, actor] of [
    ["authenticated", id.pharmacistA],
    ["authenticated", id.doctor],
    ["authenticated", id.unassigned],
    ["service_role", null],
  ]) {
    await rejectsState(
      transaction(role, actor, (client) =>
        client.query(
          "update public.app_users set role='doctor',pharmacy_id=null where id=$1",
          [id.pharmacistA],
        ),
      ),
      "42501",
    );
    await rejectsState(
      transaction(role, actor, (client) =>
        client.query(
          "insert into public.app_users(id,role) values ($1,'doctor')",
          [id.unassigned],
        ),
      ),
      "42501",
    );
    await rejectsState(
      transaction(role, actor, (client) =>
        client.query("update public.app_users set pharmacy_id=$1 where id=$2", [
          id.pharmacyB,
          id.pharmacistA,
        ]),
      ),
      "42501",
    );
  }
});

test("doctor can create, read, edit and remove only synthetic drafts through RLS", async () => {
  await asDoctor(async (client) => {
    const patient = (
      await client.query(
        "insert into public.patients(name,patient_identifier) values ('Synthetic local draft patient',null) returning id",
      )
    ).rows[0].id;
    const draft = (
      await client.query(
        "insert into public.prescriptions(patient_id,doctor_user_id,doctor_notes) values ($1,$2,'Synthetic note') returning id,status",
        [patient, id.doctor],
      )
    ).rows[0];
    assert.equal(draft.status, "draft");
    const item = (await insertItem(client, draft.id)).rows[0].id;
    assert.equal(
      (
        await client.query(
          "update public.prescription_items set quantity=3 where id=$1 returning id",
          [item],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await client.query(
          "update public.prescriptions set doctor_notes='Changed synthetic note' where id=$1 returning id",
          [draft.id],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await client.query(
          `select ${prescriptionColumns} from public.prescriptions where id=$1`,
          [draft.id],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await client.query(
          "delete from public.prescriptions where id=$1 returning id",
          [draft.id],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await client.query(
          "select id from public.prescription_items where id=$1",
          [item],
        )
      ).rowCount,
      0,
    );
  });
});

test("pharmacist and unassigned user inserts are rejected by RLS even though authenticated has column grants", async () => {
  for (const actor of [id.pharmacistA, id.unassigned, id.inactivePharmacist]) {
    await rejectsState(
      transaction("authenticated", actor, (client) =>
        client.query(
          "insert into public.patients(name) values ('Synthetic forbidden patient')",
        ),
      ),
      "42501",
    );
    await rejectsState(
      transaction("authenticated", actor, (client) =>
        client.query(
          "insert into public.prescriptions(patient_id,doctor_user_id) values ($1,$2)",
          [id.patient, id.doctor],
        ),
      ),
      "42501",
    );
    await rejectsState(
      transaction("authenticated", actor, (client) =>
        insertItem(client, id.draft),
      ),
      "42501",
    );
  }
});

test("doctor cannot assign approval/status, digest, timestamps, another doctor or read digests", async () => {
  for (const sql of [
    "update public.prescriptions set status='issued' where id=$1",
    "update public.prescriptions set reference_digest=repeat('a',64) where id=$1",
    "update public.prescriptions set issued_at=now() where id=$1",
    "update public.prescriptions set created_at=now() where id=$1",
    "update public.prescriptions set doctor_user_id=gen_random_uuid() where id=$1",
    "select reference_digest from public.prescriptions where id=$1",
  ])
    await rejectsState(
      asDoctor((client) => client.query(sql, [id.draft])),
      "42501",
    );
  await rejectsState(
    asDoctor((client) =>
      client.query(
        "insert into public.prescriptions(patient_id,doctor_user_id,status) values ($1,$2,'issued')",
        [id.patient, id.doctor],
      ),
    ),
    "42501",
  );
});

test("doctor cannot change or delete issued header/items, and cannot alter linked patient verification fields", async () => {
  await asDoctor(async (client) => {
    assert.equal(
      (
        await client.query(
          "update public.prescriptions set doctor_notes='Forbidden' where id=$1",
          [id.issued],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query("delete from public.prescriptions where id=$1", [
          id.issued,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query(
          "update public.prescription_items set quantity=99 where prescription_id=$1",
          [id.issued],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query(
          "delete from public.prescription_items where prescription_id=$1",
          [id.issued],
        )
      ).rowCount,
      0,
    );
  });
  await rejectsState(
    asDoctor((client) => insertItem(client, id.issued)),
    "42501",
  );
  await rejectsState(
    asDoctor((client) =>
      client.query(
        "update public.patients set name='Changed identity' where id=$1",
        [id.patient],
      ),
    ),
    "23514",
  );
  await asDoctor(async (client) => {
    assert.equal(
      (
        await client.query(
          "update public.patients set name='Synthetic corrected draft name' where id=$1",
          [id.draftPatient],
        )
      ).rowCount,
      1,
    );
  });
});

test("issued/terminal prescription and item immutability also holds for trusted direct SQL", async () => {
  for (const prescriptionId of [id.issued, id.cancelled, id.expired]) {
    await rejectsState(
      asOwner((client) =>
        client.query(
          "update public.prescriptions set doctor_notes='Forbidden rewrite' where id=$1",
          [prescriptionId],
        ),
      ),
      "23514",
    );
    await rejectsState(
      asOwner((client) =>
        client.query("delete from public.prescriptions where id=$1", [
          prescriptionId,
        ]),
      ),
      "23514",
    );
    await rejectsState(
      asOwner((client) =>
        client.query(
          "update public.prescription_items set quantity=99 where prescription_id=$1",
          [prescriptionId],
        ),
      ),
      "23514",
    );
    await rejectsState(
      asOwner((client) =>
        client.query(
          "delete from public.prescription_items where prescription_id=$1",
          [prescriptionId],
        ),
      ),
      "23514",
    );
    await rejectsState(
      asOwner((client) => insertItem(client, prescriptionId)),
      "23514",
    );
  }
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.prescriptions set status='issued' where id=$1",
        [id.cancelled],
      ),
    ),
    "23514",
  );
});

test("foreign keys reject nonexistent auth users, pharmacies and patients", async () => {
  await rejectsState(
    asOwner((client) =>
      client.query(
        "insert into public.app_users(id,role,pharmacy_id) values ($1,'pharmacist',$2)",
        [randomUUID(), id.pharmacyA],
      ),
    ),
    "23503",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "insert into public.app_users(id,role,pharmacy_id) values ($1,'pharmacist',$2)",
        [id.unassigned, randomUUID()],
      ),
    ),
    "23503",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "insert into public.prescriptions(patient_id,doctor_user_id) values ($1,$2)",
        [randomUUID(), id.doctor],
      ),
    ),
    "23503",
  );
  await rejectsState(
    asOwner((client) => insertItem(client, randomUUID())),
    "23503",
  );
});

test("role/pharmacy combinations and reassignment are rejected; individual doctors are supported", async () => {
  for (const [role, pharmacy] of [
    ["doctor", id.pharmacyA],
    ["pharmacist", null],
  ]) {
    await rejectsState(
      asOwner((client) =>
        client.query(
          "insert into public.app_users(id,role,pharmacy_id) values ($1,$2,$3)",
          [id.unassigned, role, pharmacy],
        ),
      ),
      "23514",
    );
  }
  await asOwner((client) =>
    client.query("insert into public.app_users(id,role) values ($1,'doctor')", [
      id.unassigned,
    ]),
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "insert into public.app_users(id,role) values ($1,'administrator')",
        [id.unassigned],
      ),
    ),
    "22P02",
  );
  await rejectsState(
    asOwner((client) =>
      client.query("update public.app_users set pharmacy_id=$1 where id=$2", [
        id.pharmacyB,
        id.pharmacistA,
      ]),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "insert into public.prescriptions(patient_id,doctor_user_id) values ($1,$2)",
        [id.patient, id.pharmacistA],
      ),
    ),
    "23514",
  );
});

test("blank names, invalid quantity, digest format, duplicate digest, incomplete issued record and expiry ordering are rejected", async () => {
  await rejectsState(
    asOwner((client) =>
      client.query("insert into public.patients(name) values ('  ')"),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.prescription_items set quantity=0 where prescription_id=$1",
        [id.draft],
      ),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.prescriptions set reference_digest='DEMO-RX-1001' where id=$1",
        [id.draft],
      ),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.prescriptions set status='issued' where id=$1",
        [id.draft],
      ),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.prescriptions set status='issued',issued_at=now(),expires_at=now()-interval '1 hour',reference_digest=$2 where id=$1",
        [id.draft, randomBytes(32).toString("hex")],
      ),
    ),
    "23514",
  );
  const digest = (
    await owner.query(
      "select reference_digest from public.prescriptions where id=$1",
      [id.issued],
    )
  ).rows[0].reference_digest;
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.prescriptions set status='issued',issued_at=now(),reference_digest=$2 where id=$1",
        [id.draft, digest],
      ),
    ),
    "23505",
  );
  await rejectsState(
    asOwner(async (client) => {
      const blank = (
        await client.query(
          "insert into public.prescriptions(patient_id,doctor_user_id) values ($1,$2) returning id",
          [id.draftPatient, id.doctor],
        )
      ).rows[0].id;
      await client.query(
        "update public.prescriptions set status='issued',issued_at=now(),reference_digest=$2 where id=$1",
        [blank, randomBytes(32).toString("hex")],
      );
    }),
    "23514",
  );
});

test("client roles cannot record, amend or delete any dispensations", async () => {
  for (const [role, actor] of [
    ["authenticated", id.doctor],
    ["authenticated", id.pharmacistA],
    ["service_role", null],
  ]) {
    await rejectsState(
      transaction(role, actor, (client) =>
        insertDispensation(client, id.issued),
      ),
      "42501",
    );
    await rejectsState(
      transaction(role, actor, (client) =>
        client.query("delete from public.dispensations"),
      ),
      "42501",
    );
    await rejectsState(
      transaction(role, actor, (client) =>
        client.query("update public.dispensations set dispensed_at=now()"),
      ),
      "42501",
    );
  }
});

test("one successful complete dispensation is authoritative; sequential duplicate rejected", async () => {
  await rejectsState(
    asOwner((client) => insertDispensation(client, id.already)),
    "23505",
  );
  await asOwner(async (client) => {
    assert.equal((await insertDispensation(client, id.issued)).rowCount, 1);
    assert.equal(
      (
        await client.query(
          "select id from public.dispensations where prescription_id=$1",
          [id.issued],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await client.query(
          "select status from public.prescriptions where id=$1",
          [id.issued],
        )
      ).rows[0].status,
      "issued",
    );
  });
});

test("dispensations reject drafts, cancelled/expired records, mismatched membership and inactive participants", async () => {
  for (const prescriptionId of [
    id.draft,
    id.cancelled,
    id.expired,
    id.pastExpiry,
  ]) {
    await rejectsState(
      asOwner((client) => insertDispensation(client, prescriptionId)),
      "23514",
    );
  }
  await rejectsState(
    asOwner((client) =>
      insertDispensation(client, id.issued, id.pharmacyB, id.pharmacistA),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      insertDispensation(
        client,
        id.issued,
        id.pharmacyA,
        id.inactivePharmacist,
      ),
    ),
    "23514",
  );
  await rejectsState(
    asOwner(async (client) => {
      await client.query(
        "update public.pharmacies set is_active=false where id=$1",
        [id.pharmacyA],
      );
      await insertDispensation(client, id.issued);
    }),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "insert into public.dispensations(prescription_id,pharmacy_id,pharmacist_user_id,dispensed_at) values ($1,$2,$3,now()+interval '1 hour')",
        [id.issued, id.pharmacyA, id.pharmacistA],
      ),
    ),
    "23514",
  );
});

test("audit and dispensing histories are append-only and dispensed lifecycle cannot be cancelled silently", async () => {
  await rejectsState(
    asOwner((client) =>
      client.query(
        "delete from public.dispensations where prescription_id=$1",
        [id.already],
      ),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.dispensations set dispensed_at=now() where prescription_id=$1",
        [id.already],
      ),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query(
        "update public.prescriptions set status='cancelled' where id=$1",
        [id.already],
      ),
    ),
    "23514",
  );
  await rejectsState(
    asOwner((client) => client.query("delete from public.audit_events")),
    "23514",
  );
  await rejectsState(
    asOwner((client) =>
      client.query("update public.audit_events set metadata='{}'::jsonb"),
    ),
    "23514",
  );
});

test("audit triggers record the real actor and minimal safe metadata; patient-content metadata is rejected", async () => {
  let auditId;
  await asDoctor(async (client) => {
    auditId = (
      await client.query(
        "insert into public.patients(name) values ('Synthetic audit subject') returning id",
      )
    ).rows[0].id;
    // SET ROLE to the owner only to inspect audit storage, not to test RLS.
    await client.query("reset role");
    const event = (
      await client.query(
        "select actor_user_id, metadata from public.audit_events where entity_id=$1",
        [auditId],
      )
    ).rows[0];
    assert.equal(event.actor_user_id, id.doctor);
    assert.deepEqual(event.metadata, {});
  });
  await rejectsState(
    asOwner((client) =>
      client.query(
        "insert into public.audit_events(event_type,entity_type,entity_id,metadata) values ('test','patients',$1,$2)",
        [id.patient, { patient_name: "Do not store patient content here" }],
      ),
    ),
    "23514",
  );
  await rejectsState(
    asDoctor((client) =>
      client.query(
        "insert into public.audit_events(event_type,entity_type,entity_id) values ('spoof','patients',$1)",
        [id.patient],
      ),
    ),
    "42501",
  );
});

test("private helpers use fixed search paths and no public/anonymous executable mutating function exists", async () => {
  const functions = (
    await owner.query(`select p.proname, p.proconfig, has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as auth_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rx_private'`)
  ).rows;
  assert.ok(functions.length > 0);
  for (const fn of functions) {
    assert.ok(fn.proconfig.includes('search_path=""'));
    assert.equal(fn.anon_execute, false);
    assert.equal(
      fn.auth_execute,
      [
        "is_active_doctor",
        "has_active_session",
        "assert_lifecycle_doctor",
        "review_payload",
        "lifecycle_actor_id",
        "doctor_clinic",
        "patient_in_clinic",
      ].includes(fn.proname),
    );
  }
  await rejectsState(
    transaction("anon", null, (client) =>
      client.query("select rx_private.is_active_doctor()"),
    ),
    "42501",
  );
  assert.equal(
    (
      await asPharmacist((client) =>
        client.query("select rx_private.is_active_doctor() as allowed"),
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await asDoctor((client) =>
        client.query("select rx_private.is_active_doctor() as allowed"),
      )
    ).rows[0].allowed,
    true,
  );
});

test("pharmacist reads only their active pharmacy, with inactive and unassigned identities denied", async () => {
  const own = await asPharmacist((client) =>
    client.query("select id,name from public.pharmacies"),
  );
  assert.deepEqual(own.rows, [
    { id: id.pharmacyA, name: "Fictional pharmacy A" },
  ]);
  for (const actor of [id.inactivePharmacist, id.unassigned]) {
    const hidden = await transaction("authenticated", actor, (client) =>
      client.query("select id from public.pharmacies"),
    );
    assert.equal(hidden.rowCount, 0);
  }
  await asOwner(async (client) => {
    await client.query(
      "update public.pharmacies set is_active=false where id=$1",
      [id.pharmacyA],
    );
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id.pharmacistA,
    ]);
    assert.equal(
      (await client.query("select id from public.pharmacies")).rowCount,
      0,
    );
  });
});

test("session check accepts only the caller's non-expired session and rejects revocation", async () => {
  const sessionId = randomUUID();
  await asOwner(async (client) => {
    await client.query("insert into auth.sessions(id,user_id) values ($1,$2)", [
      sessionId,
      id.doctor,
    ]);
    await client.query("set local role authenticated");
    await client.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [id.doctor, JSON.stringify({ sub: id.doctor, session_id: sessionId })],
    );
    assert.equal(
      (await client.query("select public.has_active_session() as valid"))
        .rows[0].valid,
      true,
    );
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id.pharmacistA,
    ]);
    assert.equal(
      (await client.query("select public.has_active_session() as valid"))
        .rows[0].valid,
      false,
    );
    await client.query("reset role");
    await client.query(
      "update auth.sessions set not_after=now()-interval '1 minute' where id=$1",
      [sessionId],
    );
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id.doctor,
    ]);
    assert.equal(
      (await client.query("select public.has_active_session() as valid"))
        .rows[0].valid,
      false,
    );
    await client.query("reset role");
    await client.query("delete from auth.sessions where id=$1", [sessionId]);
    await client.query("set local role authenticated");
    assert.equal(
      (await client.query("select public.has_active_session() as valid"))
        .rows[0].valid,
      false,
    );
  });
  await rejectsState(
    transaction("anon", null, (client) =>
      client.query("select public.has_active_session()"),
    ),
    "42501",
  );
  await transaction(
    "authenticated",
    id.doctor,
    async (client) => {
      assert.equal(
        (await client.query("select public.has_active_session() as valid"))
          .rows[0].valid,
        false,
      );
    },
    { session_id: randomUUID() },
  );
});

test("concurrent database requests cannot dispense the same prescription twice", async () => {
  const first = await database.connect();
  const second = await database.connect();
  try {
    await first.query("begin");
    await second.query("begin");
    await insertDispensation(first, id.race);
    // Capture immediately to avoid an unhandled rejection once first commits.
    const competing = insertDispensation(
      second,
      id.race,
      id.pharmacyB,
      id.pharmacistB,
    ).then(
      () => null,
      (error) => error,
    );
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await owner.query(
        "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'insert into public.dispensations%'",
      );
      if (waiting.rowCount) {
        blocked = true;
        break;
      }
      await delay(10);
    }
    assert.ok(
      blocked,
      "A second live connection must actually compete for the uncommitted prescription",
    );
    await first.query("commit");
    const rejected = await competing;
    assert.equal(rejected?.code, "23505");
    await second.query("rollback");
    assert.equal(
      (
        await owner.query(
          "select id from public.dispensations where prescription_id=$1",
          [id.race],
        )
      ).rowCount,
      1,
    );
  } finally {
    await first.query("rollback");
    await second.query("rollback");
  }
});

test("item edits serialize with a competing lifecycle change and remain blocked afterward", async () => {
  const first = await database.connect();
  const second = await database.connect();
  try {
    await first.query("begin");
    await second.query("begin");
    await first.query(
      "update public.prescription_items set quantity=4 where prescription_id=$1",
      [id.itemRace],
    );
    const change = second.query(
      "update public.prescriptions set status='issued',issued_at=now(),reference_digest=$2 where id=$1",
      [id.itemRace, randomBytes(32).toString("hex")],
    );
    await first.query("commit");
    await change;
    await second.query("commit");
    await rejectsState(
      asOwner((client) =>
        client.query(
          "update public.prescription_items set quantity=5 where prescription_id=$1",
          [id.itemRace],
        ),
      ),
      "23514",
    );
    assert.equal(
      (
        await owner.query(
          "select quantity from public.prescription_items where prescription_id=$1",
          [id.itemRace],
        )
      ).rows[0].quantity,
      4,
    );
  } finally {
    await first.query("rollback");
    await second.query("rollback");
  }
});
