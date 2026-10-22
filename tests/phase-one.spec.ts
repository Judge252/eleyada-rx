import { expect, test, type Page } from "@playwright/test";
import { visit } from "./auth-helpers";
async function searchCode(page: Page, code: string) {
  await page.getByLabel("رمز الوصفة التجريبي", { exact: true }).fill(code);
  await page.getByRole("button", { name: "بحث عن الوصفة" }).click();
}
test("pharmacy lookup handles errors and draft/already-dispensed records with read-only medications", async ({
  page,
}) => {
  await visit(page, "/pharmacy");
  await page.getByRole("button", { name: "بحث عن الوصفة" }).click();
  await expect(page.locator("#reference-code-error")).toContainText(
    "أدخل رمزًا تجريبيًا",
  );
  await searchCode(page, "INVALID-CODE");
  await expect(page.locator("#reference-code-error")).toContainText(
    "لم نعثر على وصفة",
  );
  await searchCode(page, " demo-rx-1001 ");
  await expect(page.locator(".prescription-document")).toContainText(
    "مريض تجريبي ٠١",
  );
  await expect(
    page.locator(
      ".prescription-document input, .prescription-document textarea, .prescription-document select, .prescription-document [contenteditable='true']",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }),
  ).toBeDisabled();
  await searchCode(page, "DEMO-RX-1003");
  await expect(page.locator(".dispensing-panel")).toContainText(
    "محاكاة الصرف غير متاحة",
  );
  await expect(
    page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }),
  ).toHaveCount(0);
  await searchCode(page, "DEMO-RX-1002");
  await expect(page.locator(".dispensing-panel")).toContainText(
    "لا يمكن تكرار المحاكاة",
  );
  await expect(
    page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }),
  ).toHaveCount(0);
});

test("dispensing requires identity checkbox and explicit confirmation, prevents local repeat, resets on reload", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await visit(page, "/pharmacy");
  await searchCode(page, "DEMO-RX-1001");
  const verify = page.getByRole("checkbox");
  await verify.check();
  await page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }).click();
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "تأكيد المحاكاة فقط" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }).click();
  await verify.uncheck();
  await expect(
    page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }),
  ).toBeDisabled();
  await verify.check();
  await page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }).click();
  await page.getByRole("button", { name: "تأكيد المحاكاة فقط" }).click();
  await expect(
    page.getByText("تمت محاكاة الصرف محليًا فقط", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }),
  ).toHaveCount(0);
  await searchCode(page, "DEMO-RX-1004");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await searchCode(page, "DEMO-RX-1001");
  await expect(
    page.getByText("تمت محاكاة الصرف محليًا فقط", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.reload();
  await searchCode(page, "DEMO-RX-1001");
  await expect(
    page.getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" }),
  ).toBeDisabled();
  await expect(page.locator(".result-heading .status-badge")).toContainText(
    "جاهزة",
  );
});
