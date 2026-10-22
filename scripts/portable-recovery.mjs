// Trusted-operator library. No application import, service key, root export or root PUT.
import pg from "pg";
import { createHash } from "node:crypto";
import {
  createArchive,
  readArchive,
  recordHash,
  requireSafe,
  RecoveryError,
} from "./recovery-archive.mjs";
import {
  APP_TABLES,
  catalog,
  qualified,
  qid,
  restoreOrder,
  rows,
} from "./recovery-catalog.mjs";
export const SOURCE = "fckdsiozmufyhbnignet";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (s) => createHash("sha256").update(s).digest("hex");
function connectionShape(connection) {
  requireSafe(
    connection &&
      Object.keys(connection).every((k) =>
        ["host", "port", "user", "password", "database", "ssl"].includes(k),
      ) &&
      typeof connection.host === "string" &&
      typeof connection.password === "string" &&
      connection.password.length > 0 &&
      connection.password.length <= 4096,
    "CONNECTION_FIELDS",
  );
  if (connection.ssl)
    requireSafe(
      Object.keys(connection.ssl).every((k) =>
        ["rejectUnauthorized", "ca"].includes(k),
      ) &&
        (!connection.ssl.ca ||
          (typeof connection.ssl.ca === "string" &&
            connection.ssl.ca.length <= 16384)),
      "TLS_FIELDS",
    );
}
function checkpoint(signal) {
  requireSafe(!signal?.aborted, "INTERRUPTED");
}
export function identifyEndpoint(connection, ref) {
  connectionShape(connection);
  requireSafe(/^[a-z]{20}$/.test(ref), "PROJECT_REFERENCE");
  requireSafe(
    connection?.database === "postgres" &&
      connection.port === 5432 &&
      connection.ssl?.rejectUnauthorized === true,
    "DIRECT_OR_SESSION_TLS_REQUIRED",
  );
  requireSafe(
    connection.host === `db.${ref}.supabase.co` ||
      (connection.host?.endsWith(".pooler.supabase.com") &&
        connection.user === `postgres.${ref}`),
    "PROJECT_ENDPOINT_MISMATCH",
  );
  requireSafe(
    connection.user === "postgres" || connection.user === `postgres.${ref}`,
    "TRUSTED_OPERATOR_REQUIRED",
  );
}
async function clientFor(connection) {
  connectionShape(connection);
  // Startup options take effect before statements. Query-client timeouts are NOT relied on.
  const c = new pg.Client({
    ...connection,
    application_name: "al-eyada-rx-approved-recovery",
    connectionTimeoutMillis: 10000,
    query_timeout: 12000,
    options:
      "-c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=60000 -c transaction_timeout=900000",
  });
  c.on("error", () => {}); // Operational errors are converted to non-secret status codes.
  await c.connect();
  return c;
}
async function closeClient(c) {
  await c.query("rollback").catch(() => {});
  let timer;
  try {
    await Promise.race([
      c.end(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          c.connection?.stream?.destroy();
          resolve();
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function guard(c) {
  const value = (
    await c.query(
      "select current_setting('statement_timeout') as timeout,current_setting('lock_timeout') as locks",
    )
  ).rows[0];
  requireSafe(
    value.timeout === "10s" && value.locks === "1s",
    "OPERATOR_TIMEOUT_NOT_EFFECTIVE",
  );
}
async function safety(c) {
  const r = (
    await c.query(`select
 (select count(*) from rx_private.issuance_receipts r left join vault.decrypted_secrets v on v.id=r.vault_secret_id where v.id is null or v.name<>'al_eyada_rx.reference.'||r.prescription_id::text) as bad_links,
 (select count(*) from public.prescriptions p left join rx_private.issuance_receipts r on r.prescription_id=p.id where (p.status<>'draft')<>(r.prescription_id is not null)) as bad_receipts,
 (select count(*) from vault.secrets where name is null or (name<>'al_eyada_rx.lookup.v1' and name not like 'al_eyada_rx.reference.%')) as unrelated,
 (select count(*) from vault.secrets where name='al_eyada_rx.lookup.v1') as keys,
 (select count(*) from rx_private.issuance_receipts) as issued,
 (select count(*) from vault.secrets where name like 'al_eyada_rx.reference.%') as references,
 (select count(*) from public.prescriptions p join rx_private.issuance_receipts r on r.prescription_id=p.id join vault.decrypted_secrets v on v.id=r.vault_secret_id where p.reference_digest is distinct from rx_private.reference_digest(v.decrypted_secret)) as digest_mismatches,
 (select count(*) from vault.decrypted_secrets where name='al_eyada_rx.lookup.v1' and decrypted_secret !~ '^[0-9a-f]{64}$') as bad_key`)
  ).rows[0];
  requireSafe(
    +r.bad_links === 0 &&
      +r.bad_receipts === 0 &&
      +r.unrelated === 0 &&
      +r.references === +r.issued &&
      +r.keys <= 1 &&
      (!+r.issued || +r.keys === 1) &&
      +r.digest_mismatches === 0 &&
      +r.bad_key === 0,
    "SECRET_RECEIPT_INTEGRITY",
  );
  return { keys: +r.keys, references: +r.references };
}
async function immutableLocks(c, tables, mode) {
  // Freeze DDL during capture; exclusive target locks prevent competing writes during restore.
  await c.query(
    `lock table ${tables.map((t) => qualified(t.name)).join(",")} in ${mode} mode`,
  );
}
function tableHash() {
  const h = createHash("sha256");
  return {
    add(data) {
      h.update(data);
      h.update("\n");
    },
    digest() {
      return h.digest("hex");
    },
  };
}
export async function capture({
  connection,
  project = SOURCE,
  path,
  passphrase,
  adapter = false,
  signal,
  onSnapshot,
}) {
  let c, writer;
  let published = false;
  try {
    if (!adapter) {
      requireSafe(project === SOURCE, "SOURCE_PROJECT_MISMATCH");
      identifyEndpoint(connection, project);
    } else
      requireSafe(
        connection.host === "127.0.0.1" && project === "local-source",
        "LOCAL_ADAPTER_ONLY",
      );
    c = await clientFor(connection);
    await guard(c);
    await c.query("begin isolation level repeatable read read only");
    let state = await catalog(c, { adapter });
    await immutableLocks(c, state.profile.tables, "access share");
    // The catalog and ALL content reads below share this one MVCC snapshot/connection.
    const check = await catalog(c, { adapter });
    requireSafe(
      JSON.stringify(check) === JSON.stringify(state),
      "CAPTURE_CATALOG_CHANGED",
    );
    state = check;
    const secrets = await safety(c);
    const snapshot = (
      await c.query("select pg_current_snapshot()::text as value")
    ).rows[0].value;
    const manifest = {
      kind: "manifest",
      format: 1,
      project,
      capturedAt: new Date().toISOString(),
      snapshot,
      ...state,
      secrets,
      excludedAuth: state.profile.tables
        .filter((t) => t.disposition === "omit_live_auth")
        .map((t) => t.name),
      authPolicy: "fresh-sign-in-no-sessions-reset-user-tokens",
      sequencePolicy:
        "no-durable-sequences;refresh-token-sequence-not-restored",
    };
    writer = await createArchive(path, passphrase);
    const stream = recordHash(),
      tables = {};
    async function emit(record) {
      checkpoint(signal);
      stream.add(record);
      await writer.write(record);
    }
    await emit(manifest);
    await onSnapshot?.();
    // Ciphertext archive preserves original artifacts for provider-assisted recovery only.
    const cipherTable = state.profile.tables.find(
      (t) => t.name === "vault.secrets",
    );
    for await (const data of rows(c, cipherTable))
      await emit({ kind: "ciphertext", data });
    await c.query(
      "declare rx_secrets no scroll cursor for select id::text as old_id,name,description,decrypted_secret as value from vault.decrypted_secrets where name='al_eyada_rx.lookup.v1' or name like 'al_eyada_rx.reference.%' order by id",
    );
    try {
      while (true) {
        checkpoint(signal);
        const row = (await c.query("fetch 1 from rx_secrets")).rows[0];
        if (!row) break;
        requireSafe(row.value?.length <= 80, "SECRET_SIZE_LIMIT");
        await emit({ kind: "secret", ...row });
        row.value = null;
      }
    } finally {
      await c.query("close rx_secrets").catch(() => {});
    }
    for (const t of restoreOrder(state.profile.tables)) {
      const hash = tableHash();
      let count = 0;
      for await (const data of rows(c, t)) {
        await emit({ kind: "row", table: t.name, data });
        hash.add(data);
        count++;
      }
      requireSafe(
        String(count) === state.counts[t.name],
        "CAPTURE_COUNT_MISMATCH",
      );
      tables[t.name] = { count, sha256: hash.digest() };
    }
    await writer.write({
      kind: "complete",
      streamHash: stream.digest(),
      tables,
    });
    checkpoint(signal);
    await c.query("commit");
    await writer.seal();
    await writer.publish();
    published = true;
    return {
      status: "CAPTURED_ENCRYPTED",
      project,
      tables: Object.fromEntries(
        Object.entries(tables).map(([name, t]) => [name, t.count]),
      ),
      secrets,
      adapter,
    };
  } catch (e) {
    if (e instanceof RecoveryError) throw e;
    throw new RecoveryError("CAPTURE_FAILED_NO_PLAINTEXT_OUTPUT");
  } finally {
    if (c) {
      await closeClient(c);
    }
    if (writer && !published) await writer.abort();
  }
}
async function emptyTarget(c, state) {
  for (const t of state.profile.tables)
    if (
      !["platform_schema_version", "migration_history"].includes(t.disposition)
    )
      requireSafe(state.counts[t.name] === "0", "TARGET_NOT_EMPTY");
  const active = (
    await c.query(
      "select count(*)::int as n from pg_stat_activity where pid<>pg_backend_pid() and state='active' and (application_name ilike 'PostgREST%' or application_name ilike '%gotrue%' or usename in ('authenticator','supabase_auth_admin'))",
    )
  ).rows[0].n;
  requireSafe(active === 0, "TARGET_NOT_ISOLATED");
}
async function prepareInsert(c, t) {
  const columns = t.columns
    .filter((col) => !col.generated)
    .map((col) => qid(col.name))
    .join(",");
  let select = `select ${columns} from jsonb_populate_record(null::${qualified(t.name)},p_data::jsonb)`;
  if (t.name === "rx_private.issuance_receipts")
    select = `select ${columns} from jsonb_populate_record(null::${qualified(t.name)},p_data::jsonb||jsonb_build_object('vault_secret_id',(select new_id from pg_temp.rx_restore_map where old_id=(p_data::jsonb->>'vault_secret_id')::uuid)))`;
  // Catch conversion/constraint details inside DB so clinical field values are not error messages.
  await c.query(
    `create or replace function pg_temp.rx_insert_row(p_data text) returns void language plpgsql set search_path='' as $$begin insert into ${qualified(t.name)}(${columns}) ${select};exception when others then raise exception 'Recovery row rejected' using errcode='P0001';end$$;revoke all on function pg_temp.rx_insert_row(text) from public,anon,authenticated,service_role;`,
  );
}
async function restoreTriggers(c, tables, enabled) {
  for (const t of tables.filter((t) => APP_TABLES.includes(t.name))) {
    requireSafe(t.owner === "postgres" && t.rls, "APP_OWNER_OR_RLS_MISMATCH");
    for (const trigger of (t.triggers ?? []).filter((g) => !g.internal)) {
      requireSafe(
        ["O", "A", "R", "D"].includes(trigger.enabled),
        "TRIGGER_MODE",
      );
      const setting = enabled
        ? {
            O: "enable",
            A: "enable always",
            R: "enable replica",
            D: "disable",
          }[trigger.enabled]
        : "disable";
      await c.query(
        `alter table ${qualified(t.name)} ${setting} trigger ${qid(trigger.name)}`,
      );
    }
  }
}
export async function restore({
  connection,
  target,
  path,
  receiptPath,
  passphrase,
  adapter = false,
  isolated = false,
  signal,
  onBeforeCommit,
  verifyOnly = false,
}) {
  let c,
    receipt,
    commitStarted = false,
    committed = false,
    published = false;
  try {
    requireSafe(
      isolated === true && target !== SOURCE,
      "EXPLICIT_ISOLATED_TARGET_REQUIRED",
    );
    requireSafe(
      typeof verifyOnly === "boolean",
      "EXPLICIT_RESTORE_MODE_REQUIRED",
    );
    if (adapter)
      requireSafe(
        connection.host === "127.0.0.1" && target === "local-target",
        "LOCAL_ADAPTER_ONLY",
      );
    else identifyEndpoint(connection, target);
    requireSafe(path !== receiptPath, "SEPARATE_RECEIPT_PATH_REQUIRED");
    const iterator = readArchive(path, passphrase, { signal })[
      Symbol.asyncIterator
    ]();
    try {
      const first = await iterator.next();
      const manifest = first.value;
      requireSafe(
        manifest?.kind === "manifest" &&
          manifest.format === 1 &&
          manifest.project === (adapter ? "local-source" : SOURCE) &&
          manifest.authPolicy === "fresh-sign-in-no-sessions-reset-user-tokens",
        "ARCHIVE_MANIFEST",
      );
      c = await clientFor(connection);
      await guard(c);
      await c.query("begin isolation level read committed");
      const beforeLocks = await catalog(c, { adapter });
      await immutableLocks(c, beforeLocks.profile.tables, "access exclusive");
      // Fresh snapshot AFTER every target data table is locked, preventing a stale empty check.
      const state = await catalog(c, { adapter });
      requireSafe(
        JSON.stringify(beforeLocks.profile) === JSON.stringify(state.profile),
        "TARGET_CATALOG_CHANGED",
      );
      await emptyTarget(c, state);
      requireSafe(
        JSON.stringify(manifest.profile) === JSON.stringify(state.profile),
        "INCOMPATIBLE_TARGET",
      );
      requireSafe(
        manifest.migrationRows === state.migrationRows,
        "PREPARED_TARGET_HISTORY_MISMATCH",
      );
      const sourceTables = manifest.profile.tables;
      const order = restoreOrder(sourceTables),
        hashes = new Map(order.map((t) => [t.name, tableHash()])),
        counts = Object.fromEntries(order.map((t) => [t.name, 0]));
      const stream = recordHash();
      stream.add(manifest);
      let secretCount = 0,
        cipherCount = 0,
        done = false,
        index = 0,
        lastTable = null,
        secretPhase = false,
        rowsPhase = false,
        expectedTables;
      receipt = await createArchive(receiptPath, passphrase);
      await receipt.write({
        kind: "restore_manifest",
        format: 1,
        source: manifest.project,
        target,
        sourceManifestHash: digest(JSON.stringify(manifest)),
        createdAt: new Date().toISOString(),
        status: "prepared-before-commit",
      });
      await c.query(
        "create temporary table rx_restore_map(old_id uuid primary key,new_id uuid not null unique,name text not null unique,value_hash text not null) on commit drop",
      );
      await c.query(
        `create function pg_temp.rx_rewrap(old_id uuid,value text,name text,description text) returns uuid language plpgsql set search_path='' as $$declare result uuid;begin result:=vault.create_secret(value,name,description);insert into pg_temp.rx_restore_map values(old_id,result,name,encode(extensions.digest(value,'sha256'),'hex'));return result;exception when others then raise exception 'Recovery secret rejected' using errcode='P0001';end$$;revoke all on function pg_temp.rx_rewrap(uuid,text,text,text) from public,anon,authenticated,service_role;`,
      );
      await restoreTriggers(c, sourceTables, false);
      while (true) {
        checkpoint(signal);
        const next = await iterator.next();
        if (next.done) break;
        const record = next.value;
        requireSafe(!done, "ARCHIVE_TRAILING_RECORD");
        if (record.kind === "complete") {
          requireSafe(
            record.streamHash === stream.digest(),
            "ARCHIVE_MANIFEST_HASH",
          );
          for (const t of order) {
            requireSafe(
              record.tables?.[t.name]?.count === counts[t.name] &&
                record.tables[t.name].sha256 === hashes.get(t.name).digest() &&
                String(counts[t.name]) === manifest.counts[t.name],
              "ARCHIVE_ROW_MANIFEST",
            );
          }
          requireSafe(
            Object.keys(record.tables ?? {}).length === order.length &&
              String(cipherCount) === manifest.counts["vault.secrets"] &&
              secretCount ===
                manifest.secrets.keys + manifest.secrets.references &&
              secretCount === cipherCount,
            "ARCHIVE_SECRET_MANIFEST",
          );
          expectedTables = record.tables;
          done = true;
          continue;
        }
        stream.add(record);
        if (record.kind === "ciphertext") {
          requireSafe(
            !secretPhase && !rowsPhase && typeof record.data === "string",
            "ARCHIVE_RECORD_ORDER",
          );
          JSON.parse(record.data);
          cipherCount++;
          requireSafe(cipherCount <= 100000, "ARTIFACT_LIMIT");
          continue;
        }
        if (record.kind === "secret") {
          requireSafe(
            !rowsPhase &&
              uuid.test(record.old_id) &&
              typeof record.value === "string" &&
              record.value.length <= 80,
            "ARCHIVE_SECRET",
          );
          secretPhase = true;
          requireSafe(
            record.name === "al_eyada_rx.lookup.v1" ||
              /^al_eyada_rx\.reference\.[0-9a-f-]{36}$/.test(record.name),
            "SECRET_NAMESPACE",
          );
          const value = (
            await c.query("select pg_temp.rx_rewrap($1,$2,$3,$4) as id", [
              record.old_id,
              record.value,
              record.name,
              record.description ?? "",
            ])
          ).rows[0].id;
          await receipt.write({
            kind: "vault_id_map",
            oldId: record.old_id,
            newId: value,
            name: record.name,
          });
          record.value = null;
          secretCount++;
          continue;
        }
        requireSafe(
          record.kind === "row" && typeof record.data === "string",
          "ARCHIVE_RECORD",
        );
        rowsPhase = true;
        while (index < order.length && order[index].name !== record.table) {
          requireSafe(
            String(counts[order[index].name]) ===
              manifest.counts[order[index].name],
            "ARCHIVE_TABLE_ORDER",
          );
          index++;
        }
        requireSafe(index < order.length, "ARCHIVE_UNKNOWN_TABLE");
        if (lastTable !== record.table) {
          await prepareInsert(c, order[index]);
          lastTable = record.table;
        }
        await c.query("select pg_temp.rx_insert_row($1)", [record.data]);
        hashes.get(record.table).add(record.data);
        counts[record.table]++;
      }
      requireSafe(done, "ARCHIVE_INCOMPLETE");
      await restoreTriggers(c, sourceTables, true);
      const verified = await catalog(c, { adapter });
      requireSafe(
        JSON.stringify(verified.profile) === JSON.stringify(manifest.profile),
        "RESTORED_SECURITY_METADATA_MISMATCH",
      );
      for (const t of order) {
        requireSafe(
          verified.counts[t.name] === manifest.counts[t.name],
          "RESTORED_COUNT_MISMATCH",
        );
        const actualHash = tableHash();
        for await (const data of rows(c, t, { mapVaultIds: true }))
          actualHash.add(data);
        requireSafe(
          expectedTables[t.name].sha256 === actualHash.digest(),
          "RESTORED_VALUE_MISMATCH",
        );
      }
      for (const t of sourceTables.filter(
        (t) => t.disposition === "omit_live_auth",
      ))
        requireSafe(
          verified.counts[t.name] === "0",
          "LIVE_AUTH_STATE_RESTORED",
        );
      requireSafe(
        (
          await c.query(
            "select count(*)::int as n from pg_temp.rx_restore_map m join vault.decrypted_secrets v on v.id=m.new_id where m.name<>v.name or m.value_hash<>encode(extensions.digest(v.decrypted_secret,'sha256'),'hex')",
          )
        ).rows[0].n === 0,
        "REWRAPPED_SECRET_MISMATCH",
      );
      await safety(c);
      checkpoint(signal);
      await onBeforeCommit?.(c);
      await receipt.write({
        kind: "restore_verified",
        counts,
        secretCount,
        securityEqual: true,
        valuesEqual: true,
        freshSignInRequired: true,
        outcome: verifyOnly
          ? "verified-then-rolled-back"
          : "prepared-for-commit-outcome-requires-database-verification",
      });
      await receipt.seal();
      checkpoint(signal);
      if (verifyOnly) {
        await c.query("rollback");
        await receipt.publish();
        published = true;
        return {
          status: "RESTORE_VERIFIED_ROLLED_BACK",
          target,
          counts,
          secretCount,
          mappingReceipt: receiptPath,
          adapter,
          freshSignInRequired: true,
        };
      }
      commitStarted = true;
      await c.query("commit");
      committed = true;
      await receipt.publish();
      published = true;
      return {
        status: "RESTORED",
        target,
        counts,
        secretCount,
        mappingReceipt: receiptPath,
        adapter,
        freshSignInRequired: true,
      };
    } finally {
      await iterator.return?.();
    }
  } catch (e) {
    if (commitStarted)
      throw new RecoveryError(
        committed
          ? "RESTORE_COMMITTED_RECEIPT_PUBLICATION_PENDING"
          : "RESTORE_COMMIT_OUTCOME_UNKNOWN_INSPECT_TARGET",
      );
    if (c) {
      const acknowledged = await c.query("rollback").then(
        () => true,
        () => false,
      );
      if (!acknowledged)
        throw new RecoveryError(
          "RESTORE_UNCOMMITTED_ROLLBACK_NOT_CONFIRMED_INSPECT_TARGET",
        );
    }
    if (e instanceof RecoveryError) throw e;
    throw new RecoveryError("RESTORE_FAILED_ROLLED_BACK");
  } finally {
    if (c) {
      await closeClient(c);
    }
    // Once COMMIT was sent, keep the encrypted prepared mapping receipt for inspection.
    if (receipt && !published) await receipt.abort({ retain: commitStarted });
  }
}
