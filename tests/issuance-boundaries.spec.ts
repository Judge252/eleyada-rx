import { expect, test } from "@playwright/test";
import { uiSignIn } from "./auth-helpers";

const endpoint = () =>
  `/api/doctor/prescriptions/${crypto.randomUUID()}/lifecycle`;
const headers = {
  Origin: "http://127.0.0.1:3107",
  "Content-Type": "application/json",
};
test("issuance API: anonymous and real pharmacist denied before any clinical RPC", async ({
  page,
  request,
}) => {
  const anonymous = await request.post(endpoint(), {
    headers,
    data: { operation: "reveal" },
    timeout: 15000,
  });
  expect(anonymous.status()).toBe(403);
  expect(anonymous.headers()["cache-control"]).toContain("no-store");
  await uiSignIn(page, "pharmacist");
  for (const operation of ["reveal", "issue", "cancel"]) {
    const res = await page.request.post(endpoint(), {
      headers,
      data: { operation },
      timeout: 15000,
    });
    expect(res.status()).toBe(403);
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});
test("issuance API: real doctor malformed/forged/cross-origin requests fail, missing hosted activation fails clearly", async ({
  page,
}) => {
  await uiSignIn(page, "doctor");
  for (const data of [
    {
      operation: "issue",
      doctor_user_id: crypto.randomUUID(),
      reference_digest: "forged",
    },
    {
      operation: "issue",
      requestId: crypto.randomUUID(),
      version: new Date().toISOString(),
      fingerprint: "a".repeat(64),
      confirmed: false,
    },
    { operation: "reveal", reference: "forged" },
    {
      operation: "cancel",
      requestId: crypto.randomUUID(),
      version: new Date().toISOString(),
      reason: "free text",
      confirmed: true,
    },
  ]) {
    const res = await page.request.post(endpoint(), {
      headers,
      data,
      timeout: 15000,
    });
    expect(res.status()).toBe(400);
  }
  const origin = await page.request.post(endpoint(), {
    headers: { ...headers, Origin: "https://example.invalid" },
    data: { operation: "reveal" },
    timeout: 15000,
  });
  expect(origin.status()).toBe(403);
  const get = await page.request.get(endpoint());
  expect(get.status()).toBe(405);
  expect(get.headers()["cache-control"]).toContain("no-store");
  const reveal = await page.request.post(endpoint(), {
    headers,
    data: { operation: "reveal" },
    timeout: 15000,
  });
  // An unpredictable nonexistent ID can never issue or append a reference audit.
  expect([403, 503].includes(reveal.status())).toBe(true);
  expect(reveal.headers()["cache-control"]).toContain("no-store");
  await page.goto(`/doctor/prescriptions/${crypto.randomUUID()}/issue`);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "تأكيد الإصدار النهائي" }),
  ).toHaveCount(0);
});
test("issuance API: globally revoked real doctor session cannot replay cookies", async ({
  page,
}) => {
  await uiSignIn(page, "doctor");
  const old = await page.context().cookies();
  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.context().clearCookies();
  await page.context().addCookies(old);
  const res = await page.request.post(endpoint(), {
    headers,
    data: { operation: "reveal" },
    timeout: 15000,
  });
  expect(res.status()).toBe(403);
});
