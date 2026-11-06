import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "clinic_rx_language", value: "en", url: "http://127.0.0.1:3107" },
  ]);
});

const doctor = {
  state: "verified",
  doctor_id: "00000000-0000-4000-8000-000000000001",
  doctor_name: "طبيب اصطناعي",
  clinic_id: "00000000-0000-4000-8000-000000000002",
  clinic_name: "عيادة اصطناعية",
  entitled: true,
};
const receipt = {
  id: "00000000-0000-4000-8000-000000000003",
  doctor_name: doctor.doctor_name,
  clinic_name: doctor.clinic_name,
  issued_at: "2026-11-06T10:00:00Z",
  expires_at: "2026-11-13T10:00:00Z",
};
async function mock(
  page: Page,
  handler: (input: Record<string, unknown>) => object | Promise<object>,
) {
  await page.route("**/api/experience", async (route) => {
    await route.fulfill({
      status: 200,
      json: await handler(route.request().postDataJSON()),
    });
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { role: "doctor" } }),
  );
}
async function fillDoctor(page: Page) {
  await page.locator("#patient-name").fill("مريض اصطناعي");
  await page.locator("#patient-id").fill("٠٠٠۰۱۲۳۴");
  await page.locator("#patient-country").selectOption("EG");
  for (const [field, value] of Object.entries({
    name: "Synthetic",
    strength: "10 mg",
    dose: "قرص",
    frequency: "مرة يوميًا",
    duration: "5 أيام",
    quantity: "5",
  }))
    await page.locator(`#med-1-${field}`).fill(value);
}
test("anonymous real API cannot issue or retrieve patient data; rejects cross-origin mutations", async ({
  request,
}) => {
  const response = await request.post("/api/experience", {
    headers: { Origin: "http://127.0.0.1:3107" },
    data: {
      operation: "search",
      country: "EG",
      type: "national_id",
      identifier: "00001234",
      offset: 0,
    },
  });
  expect(response.status()).toBe(403);
  expect(await response.text()).not.toContain("SYNTHETIC");
  const csrf = await request.post("/api/experience", {
    headers: { Origin: "https://example.invalid" },
    data: { operation: "issue" },
  });
  expect(csrf.status()).toBe(403);
});
test("connected doctor validates, reviews and preserves one request across uncertain issuance", async ({
  page,
}) => {
  const calls: Record<string, unknown>[] = [];
  await mock(page, (input) => {
    calls.push(input);
    if (input.operation === "context") return { result: doctor };
    if (input.operation === "issue")
      return calls.filter((c) => c.operation === "issue").length === 1
        ? { state: "uncertain", message: "لم نتأكد من النتيجة" }
        : { result: receipt };
    return { result: null };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await expect(page.locator("#patient-name")).toBeFocused();
  await fillDoctor(page);
  await page.getByRole("button", { name: "Add another medication" }).click();
  await page.getByRole("button", { name: "Remove medication 2" }).click();
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await expect(page.getByText("00001234", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm prescription issuance" })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit details" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry the same issuance request" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prescription issued" }),
  ).toBeVisible();
  const issues = calls.filter((c) => c.operation === "issue");
  expect(issues).toHaveLength(2);
  expect(issues[0].requestId).toBe(issues[1].requestId);
  expect(issues[0].payload).toEqual(issues[1].payload);
  expect(issues[0].reviewedDoctorId).toBe(doctor.doctor_id);
  expect(issues[0].reviewedClinicId).toBe(doctor.clinic_id);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith("rx.")),
    ),
  ).toEqual([]);
});
test("inactive entitlement and unauthorized sessions cannot confirm issuance", async ({
  page,
}) => {
  await mock(page, () => ({ result: { ...doctor, entitled: false } }));
  await page.goto("/");
  await fillDoctor(page);
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm prescription issuance" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/clinic subscription must be activated/),
  ).toBeVisible();
});
test("passwordless/onboarding form uses real operation contracts without fake verification", async ({
  page,
}) => {
  const calls: Record<string, unknown>[] = [];
  await mock(page, (input) => {
    calls.push(input);
    if (input.operation === "context") return { state: "unauthorized" };
    if (input.operation === "verify")
      return { state: "unauthorized", message: "يلزم حساب معتمد" };
    return { state: "accepted" };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Verify / request access" }).click();
  await page.locator("#doctor-email").fill("synthetic@example.invalid");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.locator("#doctor-otp").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByText("يلزم حساب معتمد", { exact: true }),
  ).toBeVisible();
  await page.locator("#access-mode").selectOption("onboard");
  await page.locator("#doctor-name").fill("طبيب اصطناعي");
  await page.locator("#clinic-name").fill("عيادة اصطناعية");
  await page.getByRole("button", { name: "Submit access request" }).click();
  expect(calls.map((c) => c.operation)).toContain("onboard");
});
test("pharmacy selects among real-handler results and requires both confirmations before dispensing", async ({
  page,
}) => {
  const calls: Record<string, unknown>[] = [];
  const match = {
    ...receipt,
    doctor_name: doctor.doctor_name,
    clinic_name: doctor.clinic_name,
  };
  await mock(page, (input) => {
    calls.push(input);
    if (input.operation === "context")
      return { state: "pharmacist", pharmacy: { name: "صيدلية اصطناعية" } };
    if (input.operation === "search")
      return {
        result: {
          search_id: "00000000-0000-4000-8000-000000000004",
          matches: [
            match,
            {
              ...match,
              id: "00000000-0000-4000-8000-000000000005",
              doctor_name: "طبيب ثانٍ",
            },
          ],
          next_offset: null,
        },
      };
    if (input.operation === "select")
      return {
        result: {
          prescription_id: input.prescriptionId,
          lookup_id: "00000000-0000-4000-8000-000000000006",
          patient: { name: "مريض اصطناعي" },
          items: [
            {
              medication_name: "Synthetic",
              strength: "10 mg",
              dose: "قرص",
              frequency: "مرة",
              duration: "5 أيام",
              quantity: 5,
              special_instructions: "",
            },
          ],
          issued_at: receipt.issued_at,
          expires_at: receipt.expires_at,
        },
      };
    if (input.operation === "dispense")
      return {
        result: {
          state: "dispensed",
          id: receipt.id,
          prescription_id: input.prescriptionId,
        },
      };
    return { result: null };
  });
  await page.goto("/portal");
  await page.locator("#lookup-id").fill("00001234");
  await page.locator("#lookup-country").selectOption("EG");
  await page.getByRole("button", { name: "Search for prescriptions" }).click();
  await expect(
    page.getByRole("button", { name: "Select prescription", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Review selected prescription" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select prescription", exact: true })
    .nth(1)
    .click();
  const confirm = page.getByRole("button", {
    name: "Confirm full dispensing",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox").nth(0).check();
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox").nth(1).check();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Full dispensing confirmed" }),
  ).toBeVisible();
  const sent = calls.find((c) => c.operation === "dispense")!;
  expect(sent.identityConfirmed).toBe(true);
  expect(sent.fullConfirmed).toBe(true);
  expect(page.url()).not.toContain("00001234");
});
test("backend failure never exposes fixtures or a simulated success", async ({
  page,
}) => {
  await mock(page, (input) =>
    input.operation === "context"
      ? { state: "pharmacist", pharmacy: { name: "اصطناعية" } }
      : { state: "unavailable", message: "الخدمة غير متاحة" },
  );
  await page.goto("/portal");
  await page.locator("#lookup-id").fill("00001234");
  await page.locator("#lookup-country").selectOption("EG");
  await page.getByRole("button", { name: "Search for prescriptions" }).click();
  await expect(
    page.getByText("الخدمة غير متاحة", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select prescription", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/SYNTHETIC-0|PREVIEW-/)).toHaveCount(0);
});

test("restored clinical UI rejects a different authenticated identity with the same role", async ({
  page,
}) => {
  await mock(page, () => ({ result: doctor }));
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { role: "doctor", id: "00000000-0000-4000-8000-000000000099" },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/login\?reason=access$/);
});
for (const width of [360, 768, 1440])
  test(`connected RTL responsive layout ${width}px`, async ({ page }) => {
    await mock(page, () => ({ state: "unauthorized" }));
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["/", "/portal"]) {
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/phase2/${route === "/" ? "doctor" : "pharmacy"}-${width}.png`,
        fullPage: true,
      });
    }
  });
