import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import { boundedFetch, credentials, uiSignIn } from "./auth-helpers";

// Opt-in, ordinary signed-user clients only. No owner SQL or account changes.
test("persisted draft: existing patient, lost response retry, stale browser/API writes and pharmacy isolation", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.E2E_DRAFT_WRITES !== "1" ||
      process.env.E2E_DRAFT_CONFLICT_FIX !== "1",
    "Requires owner write approval AND separately approved/applied PT409 corrective migration; original 40001 conflicts loop in hosted PostgREST",
  );
  test.setTimeout(180_000);
  const ledger = JSON.parse(
    await readFile(".local/phase4a-acceptance-records.json", "utf8"),
  ) as { patientIds: string[]; draftIds: string[]; deletedDraftIds: string[] };
  const record = () =>
    writeFile(
      ".local/phase4a-acceptance-records.json",
      JSON.stringify(ledger, null, 2),
    );
  const client = () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: boundedFetch },
      },
    );
  const doctor = client();
  expect(
    !(await doctor.auth.signInWithPassword(credentials("doctor"))).error,
  ).toBe(true);
  const patientId = ledger.patientIds[0];
  expect(Boolean(patientId)).toBe(true);
  const patient = await doctor
    .from("patients")
    .select("name,patient_identifier")
    .eq("id", patientId)
    .single();
  expect(!patient.error).toBe(true);
  const counts = async () => {
    const results = await Promise.all(
      ["patients", "prescriptions", "prescription_items"].map((table) =>
        doctor.from(table).select("id", { count: "exact", head: true }),
      ),
    );
    expect(results.every((r) => !r.error)).toBe(true);
    return results.map((r) => r.count);
  };
  const baseline = await counts();
  let id: string | undefined;
  await uiSignIn(page, "doctor");
  try {
    await page.goto("/doctor/prescriptions/new");
    await page
      .getByLabel("اختيار المريض", { exact: true })
      .selectOption("existing");
    await page.getByLabel("البحث عن مريض بالاسم").fill(patient.data!.name);
    await page
      .getByRole("button", { name: "بحث عن مريض", exact: true })
      .click();
    await page.locator(".patient-options button").click();
    await expect(page.getByLabel("اسم المريض", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "إضافة دواء آخر" }).click();
    const items = [0, 1].map((index) => ({
      medication_name: `SYNTHETIC RETRY ONLY ${index + 1}`,
      strength: `test ${index + 1}`,
      dose: `test ${index + 1}`,
      frequency: `test ${index + 1}`,
      duration: `test ${index + 1}`,
      quantity: index + 3,
      special_instructions: `TEST ONLY ${index + 1}`,
    }));
    for (const [index, item] of items.entries())
      for (const [key, value] of Object.entries(item))
        await page.locator(`[id="${index}-${key}"]`).fill(String(value));
    await page
      .getByLabel("ملاحظات الطبيب (اختياري)")
      .fill("SYNTHETIC ACCEPTANCE ONLY");
    await page
      .getByRole("button", { name: "مراجعة المسودة", exact: true })
      .click();
    let interrupted = false;
    let responseLost = false;
    await page.route("**/*", async (route) => {
      if (
        !interrupted &&
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        interrupted = true;
        const response = await route.fetch({ timeout: 15_000 });
        expect(response.ok()).toBe(true);
        // Server committed; intentionally lose the response, never the credentials.
        await route.abort("failed");
        responseLost = true;
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "حفظ المسودة", exact: true })
      .click();
    await expect.poll(() => responseLost, { timeout: 25000 }).toBe(true);
    const committed = await doctor
      .from("prescriptions")
      .select("id,updated_at,draft_request_id")
      .eq("patient_id", patientId)
      .single();
    expect(!committed.error).toBe(true);
    id = committed.data!.id;
    ledger.draftIds.push(id!);
    await record();
    await expect(page.locator(".feedback-message[role=alert]")).toContainText(
      "تعذّر تأكيد الحفظ",
      { timeout: 25000 },
    );
    expect(interrupted).toBe(true);
    await page
      .getByRole("button", { name: "حفظ المسودة", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/prescriptions/${id}\\?saved=1$`),
      { timeout: 25000 },
    );
    await page.unroute("**/*");
    const payload = {
      p_request_id: committed.data!.draft_request_id,
      p_patient: { id: patientId },
      p_items: items,
      p_doctor_notes: "SYNTHETIC ACCEPTANCE ONLY",
    };
    const retries = await Promise.all([
      doctor.rpc("save_doctor_draft", payload),
      doctor.rpc("save_doctor_draft", payload),
    ]);
    expect(
      retries.every(
        (r) => !r.error && r.data.id === id && r.data.replayed === true,
      ),
    ).toBe(true);
    expect(await counts()).toEqual([
      baseline[0],
      baseline[1]! + 1,
      baseline[2]! + 2,
    ]);
    await page.reload();
    const snapshot = await doctor
      .from("prescription_items")
      .select(
        "medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order",
      )
      .eq("prescription_id", id)
      .order("sort_order");
    expect(
      !snapshot.error &&
        JSON.stringify(
          snapshot.data?.map(({ sort_order, ...item }) => ({
            ...item,
            sort_order,
          })),
        ) ===
          JSON.stringify(
            items.map((item, index) => ({ ...item, sort_order: index })),
          ),
    ).toBe(true);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".document-warning")).toContainText(
      "غير صالحة للصرف",
    );
    await expect(page.locator(".reference-box")).toHaveCount(0);
    await page.emulateMedia({ media: "screen" });
    // Keep two actual browser pages on v1, then commit v2 through the user API.
    const staleDelete = await page.context().newPage();
    await staleDelete.goto(`/doctor/prescriptions/${id}`);
    await page.bringToFront();
    await page
      .getByRole("link", { name: "تعديل المسودة", exact: true })
      .click();
    for (const [index, item] of items.entries())
      for (const [key, value] of Object.entries(item))
        expect(
          (await page.locator(`[id="${index}-${key}"]`).inputValue()) ===
            String(value),
        ).toBe(true);
    expect(
      (await page.getByLabel("ملاحظات الطبيب (اختياري)").inputValue()) ===
        payload.p_doctor_notes,
    ).toBe(true);
    const edit = {
      ...payload,
      p_prescription_id: id,
      p_expected_updated_at: committed.data!.updated_at,
      p_items: items.map((item, index) => ({
        ...item,
        quantity: index === 0 ? 5 : item.quantity,
      })),
    };
    const updated = await doctor.rpc("save_doctor_draft", edit);
    expect(!updated.error && updated.data.replayed === false).toBe(true);
    expect(updated.data.updated_at !== committed.data!.updated_at).toBe(true);
    const staleApiProbe = await doctor.rpc("save_doctor_draft", {
      ...edit,
      p_doctor_notes: "SYNTHETIC STALE PROBE ONLY",
    });
    expect(staleApiProbe.error?.code === "PT409").toBe(true);
    expect(staleApiProbe.status).toBe(409);
    await page.locator('[id="0-quantity"]').fill("6");
    await page
      .getByRole("button", { name: "مراجعة المسودة", exact: true })
      .click();
    await page
      .getByRole("button", { name: "حفظ المسودة", exact: true })
      .click();
    await expect(page.locator(".feedback-message[role=alert]")).toContainText(
      "تغيّرت المسودة",
      {
        timeout: 20000,
      },
    );
    // A rejected action must not silently adopt the new server version.
    await page
      .getByRole("button", { name: "حفظ المسودة", exact: true })
      .click();
    await expect(page.locator(".feedback-message[role=alert]")).toContainText(
      "تغيّرت المسودة",
    );
    await page.getByRole("button", { name: "العودة للتعديل" }).click();
    expect((await page.locator('[id="0-quantity"]').inputValue()) === "6").toBe(
      true,
    );
    await staleDelete.bringToFront();
    await staleDelete
      .getByRole("button", { name: "حذف المسودة", exact: true })
      .click();
    await staleDelete
      .getByRole("button", { name: "تأكيد حذف المسودة", exact: true })
      .click();
    await expect(staleDelete.locator("p[role=alert]")).toContainText(
      "تغيّرت المسودة",
      { timeout: 20000 },
    );
    await staleDelete
      .getByRole("button", { name: "تأكيد حذف المسودة", exact: true })
      .click();
    await expect(staleDelete.locator("p[role=alert]")).toContainText(
      "تغيّرت المسودة",
    );
    await staleDelete.close();
    await page.bringToFront();
    const staleSave = await doctor.rpc("save_doctor_draft", {
      ...edit,
      p_doctor_notes: "SYNTHETIC STALE ONLY",
    });
    expect(staleSave.error?.code === "PT409" && staleSave.status === 409).toBe(
      true,
    );
    const staleRemove = await doctor.rpc("delete_doctor_draft", {
      p_id: id,
      p_expected_updated_at: committed.data!.updated_at,
    });
    expect(
      staleRemove.error?.code === "PT409" && staleRemove.status === 409,
    ).toBe(true);
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload();
    expect((await page.locator('[id="0-quantity"]').inputValue()) === "5").toBe(
      true,
    );
    // Failed validation and missing-patient operations cannot add any rows.
    const beforeFailure = await counts();
    expect(
      (
        await doctor.rpc("save_doctor_draft", {
          ...payload,
          p_request_id: crypto.randomUUID(),
          p_patient: {
            name: "SYNTHETIC REJECTED ONLY",
            patient_identifier: "TEST",
          },
          p_items: [{ ...items[0], quantity: 0 }],
        })
      ).error?.code === "22023",
    ).toBe(true);
    expect(
      (
        await doctor.rpc("save_doctor_draft", {
          ...payload,
          p_request_id: crypto.randomUUID(),
          p_patient: { id: crypto.randomUUID() },
        })
      ).error?.code === "42501",
    ).toBe(true);
    expect(await counts()).toEqual(beforeFailure);
    expect(
      (await doctor.from("prescriptions").select("reference_digest")).error
        ?.code === "42501",
    ).toBe(true);
    const pharmacist = client();
    expect(
      !(await pharmacist.auth.signInWithPassword(credentials("pharmacist")))
        .error,
    ).toBe(true);
    for (const [table, key, value] of [
      ["patients", "id", patientId],
      ["prescriptions", "id", id],
      ["prescription_items", "prescription_id", id],
    ] as const) {
      const read = await pharmacist.from(table).select("id").eq(key, value);
      expect(!read.error && read.data.length === 0).toBe(true);
    }
    expect(
      (await pharmacist.rpc("save_doctor_draft", payload)).error?.code ===
        "42501",
    ).toBe(true);
    expect(
      (
        await pharmacist.rpc("delete_doctor_draft", {
          p_id: id,
          p_expected_updated_at: updated.data.updated_at,
        })
      ).error?.code === "42501",
    ).toBe(true);
    const pharmacyContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3107",
    });
    const pharmacy = await pharmacyContext.newPage();
    await uiSignIn(pharmacy, "pharmacist");
    await pharmacy.goto(`/doctor/prescriptions/${id}`);
    await expect(pharmacy).toHaveURL(/\/pharmacy$/);
    await pharmacy.getByLabel("رمز الوصفة التجريبي", { exact: true }).fill(id!);
    await pharmacy.getByRole("button", { name: "بحث عن الوصفة" }).click();
    await expect(pharmacy.locator("#reference-code-error")).toContainText(
      "لم نعثر على وصفة",
    );
    await pharmacy
      .getByLabel("رمز الوصفة التجريبي", { exact: true })
      .fill("DEMO-RX-1001");
    await pharmacy.getByRole("button", { name: "بحث عن الوصفة" }).click();
    await pharmacy.getByRole("checkbox").check();
    await pharmacy
      .getByRole("button", { name: "محاكاة صرف الوصفة بالكامل" })
      .click();
    await pharmacy.getByRole("button", { name: "تأكيد المحاكاة فقط" }).click();
    await expect(
      pharmacy.getByText("تمت محاكاة الصرف محليًا فقط", { exact: true }),
    ).toBeVisible();
    await pharmacyContext.close();
    expect(await counts()).toEqual(beforeFailure);
    const stillDraft = await doctor
      .from("prescriptions")
      .select("status,updated_at")
      .eq("id", id)
      .single();
    expect(
      !stillDraft.error &&
        stillDraft.data.status === "draft" &&
        stillDraft.data.updated_at === updated.data.updated_at,
    ).toBe(true);
    const unchanged = await doctor
      .from("patients")
      .select("name,patient_identifier")
      .eq("id", patientId)
      .single();
    expect(
      !unchanged.error &&
        JSON.stringify(unchanged.data) === JSON.stringify(patient.data),
    ).toBe(true);
  } finally {
    await page.unroute("**/*");
    if (id) {
      const latest = await doctor
        .from("prescriptions")
        .select("updated_at")
        .eq("id", id)
        .single();
      expect(!latest.error).toBe(true);
      expect(
        (
          await doctor.rpc("delete_doctor_draft", {
            p_id: id,
            p_expected_updated_at: latest.data!.updated_at,
          })
        ).data === true,
      ).toBe(true);
      ledger.deletedDraftIds.push(id);
      await record();
    }
  }
  expect(await counts()).toEqual(baseline);
  // Global UI logout must revoke the independently signed-in API session too.
  page.once("dialog", (dialog) => dialog.accept());
  await page.goto("/doctor");
  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(
    (
      await doctor.rpc("save_doctor_draft", {
        p_request_id: crypto.randomUUID(),
        p_patient: { id: patientId },
        p_items: [],
        p_doctor_notes: "",
      })
    ).error?.code === "42501",
  ).toBe(true);
});
