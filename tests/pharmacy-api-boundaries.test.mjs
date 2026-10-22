// Actual built Next route, anonymous only. No hosted login or clinical writes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { sanitizeTestErrors } from "./sanitize-test-errors.mjs";
sanitizeTestErrors("PHARMACY_API");
test("built application pharmacy endpoint denies anonymous cross-origin and GET with no-store", async () => {
  let server;
  try {
    const socket = net.createServer();
    await new Promise((r) => socket.listen(0, "127.0.0.1", r));
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const base = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    for (let n = 0; n < 100; n++) {
      if (
        await fetch(`${base}/login`, { signal: AbortSignal.timeout(500) }).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      if (n === 99) throw Error("LOCAL_APP_NOT_READY");
      await delay(100);
    }
    const endpoint = `${base}/api/pharmacy/prescriptions`;
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
      const r = await fetch(endpoint, {
        method,
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(r.status, 405);
      assert.ok(r.headers.get("cache-control").includes("no-store"));
    }
    for (const Origin of [base, "https://example.invalid", ""]) {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "lookup",
          reference: "SYNTHETIC INVALID",
        }),
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(r.status, 403);
      assert.ok(r.headers.get("cache-control").includes("no-store"));
    }
    const protectedPage = await fetch(`${base}/pharmacy`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.ok([303, 307].includes(protectedPage.status));
    assert.ok(protectedPage.headers.get("location").includes("/login"));
  } catch (e) {
    throw Error(`PHARMACY_API_FAILED_${e.code ?? "ASSERTION"}`);
  } finally {
    if (server && server.exitCode === null) {
      const ended = new Promise((r) => server.once("exit", r));
      server.kill();
      await ended;
    }
  }
});
