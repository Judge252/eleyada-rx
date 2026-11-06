import { test, expect } from "@playwright/test";
const patient = "مريض اصطناعي محفوظ";
const medicine = "دواء اصطناعي محفوظ";
const doctor = {
  state: "verified",
  doctor_id: "00000000-0000-4000-8000-000000000001",
  doctor_name: "Verified test doctor",
  clinic_id: "00000000-0000-4000-8000-000000000002",
  clinic_name: "Test clinic",
  entitled: true,
};
for (const language of ["he", "en"] as const)
  for (const width of [360, 768, 1440])
    test(`${language} SSR, direction, keyboard, font and responsive views at ${width}`, async ({
      page,
      context,
      request,
    }) => {
      await context.addCookies([
        {
          name: "clinic_rx_language",
          value: language,
          url: "http://127.0.0.1:3107",
        },
      ]);
      await page.setViewportSize({ width, height: 1000 });
      const html = await (
        await request.get("/", {
          headers: { Cookie: `clinic_rx_language=${language}` },
        })
      ).text();
      expect(html).toContain(`lang="${language}"`);
      expect(html).toContain(`dir="${language === "he" ? "rtl" : "ltr"}"`);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/experience", (r) =>
        r.fulfill({ json: { state: "unauthorized" } }),
      );
      for (const path of ["/", "/portal", "/login"]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          language === "he" ? "rtl" : "ltr",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(await page.locator("body").innerText()).not.toMatch(
          /[\u0600-\u06ff]/,
        );
        expect(
          await page
            .locator("body")
            .evaluate((el) => getComputedStyle(el).fontFamily),
        ).toContain("Noto Sans Hebrew");
        await page.screenshot({
          path: `.local/clinic-rx/${language}-${path === "/" ? "doctor" : path.slice(1)}-${width}.png`,
          fullPage: true,
        });
      }
      await page.goto("/");
      await page.keyboard.press("Tab");
      await expect(page.locator(".skip-link")).toBeFocused();
      expect(errors).toEqual([]);
    });
test("language switch preserves clinical input, review, errors, request UUID and print receipt", async ({
  page,
  context,
}) => {
  const issues: Record<string, unknown>[] = [];
  const operations: string[] = [];
  await page.route("**/api/experience", async (r) => {
    const input = r.request().postDataJSON();
    operations.push(input.operation);
    if (input.operation === "context")
      return r.fulfill({ json: { result: doctor } });
    if (input.operation === "issue") {
      issues.push(input);
      return r.fulfill({
        json:
          issues.length === 1
            ? {
                state: "uncertain",
                message:
                  "The result is uncertain. Recover the receipt or retry the same request; do not start a new one.",
              }
            : {
                result: {
                  id: "00000000-0000-4000-8000-000000000003",
                  issued_at: "2026-11-06T10:00:00Z",
                  expires_at: "2026-11-13T10:00:00Z",
                  doctor_name: doctor.doctor_name,
                  clinic_name: doctor.clinic_name,
                },
              },
      });
    }
    return r.fulfill({ json: { result: null } });
  });
  await page.goto("/");
  await page.locator("#patient-name").fill(patient);
  await page.locator("#patient-id").fill("٠٠٠۰۱۲۳۴");
  await page.locator("#patient-country").selectOption("IL");
  const count = operations.length;
  await page.locator(".language-switcher select").selectOption("en");
  await expect(page.locator("#patient-name")).toHaveValue(patient);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  expect(operations.length).toBe(count);
  for (const [field, value] of Object.entries({
    name: medicine,
    strength: "10 mg",
    dose: "test",
    frequency: "test",
    duration: "test",
    quantity: "1",
  }))
    await page.locator(`#med-1-${field}`).fill(value);
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm prescription issuance" })
    .click();
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("rx.issue.request"),
  );
  expect(stored).toBeTruthy();
  await page.locator(".language-switcher select").selectOption("he");
  await expect(page.getByText(patient, { exact: true })).toBeVisible();
  await expect(page.getByText(medicine, { exact: false })).toBeVisible();
  await expect(page.getByText(/התוצאה אינה ודאית/)).toBeVisible();
  await page
    .getByRole("button", { name: "ניסיון חוזר של אותה בקשת הנפקה" })
    .click();
  await expect(
    page.getByRole("heading", { name: "המרשם הונפק" }),
  ).toBeVisible();
  expect(issues[0].requestId).toBe(issues[1].requestId);
  expect(issues[0].payload).toEqual(issues[1].payload);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".language-switcher")).toBeHidden();
  await expect(page.locator(".rx-receipt")).toBeVisible();
  expect(
    await page
      .locator(".rx-receipt")
      .evaluate((el) => getComputedStyle(el, "::before").content),
  ).toContain("קבלת הנפקה");
  await page.emulateMedia({ media: "screen" });
  await page.locator(".language-switcher select").selectOption("en");
  await page.emulateMedia({ media: "print" });
  expect(
    await page
      .locator(".rx-receipt")
      .evaluate((el) => getComputedStyle(el, "::before").content),
  ).toContain("Electronic issuance");
  expect(
    (await context.cookies()).find((c) => c.name === "clinic_rx_language")
      ?.value,
  ).toBe("en");
  await page.emulateMedia({ media: "screen" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
