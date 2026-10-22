import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createNodeHost, findLanguage, introspect } from "@supabase/typegen";
import { format } from "prettier";
import { startTestDatabase } from "../tests/database/local-postgres.mjs";

export async function databaseTypes(client) {
  const metadata = await introspect(client, { includedSchemas: ["public"] });
  const language = findLanguage("typescript");
  const code = await language.generate(
    metadata,
    {},
    createNodeHost({
      cwd: process.cwd(),
      format: (code) => format(code, { parser: "typescript" }),
    }),
  );
  return (
    "// Generated from the applied SQL migrations using @supabase/typegen. Do not edit.\n" +
    code
  );
}

if (
  process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/database-types.mjs")
) {
  const database = await startTestDatabase();
  try {
    const code = await databaseTypes(database.pool);
    const path = "src/types/database.ts";
    if (process.argv.includes("--check")) {
      assert.equal(
        await readFile(path, "utf8"),
        code,
        "Database types drifted. Run npm run db:types.",
      );
      console.log("Database types match a clean migrated PostgreSQL database.");
    } else {
      await writeFile(path, code, "utf8");
      console.log(
        `Generated ${path} from a clean migrated PostgreSQL database.`,
      );
    }
  } finally {
    await database.stop();
  }
}
