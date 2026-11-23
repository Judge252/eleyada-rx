// Print / Save as PDF evidence: one native print action on the doctor receipt and the pharmacy portal, a print
// stylesheet that outputs only the prescription document on A4, and the ClinicRX seal in the footer.
// MOCKED /api/experience responses (local, not hosted). Synthetic data only.
import { test, expect, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:3107";
const CODE = "123456";
const OUT = process.env.RX_PRINT_OUT; // optional folder for saving the generated PDFs for manual review
const LONG_DOCTOR = "Dr. Abdelrahman Mohammed Abu-Eshba Al-Khalidi Ben-Yosef";
const LONG_CLINIC = "המרפאה הקהילתית המשולבת לרפואת המשפחה והילדים — סניף רמלה מרכז";
const LONG_PATIENT = "Mohammed Abdelrahman Abu-Eshba Al-Khalidi Ben-Yosef";
const LONG_INSTRUCTIONS =
  "Take one tablet by mouth twice daily after meals with a full glass of water. Do not crush or chew. " +
  "If a dose is missed, take it as soon as remembered unless it is almost time for the next dose. " +
  "יש ליטול עם האוכל; להפסיק ולפנות לרופא במקרה של פריחה.";

const doctor = {
  state: "verified",
  doctor_id: "00000000-0000-4000-8000-000000000001",
  doctor_name: "Amin Abo Eshba",
  clinic_id: "00000000-0000-4000-8000-000000000002",
  clinic_name: "רמלה",
  doctor_name_he: "אמין אבו אשבה",
  doctor_name_en: "Amin Abo Eshba",
  clinic_name_he: "רמלה",
  clinic_name_en: "Ramla",
  entitled: true,
};
const item = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  medication_name: n % 2 ? `Amoxicillin ${n}` : `אקמול ${n}`,
  strength: "500 mg",
  dose: "1",
  frequency: "x2",
  duration: "7d",
  quantity: 10 + n,
  special_instructions: LONG_INSTRUCTIONS,
  filled: 0,
  remaining: 10 + n,
  ...extra,
});
const lookup = (items: ReturnType<typeof item>[], overrides: Record<string, unknown> = {}) => ({
  state: "partial",
  prescription_id: "00000000-0000-4000-8000-000000000004",
  lookup_id: "00000000-0000-4000-8000-000000000005",
  doctor_name: LONG_DOCTOR,
  clinic_name: LONG_CLINIC,
  patient: { name: LONG_PATIENT },
  issued_at: "2026-11-06T10:00:00Z",
  expires_at: "2026-11-13T10:00:00Z",
  items,
  history: [
    { at: "2026-11-06T12:00:00Z", pharmacy: "בית מרקחת אלפא", complete: false, items: [{ medication_name: items[0].medication_name, quantity: 4 }] },
  ],
  ...overrides,
});

async function mock(page: Page, lang: "he" | "en", handler: (input: Record<string, unknown>) => object) {
  await page.context().addCookies([{ name: "clinic_rx_language", value: lang, url: BASE }]);
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints++;
    };
  });
  await page.route("**/api/experience", (route) =>
    route.fulfill({ status: 200, json: handler(route.request().postDataJSON()) }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { role: "doctor", id: doctor.doctor_id } }),
  );
}

