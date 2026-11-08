// Measures the browser-generated PDF of the printable sheet (synthetic data, mocked API). Not a product test.
import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("sheet prints to a small single-page PDF", async ({ page }) => {
  await page.context().addCookies([{ name: "clinic_rx_language", value: "he", url: "http://127.0.0.1:3107" }]);
  await page.route("**/api/experience", (route) =>
    route.fulfill({
      json: {
        result: {
          state: "eligible", prescription_id: "00000000-0000-4000-8000-000000000004", lookup_id: "00000000-0000-4000-8000-000000000005",
          doctor_name: "ד״ר סינתטי", clinic_name: "מרפאה סינתטית", patient: { name: "מטופל סינתטי" },
          issued_at: "2026-11-06T10:00:00Z", expires_at: "2026-11-13T10:00:00Z",
          items: [{ medication_name: "Panadol 500", strength: "-", dose: "-", frequency: "-", duration: "-", quantity: 2, special_instructions: "אחרי אוכל" }],
        },
      },
    }),
  );
  await page.goto("/portal");
  await page.locator("#ph-id").fill("000012345");
  await page.locator("#ph-code").fill("123456");
  await page.getByRole("button", { name: "פתיחת המרשם" }).click();
  await expect(page.locator(".cx-sheet")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ format: "A4" });
  writeFileSync(process.env.PDF_OUT ?? "test-results/rx-sample.pdf", pdf);
  console.log("PDF bytes:", pdf.length);
  expect(pdf.length).toBeLessThan(150_000);
});
