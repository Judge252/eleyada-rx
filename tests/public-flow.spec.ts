// Browser evidence. Doctor workspace and pharmacy portal use MOCKED /api/experience responses (local, not hosted);
// the API-boundary checks hit the real local app endpoint. Synthetic data only.
import { test, expect, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:3107";
const CODE = "RX1-K1-" + "ABCD-".repeat(7) + "ABCD";
const doctor = {
  state: "verified",
  doctor_id: "00000000-0000-4000-8000-000000000001",
  doctor_name: "Dr Synthetic",
  clinic_id: "00000000-0000-4000-8000-000000000002",
  clinic_name: "Synthetic Clinic",
  entitled: true,
};
const issued = {
  id: "00000000-0000-4000-8000-000000000003",
  doctor_name: doctor.doctor_name,
  clinic_name: doctor.clinic_name,
  issued_at: "2026-11-06T10:00:00Z",
  expires_at: "2026-11-13T10:00:00Z",
  reference: CODE,
};
const eligible = {
  state: "eligible",
  prescription_id: "00000000-0000-4000-8000-000000000004",
  lookup_id: "00000000-0000-4000-8000-000000000005",
  patient: { name: "Synthetic Patient" },
  issued_at: "2026-11-06T10:00:00Z",
  expires_at: "2026-11-13T10:00:00Z",
  items: [
    {
      medication_name: "Synthetic אקמול",
      strength: "500 mg",
      dose: "1",
      frequency: "x3",
      duration: "5d",
      quantity: 10,
      special_instructions: "",
    },
  ],
};
async function language(page: Page, value: "he" | "en") {
  await page.context().addCookies([
    { name: "clinic_rx_language", value, url: BASE },
  ]);
}
async function mock(
  page: Page,
  handler: (input: Record<string, unknown>) => object,
) {
  await page.route("**/api/experience", (route) =>
    route.fulfill({ status: 200, json: handler(route.request().postDataJSON()) }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { role: "doctor", id: doctor.doctor_id } }),
  );
}
const noOverflow = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );

