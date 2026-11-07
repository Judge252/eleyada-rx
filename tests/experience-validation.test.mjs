import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrl = (code) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpile(code, { module: ts.ModuleKind.ESNext })).toString("base64")}`;
const drafts = moduleUrl(
  await readFile("src/lib/drafts/validation.ts", "utf8"),
);
const { normalizeIsraeliId, normalizeAccessCode, lookupInput, formPayload } =
  await import(
    moduleUrl(
      (await readFile("src/lib/experience/contracts.ts", "utf8")).replace(
        '"../drafts/validation"',
        JSON.stringify(drafts),
      ),
    )
  );
const { normalizeUsername, loginEmail } = await import(
  moduleUrl(await readFile("src/lib/auth/username.ts", "utf8"))
);
const CODE = "RX1-K1-" + "ABCD-".repeat(7) + "ABCD";

test("Israeli ID: exactly nine digits, both digit forms map, zeros kept as a string, separators rejected", () => {
  assert.equal(normalizeIsraeliId(" ٠٠٠۰۱۲۳۴۵ "), "000012345");
  assert.equal(normalizeIsraeliId("000012345"), "000012345");
  for (const bad of [
    "12345678",
    "1234567890",
    "0000-1234",
    "0000 1234",
    "00001234a",
    "",
    null,
    123456789,
  ])
    assert.equal(normalizeIsraeliId(bad), null);
});
test("access code: case, spaces and hyphens are cosmetic; wrong format or alphabet rejected", () => {
  const canonical = CODE.replace(/-/g, "");
  assert.equal(normalizeAccessCode(CODE), canonical);
  assert.equal(normalizeAccessCode(CODE.toLowerCase().replace(/-/g, " ")), canonical);
  for (const bad of ["", "RX1-K1-ABCD", CODE.replace("ABCD", "ABCU"), "x".repeat(81), null])
    assert.equal(normalizeAccessCode(bad), null);
});
test("public lookup input requires BOTH proofs and nothing else; an ID alone is not accepted", () => {
  assert.deepEqual(lookupInput({ identifier: "000012345", code: CODE }), {
    identifier: "000012345",
    code: CODE.replace(/-/g, ""),
  });
  assert.equal(lookupInput({ identifier: "000012345" }), null);
  assert.equal(lookupInput({ identifier: "000012345", code: "" }), null);
  assert.equal(lookupInput({ code: CODE }), null);
});
test("form is Israel-only: country/type/forged actor or clinic keys and malformed medications are rejected", () => {
  const good = {
    name: "SYNTHETIC",
    identifier: "000012345",
    notes: "",
    items: [
      {
        medication_name: "synthetic",
        strength: "test",
        dose: "test",
        frequency: "test",
        duration: "test",
        quantity: 1,
        special_instructions: "",
      },
    ],
  };
  assert.ok(formPayload(good));
  for (const extra of [
    { country: "IL" },
    { type: "national_id" },
    { doctor_id: "forged" },
    { clinic_id: "forged" },
  ])
    assert.equal(formPayload({ ...good, ...extra }), null);
  assert.equal(formPayload({ ...good, identifier: "1234" }), null);
  assert.equal(formPayload({ ...good, items: [] }), null);
  assert.equal(
    formPayload({ ...good, items: [{ ...good.items[0], quantity: 1.5 }] }),
    null,
  );
});
test("username maps deterministically to a reserved non-deliverable login identity; it is not a directory or claim", () => {
  assert.equal(normalizeUsername("  Dr.Cohen_1 "), "dr.cohen_1");
  assert.equal(normalizeUsername("  Dr.Cohen-1 "), "dr.cohen-1");
  for (const bad of ["ab", "-abc", "a b c", "a@b.co", "x".repeat(33), "", null, 5])
    assert.equal(normalizeUsername(bad), null);
  assert.equal(loginEmail("dr.cohen"), "dr.cohen@prescribers.clinic-rx.invalid");
  assert.ok(loginEmail("a1b").endsWith(".invalid"));
});
