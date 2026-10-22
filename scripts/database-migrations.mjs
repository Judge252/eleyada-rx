import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startTestDatabase } from "../tests/database/local-postgres.mjs";

// Verify the actual CLI migration/history path on a new isolated database only.
// This script has no external-URL or linked-project input.
const database = await startTestDatabase({ applyMigrations: false });
try {
  const url = `postgresql://postgres@127.0.0.1:${database.connection.port}/eyada_phase2_test?sslmode=disable`;
  const options = {
    env: { ...process.env, PGPASSWORD: database.connection.password },
    maxBuffer: 1024 * 1024,
  };
  const run = promisify(execFile);
  const applied = await run(
    process.execPath,
    [
      "node_modules/supabase/dist/supabase.js",
      "db",
      "push",
      "--db-url",
      url,
      "--skip-vault",
    ],
    options,
  );
  console.log(applied.stdout.trim());
  const history = await database.owner.query(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  assert.deepEqual(
    history.rows.map((row) => row.version),
    database.migrations.map((name) => name.split("_")[0]),
  );
  const tables = await database.owner.query(
    "select count(*)::integer as count from pg_tables where schemaname='public' and rowsecurity",
  );
  assert.equal(tables.rows[0].count, 7);
  const listed = await run(
    process.execPath,
    [
      "node_modules/supabase/dist/supabase.js",
      "migration",
      "list",
      "--db-url",
      url,
    ],
    options,
  );
  console.log(listed.stdout.trim());
  console.log(
    "Supabase CLI applied the migration and verified its history on an isolated loopback database.",
  );
} catch (error) {
  console.error(error.stdout?.trim() || error.stderr?.trim() || error.message);
  process.exitCode = 1;
} finally {
  await database.stop();
}
