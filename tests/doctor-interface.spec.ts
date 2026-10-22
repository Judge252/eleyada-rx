import { expect, test, type Page } from "@playwright/test";
import { visit } from "./auth-helpers";
import { credentials } from "./auth-helpers";
import { createClient } from "@supabase/supabase-js";

async function fillDraft(page: Page) {
  await page
    .getByLabel("اسم المريض", { exact: true })
    .fill("SYNTHETIC UI SUBJECT");
  for (const [id, value] of Object.entries({
    "0-medication_name": "SYNTHETIC NOT FOR TREATMENT",
    "0-strength": "test",
    "0-dose": "test",
    "0-frequency": "test",
    "0-duration": "test",
    "0-quantity": "2",
  }))
    await page.locator(`[id="${id}"]`).fill(value);
}

test("real doctor dashboard reads zero prescriptions and actual retained-patient count", async ({
  page,
}) => {
  await visit(page, "/doctor");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByText("لا توجد مسودات محفوظة بعد")).toBeVisible();
  await page.getByLabel("البحث في الوصفات").fill("SYNTHETIC SEARCH");
  await page.getByLabel("الحالة", { exact: true }).selectOption("draft");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  expect(
    !(await client.auth.signInWithPassword(credentials("doctor"))).error,
  ).toBe(true);
  const patients = await client
    .from("patients")
    .select("id", { count: "exact", head: true });
  expect(!patients.error).toBe(true);
  await expect(page.locator(".stat-value")).toHaveText([
    "٠",
    "٠",
    patients.count!.toLocaleString("ar-EG"),
    "٠",
  ]);
  await client.auth.signOut({ scope: "local" });
});

test("form validation, multiple medications, unsaved review/edit and draft print warning", async ({
  page,
}) => {
  await visit(page, "/doctor/prescriptions/new");
  await page
    .getByRole("button", { name: "مراجعة المسودة", exact: true })
    .click();
  await expect(page.getByText("أدخل اسمًا من ١ إلى ٢٠٠ حرف.")).toBeVisible();
  await fillDraft(page);
  await page.getByRole("button", { name: "إضافة دواء آخر" }).click();
  await expect(page.locator(".medication-editor")).toHaveCount(2);
  await page.getByRole("button", { name: "حذف الدواء 2" }).click();
  await page.locator('[id="0-quantity"]').fill("1.5");
  await page
    .getByRole("button", { name: "مراجعة المسودة", exact: true })
    .click();
  await expect(
    page.getByText("الكمية عدد صحيح من ١ إلى ١٠٠٠٠٠٠."),
  ).toBeVisible();
  await page.locator('[id="0-quantity"]').fill("2");
  await page
    .getByRole("button", { name: "مراجعة المسودة", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "مراجعة المسودة", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".document-warning")).toContainText(
    "غير صالحة للصرف",
  );
  await expect(page.locator(".reference-box")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".document-warning")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "العودة للتعديل" }).click();
  expect(
    (await page.getByLabel("اسم المريض", { exact: true }).inputValue()) ===
      "SYNTHETIC UI SUBJECT",
  ).toBe(true);
});

test("existing patient selection is read-only, empty search is useful, unsaved navigation asks", async ({
  page,
}) => {
  await visit(page, "/doctor/prescriptions/new");
  await page
    .getByLabel("اختيار المريض", { exact: true })
    .selectOption("existing");
  await page
    .getByLabel("البحث عن مريض بالاسم")
    .fill(`NO-SUCH-SYNTHETIC-${crypto.randomUUID()}`);
  await page.getByRole("button", { name: "بحث عن مريض", exact: true }).click();
  await expect(
    page.getByText("لا توجد نتائج. يمكنك إنشاء مريض جديد مع حفظ المسودة."),
  ).toBeVisible();
  await expect(page.getByLabel("اسم المريض", { exact: true })).toHaveCount(0);
  await page.getByLabel("اختيار المريض", { exact: true }).selectOption("new");
  await page
    .getByLabel("اسم المريض", { exact: true })
    .fill("SYNTHETIC UNSAVED");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "العودة إلى لوحة الطبيب" }).click();
  await expect(page).toHaveURL(/prescriptions\/new$/);
});

test("login validates fields and has no development bypass", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(
    page.getByText("أدخل بريدًا إلكترونيًا بصيغة صحيحة."),
  ).toBeVisible();
  await expect(page.locator(".role-previews")).toHaveCount(0);
});

for (const width of [320, 768, 1440]) {
  test(`RTL routes and unsaved draft review fit ${width}px without artifacts`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/login",
      "/doctor",
      "/doctor/prescriptions/new",
      "/pharmacy",
    ]) {
      await visit(page, path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator('img[alt="العيادة — استثمر في صحتك"]')
          .evaluateAll((images) =>
            images.every(
              (img) => img instanceof HTMLImageElement && img.naturalWidth > 0,
            ),
          ),
      ).toBe(true);
    }
    await visit(page, "/doctor/prescriptions/new");
    await fillDraft(page);
    await page
      .getByRole("button", { name: "مراجعة المسودة", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".document-warning")).toBeVisible();
  });
}
test("mock doctor IDs no longer resolve and root still redirects", async ({
  page,
}) => {
  await visit(page, "/doctor/prescriptions/rx-001");
  await expect(
    page.getByRole("heading", { name: "لم نعثر على هذه الصفحة" }),
  ).toBeVisible();
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
