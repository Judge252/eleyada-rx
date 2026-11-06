import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrl = (code) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpile(code, { module: ts.ModuleKind.ESNext })).toString("base64")}`;
const drafts = moduleUrl(
  await readFile("src/lib/drafts/validation.ts", "utf8"),
);
const contractsUrl = moduleUrl(
  (await readFile("src/lib/experience/contracts.ts", "utf8")).replace(
    '"../drafts/validation"',
    JSON.stringify(drafts),
  ),
);
const { normalizedIdentity, formPayload, accessInput } = await import(
  contractsUrl
);
const { passwordless } = await import(
  moduleUrl(
    (await readFile("src/lib/experience/passwordless.ts", "utf8")).replace(
      '"./contracts"',
      JSON.stringify(contractsUrl),
    ),
  )
);

test("identity preserves zeros, maps both digit forms, rejects separators and unsupported tuples", () => {
  assert.deepEqual(
    normalizedIdentity({
      country: " eg ",
      type: "national_id",
      identifier: " ٠٠٠۰۱۲۳۴ ",
    }),
    { country: "EG", type: "national_id", identifier: "00001234" },
  );
  for (const identifier of ["0000-1234", "0000 1234", "\t1234", 1234, "", null])
    assert.equal(
      normalizedIdentity({ country: "EG", type: "national_id", identifier }),
      null,
    );
  assert.equal(
    normalizedIdentity({
      country: "XX",
      type: "national_id",
      identifier: "00001234",
    }),
    null,
  );
  assert.equal(
    normalizedIdentity({
      country: "EG",
      type: "passport",
      identifier: "00001234",
    }),
    null,
  );
});
test("form rejects forged actor/clinic and incomplete or nonintegral medications", () => {
  const good = {
    name: "SYNTHETIC",
    country: "EG",
    type: "national_id",
    identifier: "00001234",
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
  assert.equal(formPayload({ ...good, doctor_id: "forged" }), null);
  assert.equal(formPayload({ ...good, clinic_id: "forged" }), null);
  assert.equal(formPayload({ ...good, items: [] }), null);
  assert.equal(
    formPayload({ ...good, items: [{ ...good.items[0], quantity: 1.5 }] }),
    null,
  );
});
function mock({
  allowed = true,
  approved = true,
  session = true,
  user = true,
  providerError = false,
} = {}) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        error: null,
        data:
          name === "request_prescriber_access"
            ? allowed
            : name === "has_active_session"
              ? session
              : { state: approved ? "verified" : "unauthorized" },
      };
    },
    auth: {
      signInWithOtp: async (args) => {
        calls.push({ name: "challenge", args });
        return { error: providerError ? {} : null };
      },
      verifyOtp: async (args) => {
        calls.push({ name: "verify", args });
        return { error: null };
      },
      getUser: async () => ({
        error: null,
        data: { user: user ? { id: "synthetic" } : null },
      }),
      signOut: async (args) => {
        calls.push({ name: "signOut", args });
        return { error: null };
      },
    },
  };
  return { client, calls };
}
test("challenge never enables signup and response is identical across provider/budget outcomes", async () => {
  for (const options of [{}, { allowed: false }, { providerError: true }]) {
    const m = mock(options);
    assert.deepEqual(
      await passwordless(
        m.client,
        { operation: "challenge", email: "synthetic@example.invalid" },
        true,
      ),
      { state: "accepted" },
    );
    for (const call of m.calls.filter((c) => c.name === "challenge"))
      assert.deepEqual(call.args.options, { shouldCreateUser: false });
  }
  const m = mock();
  assert.equal(
    (
      await passwordless(
        m.client,
        { operation: "challenge", email: "synthetic@example.invalid" },
        false,
      )
    ).state,
    "unavailable",
  );
  assert.equal(m.calls.length, 0);
});
test("OTP proves email control only; verified user/current session/operator approval are mandatory", async () => {
  const input = {
    operation: "verify",
    email: "synthetic@example.invalid",
    token: "123456",
  };
  for (const options of [
    { approved: false },
    { session: false },
    { user: false },
  ]) {
    const m = mock(options);
    assert.equal(
      (await passwordless(m.client, input, true)).state,
      "unauthorized",
    );
    assert.ok(m.calls.some((c) => c.name === "signOut"));
  }
  const m = mock();
  assert.equal((await passwordless(m.client, input, true)).state, "verified");
  assert.equal(m.calls.find((c) => c.name === "verify").args.type, "email");
  const denied = mock({ allowed: false });
  assert.equal(
    (await passwordless(denied.client, input, true)).state,
    "unauthorized",
  );
  assert.ok(!denied.calls.some((c) => c.name === "verify"));
});
test("onboarding uses generic persistent admission and cannot authenticate or approve", async () => {
  const m = mock();
  assert.equal(
    (
      await passwordless(
        m.client,
        {
          operation: "onboard",
          email: "synthetic@example.invalid",
          name: "Synthetic",
          clinic: "Synthetic",
        },
        false,
      )
    ).state,
    "accepted",
  );
  assert.deepEqual(
    m.calls.map((c) => c.name),
    ["request_prescriber_access"],
  );
  assert.equal(
    accessInput({
      operation: "challenge",
      email: "synthetic@example.invalid",
      shouldCreateUser: true,
    }),
    null,
  );
  assert.equal(
    accessInput({
      operation: "verify",
      email: "synthetic@example.invalid",
      token: "123",
    }),
    null,
  );
});
