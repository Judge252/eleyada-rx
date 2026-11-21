// PDF evidence: the doctor receipt and the pharmacy portal both preview and download a real PDF file.
// MOCKED /api/experience responses (local, not hosted). Synthetic data only.
import { test, expect, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:3107";
const CODE = "123456";
const doctor = {
  state: "verified",
  doctor_id: "00000000-0000-4000-8000-000000000001",
  doctor_name: "Dr Synthetic",
  clinic_id: "00000000-0000-4000-8000-000000000002",
  clinic_name: "רמלה",
  entitled: true,
};
const eligible = {
  state: "eligible",
  prescription_id: "00000000-0000-4000-8000-000000000004",
  lookup_id: "00000000-0000-4000-8000-000000000005",
  doctor_name: "Dr Synthetic",
  clinic_name: "רמלה",
  patient: { name: "מטופל סינתטי" },
  issued_at: "2026-11-06T10:00:00Z",
  expires_at: "2026-11-13T10:00:00Z",
  items: [{ id: "00000000-0000-4000-8000-0000000000a1", medication_name: "אקמול", strength: "500 mg", dose: "1", frequency: "x3", duration: "5d", quantity: 10, special_instructions: "", filled: 4, remaining: 6 }],
  history: [{ at: "2026-11-06T12:00:00Z", pharmacy: "בית מרקחת אלפא", complete: false, items: [{ medication_name: "אקמול", quantity: 4 }] }],
};

async function mock(page: Page, handler: (input: Record<string, unknown>) => object) {
  await page.context().addCookies([{ name: "clinic_rx_language", value: "he", url: BASE }]);
  await page.route("**/api/experience", (route) =>
    route.fulfill({ status: 200, json: handler(route.request().postDataJSON()) }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { role: "doctor", id: doctor.doctor_id } }),
  );
}

async function checkPdf(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "תצוגה מקדימה של PDF" }).first().click();
  const dialog = page.locator("dialog.cx-pdf-dialog[open]");
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const img = dialog.locator("img");
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(1000);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "הורדת PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^ClinicRX-Rx-\d{4}-\d{2}-\d{2}\.pdf$/);
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(20_000);
  await dialog.getByRole("button", { name: "סגירה" }).click();
  await expect(dialog).toBeHidden();
  // Download straight from the panel too.
  const [again] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".cx-actions").getByRole("button", { name: "הורדת PDF" }).first().click(),
  ]);
  expect(again.suggestedFilename()).toMatch(/\.pdf$/);
  expect(errors).toEqual([]);
}

for (const width of [1440, 390]) {
  test(`doctor receipt PDF preview + download at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mock(page, (input) =>
      input.operation === "context"
        ? { result: doctor }
        : input.operation === "issue"
          ? { result: { id: "00000000-0000-4000-8000-000000000003", doctor_name: doctor.doctor_name, clinic_name: doctor.clinic_name, issued_at: "2026-11-06T10:00:00Z", expires_at: "2026-11-13T10:00:00Z", accessCode: CODE } }
          : { result: null },
    );
    await page.goto("/dev-preview/doctor");
    await page.locator("#patient-name").fill("מטופל סינתטי");
    await page.locator("#patient-id").fill("000012345");
    await page.locator("#med-1-name").fill("אקמול");
    await page.locator("#med-1-quantity").fill("5");
    await page.locator("form button[type=submit], button").filter({ hasText: /סקירת|Review/ }).first().click();
    await page.locator("button").filter({ hasText: /אישור והנפקת|Confirm and issue/ }).first().click();
    await expect(page.locator(".cx-code")).toHaveText(CODE);
    await checkPdf(page);
  });
  test(`pharmacy portal PDF preview + download at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mock(page, (input) => (input.operation === "lookup" ? { result: eligible } : { result: null }));
    await page.goto("/portal");
    await page.locator("#ph-id").fill("000012345");
    await page.locator("#ph-code").fill(CODE);
    await page.locator("form button[type=submit]").click();
    await expect(page.locator(".cx-sheet")).toContainText("מטופל סינתטי");
    await expect(page.locator(".cx-sheet")).toContainText("רמלה");
    await expect(page.locator(".cx-sheet")).toContainText("בית מרקחת אלפא");
    await checkPdf(page);
  });
}
