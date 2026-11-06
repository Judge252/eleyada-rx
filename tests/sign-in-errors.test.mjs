import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
const code = ts.transpile(
  await readFile("src/lib/auth/sign-in-errors.ts", "utf8"),
  { module: ts.ModuleKind.ESNext },
);
const { signInErrorMessage, signInUnavailable } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
test("real SDK connection failures and provider outages are not incorrect-password errors", () => {
  assert.equal(
    signInErrorMessage(new AuthRetryableFetchError("fetch failed", 0)),
    signInUnavailable,
  );
  assert.equal(
    signInErrorMessage(
      new AuthApiError("provider unavailable", 503, "unexpected_failure"),
    ),
    signInUnavailable,
  );
});
test("invalid credentials remain generic and rate limits remain distinct", () => {
  const invalid = signInErrorMessage(
    new AuthApiError("private provider detail", 400, "invalid_credentials"),
  );
  assert.notEqual(invalid, signInUnavailable);
  assert.ok(!invalid.includes("private provider detail"));
  assert.notEqual(
    signInErrorMessage(
      new AuthApiError("rate limited", 429, "over_request_rate_limit"),
    ),
    invalid,
  );
  assert.equal(signInErrorMessage(null), invalid);
});
