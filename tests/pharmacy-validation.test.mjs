import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const drafts = ts.transpile(
  await readFile("src/lib/drafts/validation.ts", "utf8"),
  { module: ts.ModuleKind.ESNext },
);
const url = `data:text/javascript;base64,${Buffer.from(drafts).toString("base64")}`;
const code = ts.transpile(
  (await readFile("src/lib/pharmacy/validation.ts", "utf8")).replace(
    '"../drafts/validation"',
    JSON.stringify(url),
  ),
  { module: ts.ModuleKind.ESNext },
);
const { validatePharmacy, pharmacyError } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
test("lookup strict shape and bounded reference never accepts actors or code in dispense", () => {
  assert.ok(validatePharmacy({ operation: "lookup", reference: "" })); // malformed strings count at the DB limiter
  assert.equal(
    validatePharmacy({ operation: "lookup", reference: "x".repeat(81) }),
    null,
  );
  for (const reference of [null, {}, [], 2])
    assert.equal(validatePharmacy({ operation: "lookup", reference }), null);
  assert.equal(
    validatePharmacy({
      operation: "lookup",
      reference: "test",
      doctor_user_id: randomUUID(),
    }),
    null,
  );
});
test("dispensing requires exact IDs both confirmations and rejects partial or forged fields", () => {
  const valid = {
    operation: "dispense",
    lookupId: randomUUID(),
    prescriptionId: randomUUID(),
    requestId: randomUUID(),
    identityConfirmed: true,
    fullConfirmed: true,
  };
  assert.ok(validatePharmacy(valid));
  for (const key of ["lookupId", "prescriptionId", "requestId"])
    for (const value of ["", null, "bad", {}])
      assert.equal(validatePharmacy({ ...valid, [key]: value }), null);
  for (const key of ["identityConfirmed", "fullConfirmed"])
    for (const value of [false, null, "true", 1])
      assert.equal(validatePharmacy({ ...valid, [key]: value }), null);
  for (const key of [
    "items",
    "quantity",
    "pharmacyId",
    "actorId",
    "reference",
    "digest",
  ])
    assert.equal(validatePharmacy({ ...valid, [key]: "forged" }), null);
});
test("error states describe unavailable unconfirmed results without leaking provider data", () => {
  for (const code of [
    "42501",
    "PT404",
    "PT429",
    "PT409",
    "22023",
    "PGRST202",
    "PT503",
    undefined,
  ])
    assert.ok(
      typeof pharmacyError(code) === "string" &&
        pharmacyError(code).length > 10,
    );
  assert.ok(pharmacyError().includes("لا تفترض"));
});
