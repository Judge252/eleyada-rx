import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import {
  encryptRecovery,
  decryptRecovery,
  cliRoot,
} from "../scripts/vault-recovery.mjs";
// Compile only this pure validator because Node's native TS loader cannot resolve app aliases.
import ts from "typescript";
import { readFile } from "node:fs/promises";
const drafts = ts.transpile(
  await readFile("src/lib/drafts/validation.ts", "utf8"),
  { module: ts.ModuleKind.ESNext },
);
const draftURL = `data:text/javascript;base64,${Buffer.from(drafts).toString("base64")}`;
const js = ts.transpile(
  (await readFile("src/lib/issuance/validation.ts", "utf8")).replace(
    '"../drafts/validation"',
    JSON.stringify(draftURL),
  ),
  { module: ts.ModuleKind.ESNext },
);
const { validateLifecycle, lifecycleError, sameOrigin } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
test("origin check uses original host, rejects missing/cross-host/cross-protocol/path/userinfo origins", () => {
  assert.ok(sameOrigin("http://127.0.0.1:3107", "127.0.0.1:3107", "http"));
  assert.ok(sameOrigin("https://clinic.example", "clinic.example", "https"));
  for (const [origin, host, protocol] of [
    [null, "clinic.example", "https"],
    ["https://example.invalid", "clinic.example", "https"],
    ["http://clinic.example", "clinic.example", "https"],
    ["https://clinic.example/path", "clinic.example", "https"],
    ["https://user@clinic.example", "clinic.example", "https"],
    ["https://clinic.example", "clinic.example/forged", "https"],
  ])
    assert.equal(sameOrigin(origin, host, protocol), false);
});
test("issuance validator accepts only exact IDs/version/fingerprint/confirmation and no code/digest/actor injection", () => {
  const base = {
    operation: "issue",
    requestId: randomUUID(),
    version: "2026-10-22T01:02:03.123456+00:00",
    fingerprint: "a".repeat(64),
    confirmed: true,
  };
  assert.ok(validateLifecycle(base));
  for (const patch of [
    { confirmed: false },
    { requestId: "x" },
    { version: "y" },
    { fingerprint: "short" },
    { fingerprint: "A".repeat(64) },
    { doctor_user_id: randomUUID() },
    { code: "injected" },
    { reference_digest: "x" },
  ])
    assert.equal(validateLifecycle({ ...base, ...patch }), null);
  assert.equal(validateLifecycle({ ...base, extra: null }), null);
});
test("cancel categories are closed, confirmation required; reveal has no client-provided reference", () => {
  const base = {
    operation: "cancel",
    requestId: randomUUID(),
    version: "2026-10-22T01:02:03Z",
    reason: "entered_in_error",
    confirmed: true,
  };
  for (const reason of [
    "entered_in_error",
    "duplicate_prescription",
    "treatment_changed",
    "other_administrative_reason",
  ])
    assert.ok(validateLifecycle({ ...base, reason }));
  for (const reason of ["free text", "toString", "constructor", null])
    assert.equal(validateLifecycle({ ...base, reason }), null);
  assert.ok(validateLifecycle({ operation: "reveal" }));
  assert.equal(validateLifecycle({ operation: "reveal", code: "x" }), null);
  assert.match(lifecycleError("PGRST202"), /Vault/);
  assert.match(lifecycleError("PT409"), /النسخة الأصلية/);
});
test("root escrow round trip, random encryption, authentication, wrong passphrase, source and key validation", () => {
  const root = randomBytes(32).toString("hex"),
    pass = randomBytes(32).toString("base64");
  const record = {
    format: 1,
    project: "fckdsiozmufyhbnignet",
    captured_at: new Date().toISOString(),
    root_key: root,
  };
  const first = encryptRecovery(record, pass),
    second = encryptRecovery(record, pass);
  assert.ok(first !== second);
  assert.ok(!first.includes(root));
  assert.ok(
    decryptRecovery(first, pass).root_key === root,
    "Escrow recovery failed",
  );
  assert.throws(() => decryptRecovery(first, "a".repeat(24)));
  const broken = JSON.parse(first);
  broken.tag = "0".repeat(32);
  assert.throws(() => decryptRecovery(JSON.stringify(broken), pass));
  assert.throws(() => encryptRecovery({ ...record, project: "wrong" }, pass));
  assert.throws(() => encryptRecovery(record, "short"));
});
test("private CLI root parser rejects unexpected shapes without invoking provider export", () => {
  const root = randomBytes(32).toString("hex");
  assert.ok(cliRoot(JSON.stringify({ root_key: root })) === root);
  assert.ok(cliRoot(JSON.stringify({ rootKey: root })) === root);
  assert.throws(() => cliRoot(JSON.stringify({ root_key: "invalid" })));
  assert.throws(() => cliRoot("not JSON"));
});
