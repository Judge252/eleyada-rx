import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { startTestDatabase } from "./local-postgres.mjs";

const count = async (c) =>
  +(await c.query("select count(*) as n from public.timeout_marks")).rows[0].n;
async function ended(c, pid) {
  const r = await c.query(
    "select state,exists(select 1 from pg_locks where pid=$1 and locktype='transactionid' and mode='ExclusiveLock') as writing from pg_stat_activity where pid=$1",
    [pid],
  );
  assert.ok(
    !r.rows.length || r.rows[0].state !== "active",
    "Independent observer confirms execution ended",
  );
  assert.ok(
    !r.rows.length || !r.rows[0].writing,
    "No retained transaction write lock",
  );
}
test("effective deadlines: reproduce function SET gap; separate outer SET aborts slow work and rolls back", async () => {
  const db = await startTestDatabase(),
    c = await db.connect();
  try {
    await db.owner.query(`create table public.timeout_marks(id int);
 create function public.timeout_slow() returns void language plpgsql set statement_timeout='100ms' as $$begin insert into public.timeout_marks values(1); perform pg_sleep(0.4); end$$;`);
    await c.query("set statement_timeout='2s'");
    const before = performance.now();
    await c.query("select public.timeout_slow()");
    const reproduced = performance.now() - before;
    assert.ok(
      reproduced >= 350 && reproduced < 2000,
      "Function setting alone did not enforce 100ms",
    );
    assert.equal(await count(db.owner), 1);
    await db.owner.query("delete from public.timeout_marks");
    const pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid;
    await c.query("begin");
    // Separate protocol round trip before the OUTER statement, like PostgREST hoisting.
    await c.query("set local statement_timeout='150ms'");
    const start = performance.now();
    await assert.rejects(
      c.query("select public.timeout_slow()"),
      (e) => e.code === "57014",
    );
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed >= 100 && elapsed < 1500,
      "Server stopped non-lock slow work",
    );
    await c.query("rollback");
    assert.equal(await count(db.owner), 0);
    await ended(db.owner, pid);
    console.log(
      JSON.stringify({
        evidence: "local-postgresql",
        functionOnlyMs: Math.round(reproduced),
        outerTimeoutMs: Math.round(elapsed),
        rollback: true,
        independentEnd: true,
      }),
    );
  } finally {
    await c.end();
    await db.stop();
  }
});

