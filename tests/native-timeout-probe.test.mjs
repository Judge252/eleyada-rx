import { test } from "node:test";
import assert from "node:assert/strict";
import { timeoutPassed } from "../scripts/run-native-timeout-probe.mjs";
test("native probe accepts only a prompt server statement-timeout error, never a client abort or completed sleep", () => {
  assert.equal(
    timeoutPassed({ status: 500, error: { code: "57014" } }, 400),
    true,
  );
  for (const [result, time] of [
    [{ status: 0, error: { code: "AbortError" } }, 3000],
    [{ status: 200, data: true }, 400],
    [{ status: 403, error: { code: "42501" } }, 200],
    [{ status: 500, error: { code: "57014" } }, 4000],
  ])
    assert.equal(timeoutPassed(result, time), false);
});
