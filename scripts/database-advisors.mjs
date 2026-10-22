import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startTestDatabase } from "../tests/database/local-postgres.mjs";

// Runs only against a freshly created, isolated local PostgreSQL test database.
// Password is passed through the child environment, never through arguments/logs.
const database = await startTestDatabase();
try {
  const url = `postgresql://postgres@127.0.0.1:${database.connection.port}/eyada_phase2_test?sslmode=disable`;
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [
      "node_modules/supabase/dist/supabase.js",
      "db",
      "advisors",
      "--db-url",
      url,
      "--type",
      "security",
      "--level",
      "warn",
      "--fail-on",
      "warn",
    ],
    {
      env: { ...process.env, PGPASSWORD: database.connection.password },
      maxBuffer: 1024 * 1024,
    },
  );
  console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
} catch (error) {
  console.error(
    error.stdout?.trim() ||
      error.stderr?.trim() ||
      "Local Supabase advisors could not complete.",
  );
  process.exitCode = 1;
} finally {
  await database.stop();
}
