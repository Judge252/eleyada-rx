import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { startTestDatabase } from "./local-postgres.mjs";
test("additive issuance migration applies as non-superuser CREATEROLE owner, then removes temporary SET and INHERIT authority", async () => {
  const db = await startTestDatabase({ applyMigrations: false });
  try {
    // Bootstrap postgres is protected against demotion/reassignment by PostgreSQL.
    // Instead apply all application migrations as a distinct non-superuser owner.
    await db.owner
      .query(`create role local_migration_owner nologin createrole bypassrls;
      grant create on database eyada_phase2_test to local_migration_owner;
      alter schema public owner to local_migration_owner;
      grant usage on schema auth,extensions,vault to local_migration_owner with grant option;
      grant execute on function auth.uid(),auth.jwt(),extensions.digest(text,text) to local_migration_owner with grant option;
      grant select,references on auth.users,auth.sessions to local_migration_owner;
      grant select on vault.decrypted_secrets,vault.secrets to local_migration_owner;
      grant execute on function vault.create_secret(text,text,text,uuid) to local_migration_owner;
      set role local_migration_owner`);
    for (const file of db.migrations)
      await db.owner.query(
        await readFile(`supabase/migrations/${file}`, "utf8"),
      );
    const result = (
      await db.owner.query(
        "select pg_has_role('local_migration_owner','rx_lifecycle_executor','SET') as member,pg_has_role('local_migration_owner','rx_lifecycle_executor','USAGE') as inherited,(select rolcanlogin from pg_roles where rolname='rx_lifecycle_executor') as login",
      )
    ).rows[0];
    assert.equal(result.member, false);
    assert.equal(result.inherited, false);
    assert.equal(result.login, false);
  } finally {
    await db.stop();
  }
});