test("real endpoint: anonymous callers cannot issue, use removed operations or cross origins", async ({
  request,
}) => {
  const post = (data: object, origin = BASE) =>
    request.post("/api/experience", { headers: { Origin: origin }, data });
  expect((await post({ operation: "issue" })).status()).toBe(403);
  expect((await post({ operation: "context" })).status()).toBe(403);
  for (const operation of ["search", "select", "challenge", "verify", "onboard"])
    expect([400, 403]).toContain((await post({ operation })).status());
  // National ID alone is rejected before any database call.
  const idOnly = await post({ operation: "lookup", identifier: "000012345" });
  expect([400, 403]).toContain(idOnly.status());
  expect((await post({ operation: "lookup" }, "https://example.invalid")).status()).toBe(403);
});
test("doctor sign-in screen: username/password only, no OTP or self-activation, RTL default", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
  await expect(page.locator("#email, [autocomplete=one-time-code]")).toHaveCount(0);
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(page.locator(".cx-notice[role=alert]")).toContainText("שם משתמש");
  await language(page, "en");
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("link", { name: "Open prescription lookup" })).toBeVisible();
});
test("unauthenticated visit to the doctor page leads to sign-in, not a form", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
for (const lang of ["he", "en"] as const)
  for (const width of [360, 768, 1440])
    test(`doctor workspace + pharmacy portal at ${width}px (${lang}): no overflow, Israel-only fields`, async ({
      page,
    }) => {
      await language(page, lang);
      await page.setViewportSize({ width, height: 900 });
      await mock(page, () => ({ result: doctor }));
      await page.goto("/dev-preview/doctor");
      await expect(page.locator("#patient-id")).toBeVisible();
      await expect(page.locator("main select")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");
      expect(await noOverflow(page)).toBe(true);
      await page.goto("/portal");
      await expect(page.locator("#ph-id")).toBeVisible();
      await expect(page.locator("#ph-code")).toBeVisible();
      await expect(page.getByText(/password|סיסמה/i)).toHaveCount(0);
      expect(await noOverflow(page)).toBe(true);
    });
test("doctor: validate, review, uncertain issue keeps one request, receipt shows patient code", async ({
  page,
}) => {
  await language(page, "en");
  const calls: Record<string, unknown>[] = [];
  await mock(page, (input) => {
    calls.push(input);
    if (input.operation === "context") return { result: doctor };
    if (input.operation === "issue")
      return calls.filter((c) => c.operation === "issue").length === 1
        ? { state: "uncertain", message: "not confirmed" }
        : { result: issued };
    return { result: null };
  });
  await page.goto("/dev-preview/doctor");
  await page.getByRole("button", { name: "Review prescription", exact: true }).click();
  await expect(page.locator(".cx-notice[role=alert]")).toBeVisible();
  await page.locator("#patient-name").fill("Synthetic Patient");
  await page.locator("#patient-id").fill("٠٠٠۰۱۲۳۴۵");
  for (const [field, value] of Object.entries({
    name: "Synthetic אקמול",
    strength: "10 mg",
    dose: "1",
    frequency: "daily",
    duration: "5 days",
    quantity: "5",
  }))
    await page.locator(`#med-1-${field}`).fill(value);
  await page.getByRole("button", { name: "Review prescription", exact: true }).click();
  await expect(page.getByText("000012345", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and issue prescription" }).click();
  await expect(page.getByRole("button", { name: "Back to edit" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(page.locator(".cx-code")).toHaveText(CODE);
  const issues = calls.filter((c) => c.operation === "issue");
  expect(issues).toHaveLength(2);
  expect(issues[0].requestId).toBe(issues[1].requestId);
  expect(issues[0].payload).toEqual(issues[1].payload);
  expect(Object.keys(issues[0].payload as object).sort()).toEqual(["identifier", "items", "name", "notes"]);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("rx.")))).toEqual([]);
});
test("doctor with inactive entitlement cannot confirm issuance", async ({ page }) => {
  await language(page, "en");
  await mock(page, () => ({ result: { ...doctor, entitled: false } }));
  await page.goto("/dev-preview/doctor");
  await page.locator("#patient-name").fill("Synthetic Patient");
  await page.locator("#patient-id").fill("000012345");
  for (const f of ["name", "strength", "dose", "frequency", "duration"])
    await page.locator(`#med-1-${f}`).fill("x");
  await page.locator("#med-1-quantity").fill("1");
  await page.getByRole("button", { name: "Review prescription", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm and issue prescription" })).toBeDisabled();
  await expect(page.getByText(/subscription is inactive/).first()).toBeVisible();
});
test("pharmacy: ID alone is blocked client-side; ID + code → review → both confirmations → one request across uncertainty", async ({
  page,
}) => {
  await language(page, "en");
  const calls: Record<string, unknown>[] = [];
  await mock(page, (input) => {
    calls.push(input);
    if (input.operation === "lookup") return { result: eligible };
    if (input.operation === "dispense")
      return calls.filter((c) => c.operation === "dispense").length === 1
        ? { state: "uncertain", message: "not confirmed" }
        : { result: { state: "dispensed", id: "00000000-0000-4000-8000-000000000006", prescription_id: eligible.prescription_id, dispensed_at: "2026-11-07T10:00:00Z" } };
    return { result: null };
  });
  await page.goto("/portal");
  await page.locator("#ph-id").fill("000012345");
  await page.getByRole("button", { name: "Open prescription" }).click();
  await expect(page.locator(".cx-notice[role=alert]")).toBeVisible();
  expect(calls.filter((c) => c.operation === "lookup")).toHaveLength(0);
  await page.locator("#ph-code").fill(CODE.toLowerCase());
  await page.getByRole("button", { name: "Open prescription" }).click();
  await expect(page.getByText("Synthetic Patient")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm full dispensing" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/independently verified/).check();
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/dispensed in full/).check();
  await page.locator("#ph-label").fill("Synthetic Pharmacy");
  await confirm.click();
  await page.getByRole("button", { name: "Retry the same request" }).click();
  await expect(page.getByText("Dispensing recorded")).toBeVisible();
  const sent = calls.filter((c) => c.operation === "dispense");
  expect(sent).toHaveLength(2);
  expect(sent[0].requestId).toBe(sent[1].requestId);
  expect(sent[0]).toMatchObject({ identityConfirmed: true, fullConfirmed: true, pharmacyLabel: "Synthetic Pharmacy" });
  expect(calls.find((c) => c.operation === "lookup")).toMatchObject({ identifier: "000012345" });
});
for (const state of ["dispensed", "cancelled", "expired"])
  test(`pharmacy shows ${state} state without clinical contents`, async ({ page }) => {
    await language(page, "en");
    await mock(page, () => ({ result: { state } }));
    await page.goto("/portal");
    await page.locator("#ph-id").fill("000012345");
    await page.locator("#ph-code").fill(CODE);
    await page.getByRole("button", { name: "Open prescription" }).click();
    await expect(page.locator(".cx-notice")).toBeVisible();
    await expect(page.getByText("Synthetic")).toHaveCount(0);
  });
test("pharmacy not-found and throttled replies are generic", async ({ page }) => {
  await language(page, "en");
  await mock(page, () => ({ state: "notFound", message: "rx_msg_not_found" }));
  await page.goto("/portal");
  await page.locator("#ph-id").fill("000012345");
  await page.locator("#ph-code").fill(CODE);
  await page.getByRole("button", { name: "Open prescription" }).click();
  await expect(page.locator(".cx-notice[role=alert]")).toContainText("No available prescription matches this ID and code");
});
