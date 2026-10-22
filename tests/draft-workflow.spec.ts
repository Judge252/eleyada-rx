import { expect, test } from "@playwright/test";
import { uiSignIn } from "./auth-helpers";
import { createClient } from "@supabase/supabase-js";
import { boundedFetch, credentials } from "./auth-helpers";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Prepared, deliberately NOT run before migration and synthetic deletion approval.
test("persisted draft: create, reload, new session, reopen, edit, reload, delete", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_DRAFT_WRITES !== "1",
    "New hosted migration and synthetic draft-write/delete verification require approval.",
  );
  test.setTimeout(120_000);
  let id: string | undefined;
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: boundedFetch },
    },
  );
  type Ledger = {
    patientIds: string[];
    draftIds: string[];
    deletedDraftIds: string[];
  };
  let ledger: Ledger;
  try {
    ledger = JSON.parse(
      await readFile(".local/phase4a-acceptance-records.json", "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    ledger = { patientIds: [], draftIds: [], deletedDraftIds: [] };
  }
  const record = async () => {
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/phase4a-acceptance-records.json",
      JSON.stringify(ledger, null, 2),
    );
  };
  const apiLogin = async () => {
    expect(
      !(await client.auth.signInWithPassword(credentials("doctor"))).error,
    ).toBe(true);
  };
  await apiLogin();
  const retained = await client
    .from("patients")
    .select("name")
    .eq("id", ledger.patientIds[0])
    .single();
  expect(!retained.error).toBe(true);
  const marker = retained.data!.name;
  await uiSignIn(page, "doctor");
  try {
    await page
      .getByRole("link", { name: "إنشاء مسودة", exact: true })
      .first()
      .click();
    await page
      .getByLabel("اختيار المريض", { exact: true })
      .selectOption("existing");
    await page.getByLabel("البحث عن مريض بالاسم").fill(marker);
    await page
      .getByRole("button", { name: "بحث عن مريض", exact: true })
      .click();
    await page.locator(".patient-options button").click();
    await page.getByRole("button", { name: "إضافة دواء آخر" }).click();
    for (const index of [0, 1])
      for (const [field, value] of Object.entries({
        medication_name: `SYNTHETIC NOT FOR TREATMENT ${index + 1}`,
        strength: "test",
        dose: "test",
        frequency: "test",
        duration: "test",
        quantity: String(index + 1),
      }))
        await page.locator(`[id="${index}-${field}"]`).fill(value);
    await page
      .getByRole("button", { name: "مراجعة المسودة", exact: true })
      .click();
    // Two clicks cannot dispatch duplicate saves; DB request identity also serializes.
    await page
      .getByRole("button", { name: "حفظ المسودة", exact: true })
      .dblclick();
    await expect(page).toHaveURL(
      /\/doctor\/prescriptions\/[0-9a-f-]+\?saved=1$/,
      { timeout: 20_000 },
    );
    id = new URL(page.url()).pathname.split("/").at(-1);
    if (!id) throw new Error("Saved synthetic draft ID missing");
    ledger.draftIds.push(id);
    await apiLogin();
    const persisted = await client
      .from("prescriptions")
      .select("patient_id")
      .eq("id", id)
      .single();
    expect(!persisted.error).toBe(true);
    expect(persisted.data!.patient_id === ledger.patientIds[0]).toBe(true);
    await record();
    await page.reload();
    expect(
      (await page.locator(".document-patient").textContent())?.includes(marker),
    ).toBe(true);
    await expect(page.locator(".document-medication")).toHaveCount(2);
    expect(
      (await page.locator(".document-medication h3").allTextContents()).every(
        (text, index) => text === `SYNTHETIC NOT FOR TREATMENT ${index + 1}`,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "تسجيل الخروج", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    await uiSignIn(page, "doctor");
    await page.getByLabel("البحث في الوصفات").fill(marker);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.locator(".table-action").click();
    await page
      .getByRole("link", { name: "تعديل المسودة", exact: true })
      .click();
    await expect(page.getByLabel("اسم المريض", { exact: true })).toHaveCount(0);
    await page.locator('[id="0-quantity"]').fill("9");
    await page
      .getByRole("button", { name: "مراجعة المسودة", exact: true })
      .click();
    await page
      .getByRole("button", { name: "حفظ المسودة", exact: true })
      .click();
    await expect(page).toHaveURL(/\?saved=1$/, { timeout: 20_000 });
    await page.reload();
    expect(
      (
        await page.locator(".document-medication").first().textContent()
      )?.includes("9"),
    ).toBe(true);
    await page
      .getByRole("button", { name: "حذف المسودة", exact: true })
      .click();
    await page
      .getByRole("button", { name: "تأكيد حذف المسودة", exact: true })
      .click();
    await expect(page).toHaveURL(/\/doctor\?deleted=1$/, { timeout: 20_000 });
    ledger.deletedDraftIds.push(id);
    await record();
    await page.goto(`/doctor/prescriptions/${id}`);
    await expect(
      page.getByRole("heading", { name: "لم نعثر على هذه الصفحة" }),
    ).toBeVisible();
    id = undefined;
  } finally {
    // Only this explicitly approved synthetic draft; never delete a patient record.
    if (id) {
      await page.goto(`/doctor/prescriptions/${id}`);
      const remove = page.getByRole("button", {
        name: "حذف المسودة",
        exact: true,
      });
      if (await remove.count()) {
        await remove.click();
        await page
          .getByRole("button", { name: "تأكيد حذف المسودة", exact: true })
          .click();
        await expect(page).toHaveURL(/\/doctor\?deleted=1$/, {
          timeout: 20_000,
        });
        ledger.deletedDraftIds.push(id);
        await record();
      }
    }
  }
});