// One action only; it opens the native print dialog and nothing else.
async function checkPrintAction(page: Page, label: RegExp) {
  await expect(page.getByRole("button", { name: /Download PDF|הורדת PDF|Preview PDF|תצוגה מקדימה/ })).toHaveCount(0);
  const action = page.getByRole("button", { name: label });
  await expect(action).toHaveCount(1);
  await action.click();
  expect(await page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
  await expect(page.locator("a[download], dialog")).toHaveCount(0);
}

// Print stylesheet: only the document is visible; the seal sits inside the footer, lower right, ~26 mm wide.
async function checkPrintLayout(page: Page, name: string) {
  await page.emulateMedia({ media: "print" });
  for (const hidden of [".cx-header", ".cx-title", ".cx-lede", ".cx-actions", ".cx-hint", ".cx-noprint"])
    for (const el of await page.locator(hidden).all()) await expect(el).toBeHidden();
  await expect(page.locator(".cx-sheet")).toBeVisible();
  const seal = page.locator(".cx-sheet-seal");
  await expect(seal).toBeVisible();
  expect(await seal.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const box = (await seal.boundingBox())!;
  const sheet = (await page.locator(".cx-sheet").boundingBox())!;
  const foot = (await page.locator(".cx-sheet-foot").boundingBox())!;
  expect(box.width).toBeGreaterThan(80); // 22 mm ≈ 83 px
  expect(box.width).toBeLessThan(110); // 28 mm ≈ 106 px
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  expect(box.x + box.width).toBeGreaterThan(sheet.x + sheet.width - 2); // lower right
  expect(box.y).toBeGreaterThanOrEqual(foot.y);
  // The privacy notice is the last line of the document, below the stamp.
  const privacy = page.locator(".cx-sheet > :last-child");
  await expect(privacy).toHaveClass(/cx-sheet-privacy/);
  await expect(privacy).toHaveText(/המסמך מכיל מידע מוגן על-פי חוק הגנת הפרטיות|Privacy Protection Law/);
  expect((await privacy.boundingBox())!.y).toBeGreaterThan(box.y + box.height - 1);
  // The stamp is served byte-for-byte as supplied.
  const served = await page.request.get("/branding/clinicrx-stamp.png");
  const { readFile } = await import("node:fs/promises");
  expect(Buffer.compare(await served.body(), await readFile("stamp.png"))).toBe(0);
  const text = (await page.locator(".cx-sheet-foot-text").boundingBox())!;
  expect(text.x + text.width).toBeLessThanOrEqual(box.x + 0.5); // no overlap with the statement
  const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  if (OUT) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${OUT}/${name}.pdf`, pdf);
  }
  await page.emulateMedia({ media: "screen" });
  return pdf;
}
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test("doctor receipt (Hebrew, one medication): one Print / Save PDF action and a clean A4 document", async ({ page }) => {
  await mock(page, "he", (input) =>
    input.operation === "context"
      ? { result: doctor }
      : input.operation === "issue"
        ? { result: { id: "00000000-0000-4000-8000-000000000003", doctor_name: doctor.doctor_name, clinic_name: doctor.clinic_name, issued_at: "2026-11-06T10:00:00Z", expires_at: "2026-11-13T10:00:00Z", accessCode: CODE } }
        : { result: null },
  );
  await page.goto("/dev-preview/doctor");
  await page.locator("#patient-name").fill("אחמד אלקאדי");
  await page.locator("#patient-id").fill("123456789");
  await page.locator("#med-1-name").fill("Panadol");
  await page.locator("#med-1-quantity").fill("2");
  await page.locator("button").filter({ hasText: /סקירת|Review/ }).first().click();
  await page.locator("button").filter({ hasText: /אישור והנפקת|Confirm and issue/ }).first().click();
  const sheet = page.locator(".cx-sheet");
  // Hebrew UI: names in Hebrew letters, also in the side panel.
  await expect(sheet.locator(".cx-party-doctor")).toHaveText("אמין אבו אשבה");
  await expect(sheet.locator(".cx-party-clinic")).toHaveText("רמלה");
  await expect(page.locator(".cx-aside")).toContainText("אמין אבו אשבה");
  await expect(sheet.locator(".cx-patient-name")).toHaveText("אחמד אלקאדי");
  // Checkbox left unticked: printed as "not performed".
  await expect(sheet.locator(".cx-patient-allergy")).toHaveText("בדיקת אלרגיה לא בוצעה");
  await expect(sheet.locator(".cx-rx-item")).toHaveCount(1);
  await expect(sheet.locator(".cx-rx-name")).toHaveText("Panadol");
  await expect(sheet.locator(".cx-code")).toHaveText(CODE);
  await expect(sheet.locator(".cx-sheet-title")).toHaveText("מרשם דיגיטלי");
  await checkPrintAction(page, /הדפסה \/ שמירה כ-PDF/);
  const pdf = await checkPrintLayout(page, "doctor-he-one");
  expect(pages(pdf)).toBe(1);
});

test("pharmacy shows doctor and clinic in the reader's language letters", async ({ page }) => {
  const names = { doctor_name: "Salem Mehe", doctor_name_he: "סאלם מהה", doctor_name_en: "Salem Mehe", clinic_name: "המרפאה", clinic_name_he: "המרפאה", clinic_name_en: "The Clinic", allergy_test_done: true };
  for (const [lang, doctorName, clinicName] of [["en", "Salem Mehe", "The Clinic"], ["he", "סאלם מהה", "המרפאה"]] as const) {
    await mock(page, lang, (input) => (input.operation === "lookup" ? { result: lookup([item(1)], names) } : { result: null }));
    await page.goto("/portal");
    await page.locator("#ph-id").fill("000012345");
    await page.locator("#ph-code").fill(CODE);
    await page.locator("form button[type=submit]").click();
    await expect(page.locator(".cx-party-doctor")).toHaveText(doctorName);
    await expect(page.locator(".cx-party-clinic")).toHaveText(clinicName);
    await expect(page.locator(".cx-patient-allergy")).toHaveText(lang === "he" ? "בדיקת אלרגיה בוצעה" : "Allergy test Performed");
    await page.unrouteAll();
  }
});

test("pharmacy (English UI, long names, mixed Hebrew/English, history): document hierarchy and print layout", async ({ page }) => {
  await mock(page, "en", (input) =>
    input.operation === "lookup" ? { result: lookup([item(1), item(2), item(3)]) } : { result: null },
  );
  await page.goto("/portal");
  await page.locator("#ph-id").fill("000012345");
  await page.locator("#ph-code").fill(CODE);
  await page.locator("form button[type=submit]").click();
  const sheet = page.locator(".cx-sheet");
  await expect(sheet.locator(".cx-party-doctor")).toHaveText(LONG_DOCTOR);
  await expect(sheet.locator(".cx-party-clinic")).toHaveText(LONG_CLINIC);
  await expect(sheet.locator(".cx-patient-name")).toHaveText(LONG_PATIENT);
  await expect(sheet.locator(".cx-rx-item")).toHaveCount(3);
  // Instructions are complete, never truncated.
  await expect(sheet.locator(".cx-rx-instructions").first()).toContainText(LONG_INSTRUCTIONS);
  await expect(sheet.locator(".cx-history > li")).toHaveCount(1);
  // Nothing overflows the document horizontally.
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await checkPrintAction(page, /Print \/ Save PDF/);
  await checkPrintLayout(page, "pharmacy-en-three");
});

test("pharmacy (Hebrew, many medications): the document spans pages without clipping; empty history shows the message", async ({ page }) => {
  await mock(page, "he", (input) =>
    input.operation === "lookup"
      ? { result: lookup(Array.from({ length: 14 }, (_, i) => item(i + 1)), { state: "eligible", history: [] }) }
      : { result: null },
  );
  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto("/portal");
  await page.locator("#ph-id").fill("000012345");
  await page.locator("#ph-code").fill(CODE);
  await page.locator("form button[type=submit]").click();
  await expect(page.locator(".cx-rx-item")).toHaveCount(14);
  await expect(page.locator(".cx-sheet-empty")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const pdf = await checkPrintLayout(page, "pharmacy-he-many");
  expect(pages(pdf)).toBeGreaterThan(1);
});
