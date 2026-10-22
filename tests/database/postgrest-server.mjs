// Disposable local transport only. JWT secret/DB credentials are random and memory-only.
import { spawn } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import { resolve } from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
export async function localPostgrest(
  db,
  { user, password, allowRollback = false },
) {
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const secret = randomBytes(32).toString("hex");
  const pathKey =
    Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const processHandle = spawn(".local/postgrest/postgrest.exe", [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      [pathKey]: `${resolve("node_modules/@embedded-postgres/windows-x64/native/bin")};${process.env[pathKey]}`,
      PGPASSWORD: password,
      PGRST_DB_URI: `postgresql://${user}@127.0.0.1:${db.connection.port}/${db.connection.database}`,
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_DB_SCHEMAS: "public",
      PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_HOISTED_TX_SETTINGS: "statement_timeout",
      PGRST_LOG_LEVEL: "crit",
      PGRST_DB_TX_END: allowRollback ? "commit-allow-override" : "commit",
    },
  });
  let failed = false;
  processHandle.on("error", () => (failed = true));
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 100; n++) {
    if (failed) throw Error("LOCAL_POSTGREST_UNAVAILABLE");
    if (
      await fetch(base, { signal: AbortSignal.timeout(200) }).then(
        (r) => r.status === 200,
        () => false,
      )
    )
      break;
    if (n === 99) {
      processHandle.kill();
      throw Error("LOCAL_POSTGREST_NOT_READY");
    }
    await delay(100);
  }
  return {
    base,
    token: (claims) => {
      const parts = [
        Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
          "base64url",
        ),
        Buffer.from(
          JSON.stringify({
            ...claims,
            exp: Math.floor(Date.now() / 1000) + 600,
          }),
        ).toString("base64url"),
      ];
      return (
        parts.join(".") +
        "." +
        createHmac("sha256", secret).update(parts.join(".")).digest("base64url")
      );
    },
    stop: async () => {
      if (processHandle.exitCode === null) {
        const ended = new Promise((r) => processHandle.once("exit", r));
        processHandle.kill();
        await ended;
      }
    },
  };
}