test("prepared native probe SQL is transactional; client read timeout alone leaves SQL executing until the server deadline", async () => {
  const db = await startTestDatabase(),
    c = await db.connect();
  try {
    await db.owner.query(
      await readFile(
        "supabase/operations/phase4b_native_vault_probe.sql",
        "utf8",
      ),
    );
    assert.equal(
      +(await db.owner.query("select count(*) as n from vault.secrets")).rows[0]
        .n,
      0,
    );
    await db.owner.query(
      await readFile(
        "supabase/operations/phase4b_deadline_probe_install.sql",
        "utf8",
      ),
    );
    const doctor = randomUUID(),
      session = randomUUID();
    await db.owner.query("insert into auth.users(id) values($1)", [doctor]);
    await db.owner.query(
      "insert into auth.sessions(id,user_id) values($1,$2)",
      [session, doctor],
    );
    await db.owner.query(
      "insert into public.app_users(id,role) values($1,'doctor')",
      [doctor],
    );
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: doctor,
        session_id: session,
        role: "authenticated",
      }),
    ]);
    await c.query("set local statement_timeout='100ms'");
    await assert.rejects(
      c.query("select public.phase4b_deadline_probe()"),
      (e) => e.code === "57014",
    );
    await c.query("rollback");
    assert.equal(
      +(
        await db.owner.query(
          "select count(*) as n from rx_private.phase4b_deadline_probe_marks",
        )
      ).rows[0].n,
      0,
    );
    await db.owner.query(
      await readFile(
        "supabase/operations/phase4b_deadline_probe_cleanup.sql",
        "utf8",
      ),
    );
    // A driver read timer abandons the wait, not the server statement. No cancel endpoint.
    await db.owner.query(
      "create table public.timeout_marks(id int);create function public.timeout_client() returns void language plpgsql as $$begin insert into public.timeout_marks values(1);perform pg_sleep(1.5);end$$",
    );
    const pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid;
    await c.query("set statement_timeout='700ms'");
    await assert.rejects(
      c.query({ text: "select public.timeout_client()", query_timeout: 40 }),
      (e) => e.message === "Query read timeout",
    );
    const active = (
      await db.owner.query("select state from pg_stat_activity where pid=$1", [
        pid,
      ])
    ).rows[0].state;
    assert.equal(active, "active", "Client timeout did not end SQL");
    // Queue an independent round-trip; server deadline ends the earlier query first.
    await c.query("select 1");
    await ended(db.owner, pid);
    assert.equal(await count(db.owner), 0);
    console.log(
      JSON.stringify({
        evidence: "client-timer-is-not-cancellation",
        activeAfterClientTimer: true,
        serverEnded: true,
        rollback: true,
        nativeProbeSql: "local-adapter-only",
      }),
    );
  } finally {
    await c.end();
    await db.stop();
  }
});
test("actual PostgREST 14.18 hoisting and role deadlines stop slow and contended RPCs, with independent rollback evidence", async () => {
  const db = await startTestDatabase();
  let server;
  try {
    const pw = randomBytes(32).toString("hex");
    await db.owner
      .query(`create role local_rest login noinherit password '${pw}'; grant authenticated to local_rest;
 alter role authenticated set statement_timeout='150ms';
 create table public.timeout_marks(id int);
 create table public.timeout_lock(id int primary key,value int); insert into public.timeout_lock values(1,0);
 grant select,insert,update on public.timeout_marks,public.timeout_lock to authenticated;
 create function public.timeout_hoisted() returns void language plpgsql set statement_timeout='100ms' as $$begin insert into public.timeout_marks values(1);perform pg_sleep(0.6);end$$;
 create function public.timeout_role() returns void language plpgsql as $$begin insert into public.timeout_marks values(1);perform pg_sleep(0.6);end$$;
 create function public.timeout_contended() returns void language plpgsql set statement_timeout='1s' set lock_timeout='100ms' as $$begin insert into public.timeout_marks values(1);update public.timeout_lock set value=value+1 where id=1;end$$;`);
    const socket = net.createServer();
    await new Promise((r) => socket.listen(0, "127.0.0.1", r));
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const jwt = randomBytes(32).toString("hex");
    let diagnostic = "";
    const pathKey =
      Object.keys(process.env).find((k) => k.toLowerCase() === "path") ??
      "PATH";
    server = spawn(".local/postgrest/postgrest.exe", [], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        [pathKey]: `${resolve("node_modules/@embedded-postgres/windows-x64/native/bin")};${process.env[pathKey]}`,
        PGPASSWORD: pw,
        PGRST_DB_URI: `postgresql://local_rest@127.0.0.1:${db.connection.port}/${db.connection.database}`,
        PGRST_DB_ANON_ROLE: "authenticated",
        PGRST_DB_SCHEMAS: "public",
        PGRST_JWT_SECRET: jwt,
        PGRST_SERVER_HOST: "127.0.0.1",
        PGRST_SERVER_PORT: String(port),
        PGRST_DB_HOISTED_TX_SETTINGS: "statement_timeout",
        PGRST_LOG_LEVEL: "crit",
      },
    });
    server.stderr.on("data", (b) => {
      diagnostic = (diagnostic + b.toString()).slice(-6000);
    });
    let failure;
    server.on("error", () => (failure = true));
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    let readinessStatus;
    for (let i = 0; i < 100; i++) {
      if (failure)
        throw new Error(
          "Pinned PostgREST test binary unavailable; run test:postgrest:setup",
        );
      try {
        const probe = await fetch(`${base}/timeout_marks?select=id&limit=1`, {
          signal: AbortSignal.timeout(500),
        });
        ready = probe.ok;
        readinessStatus = probe.status;
        if (ready) break;
      } catch {}
      await delay(50);
    }
    for (const secret of [pw, jwt, db.connection.password])
      diagnostic = diagnostic.replaceAll(secret, "[redacted]");
    assert.ok(
      ready,
      `Local PostgREST ready (${readinessStatus}). Sanitized startup diagnostic: ${diagnostic}`,
    );
    // Confirm process speaks the exact provider-observed major/minor, not a mock HTTP handler.
    const version = (await fetch(base)).headers.get("server");
    assert.ok(version?.includes("14.18"));
    const holder = await db.connect();
    await holder.query("begin");
    await holder.query("update public.timeout_lock set value=1 where id=1");
    const evidence = [];
    for (const [name, code] of [
      ["timeout_hoisted", "57014"],
      ["timeout_role", "57014"],
      ["timeout_contended", "55P03"],
    ]) {
      const before = performance.now();
      const res = await fetch(`${base}/rpc/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(3000),
      });
      const result = await res.json();
      const elapsed = performance.now() - before;
      assert.equal(result.code, code);
      assert.ok(elapsed < 2000, "Server error returned before client deadline");
      assert.equal(await count(db.owner), 0, "RPC write rolled back");
      const active = await db.owner.query(
        "select count(*) as n from pg_stat_activity where application_name like 'PostgREST%' and state='active' and query like $1",
        [`%${name}%`],
      );
      assert.equal(+active.rows[0].n, 0);
      const writes = await db.owner.query(
        "select count(*) as n from pg_locks l join pg_stat_activity a using(pid) where a.application_name like 'PostgREST%' and l.locktype='transactionid' and mode='ExclusiveLock'",
      );
      assert.equal(+writes.rows[0].n, 0);
      evidence.push({
        name,
        code,
        elapsedMs: Math.round(elapsed),
        rollback: true,
        independentEnd: true,
      });
    }
    await holder.query("rollback");
    await holder.end();
    // Independent connection sees the holder's rollback too.
    assert.equal(
      (await db.owner.query("select value from public.timeout_lock")).rows[0]
        .value,
      0,
    );
    console.log(
      JSON.stringify({
        evidence: "real-local-postgrest-14.18",
        checks: evidence,
      }),
    );
  } finally {
    if (server) {
      server.kill();
      await new Promise((r) => {
        if (server.exitCode !== null) return r();
        server.once("exit", r);
        setTimeout(r, 2000);
      });
    }
    await db.stop();
  }
});
