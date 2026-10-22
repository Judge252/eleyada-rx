// Continue only the two existing approved immutable histories. Never creates clinical records.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFile, writeFile, open, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
const source = "fckdsiozmufyhbnignet",
  origin = "http://127.0.0.1:3107";
const check = (b, label) => {
  if (!b) throw Error(label);
};
const data = (r, label) => {
  check(!r.error && r.data !== null, label);
  return r.data;
};
export async function finishAcceptance(
  credentials,
  { sessionOnly = false } = {},
) {
  const lockPath = ".local/phase4b-acceptance.lock",
    lock = await open(lockPath, "wx");
  const earlier = JSON.parse(
    await readFile(".local/phase4b-hosted-result.json", "utf8"),
  );
  const results = earlier.results.filter((r) => r.passed);
  let stage = "resume_existing_histories",
    browser;
  const report = () =>
    writeFile(
      ".local/phase4b-hosted-result.json",
      JSON.stringify({ project: source, stage, results }, null, 2),
    );
  const pass = async (label) => {
    results.push({ check: label, passed: true });
    await report();
    console.log("PASS", label);
  };
  const client = () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: (u, i) =>
            fetch(u, {
              ...i,
              signal: AbortSignal.any([
                AbortSignal.timeout(10000),
                ...(i?.signal ? [i.signal] : []),
              ]),
            }),
        },
      },
    );
  const doctor = client(),
    pharmacist = client(),
    anonymous = client();
  const login = async (c, role) =>
    check(
      !(await c.auth.signInWithPassword(credentials[role])).error,
      "REAL_AUTH_FAILED",
    );
  const rpc = (c, n, a) => c.rpc(n, a).abortSignal(AbortSignal.timeout(10000));
  try {
    check(
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname ===
        `${source}.supabase.co`,
      "SOURCE_MISMATCH",
    );
    const ledger = JSON.parse(
      await readFile(".local/phase4b-hosted-records.json", "utf8"),
    );
    check(
      ledger.retainedPrescriptionIds.length === 2,
      "BOUNDED_LEDGER_MISMATCH",
    );
    const [a, b] = ledger.retainedPrescriptionIds;
    await login(doctor, "doctor");
    await login(pharmacist, "pharmacist");
    const headers = data(
      await doctor
        .from("prescriptions")
        .select(
          "id,status,patient_id,updated_at,issued_at,expires_at,draft_request_id",
        ),
      "HEADER_READ_FAILED",
    );
    check(
      headers.length === 2 &&
        headers.find((r) => r.id === a)?.status === "issued" &&
        headers.find((r) => r.id === b)?.status === "cancelled" &&
        headers.every((r) => r.patient_id === ledger.patientIds[0]),
      "EXISTING_HISTORY_MISMATCH",
    );
    if (sessionOnly) {
      stage = "mobile_logout_and_revocation";
      await report();
      const original = data(
        await rpc(doctor, "reveal_doctor_reference", { p_id: a }),
        "SESSION_BASELINE_REFERENCE_FAILED",
      );
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        locale: "ar-EG",
        viewport: { width: 320, height: 1000 },
      });
      const p = await ctx.newPage();
      p.setDefaultTimeout(20000);
      const uiLogin = async () => {
        await p.goto(`${origin}/login`);
        await p
          .getByLabel("البريد الإلكتروني", { exact: true })
          .fill(credentials.doctor.email);
        await p
          .getByLabel("كلمة المرور", { exact: true })
          .fill(credentials.doctor.password);
        await p
          .getByRole("button", { name: "تسجيل الدخول", exact: true })
          .click();
        await p.waitForURL(/\/doctor$/);
      };
      const post = (body) =>
        p.request.post(`${origin}/api/doctor/prescriptions/${a}/lifecycle`, {
          headers: { Origin: origin, "Content-Type": "application/json" },
          data: body,
          timeout: 15000,
        });
      await uiLogin();
      await p.goto(`${origin}/doctor/prescriptions/${a}`);
      const oldToken = (await doctor.auth.getSession()).data.session
        .access_token;
      const oldCookies = await ctx.cookies();
      // At mobile widths sign-out is intentionally inside the expandable menu.
      await p.getByRole("button", { name: "القائمة", exact: true }).click();
      await p
        .getByRole("button", { name: "تسجيل الخروج", exact: true })
        .click();
      await p.waitForURL(/\/login/);
      await ctx.clearCookies();
      await ctx.addCookies(oldCookies);
      check(
        (await post({ operation: "reveal" })).status() === 403,
        "REVOKED_COOKIE_REPLAY_ALLOWED",
      );
      const calls = [
        ["get_doctor_issue_review", { p_id: a }],
        ["get_doctor_lifecycle", { p_id: a }],
        ["reveal_doctor_reference", { p_id: a }],
        [
          "issue_doctor_prescription",
          {
            p_id: a,
            p_expected_updated_at: headers.find((r) => r.id === a).updated_at,
            p_request_id: randomUUID(),
            p_review_fingerprint: "0".repeat(64),
          },
        ],
        [
          "cancel_doctor_prescription",
          {
            p_id: a,
            p_expected_updated_at: headers.find((r) => r.id === a).updated_at,
            p_request_id: randomUUID(),
            p_reason: "entered_in_error",
          },
        ],
      ];
      for (const [name, args] of calls) {
        const r = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`,
          {
            method: "POST",
            headers: {
              apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${oldToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(args),
            signal: AbortSignal.timeout(10000),
          },
        );
        check(
          r.status === 403 && (await r.json()).code === "42501",
          "REVOKED_NATIVE_RPC_ALLOWED",
        );
      }
      await pass(
        "real_mobile_menu_logout_revoked_cookies_and_all_five_lifecycle_jwt_rpcs_denied",
      );
      await uiLogin();
      await login(doctor, "doctor");
      await p.goto(`${origin}/doctor/prescriptions/${a}`);
      const response = await post({ operation: "reveal" });
      check(
        response.status() === 200 &&
          response.headers()["cache-control"].includes("no-store") &&
          (await response.json()).result.reference === original.reference,
        "FINAL_RELOGIN_REFERENCE_CACHE_FAILED",
      );
      const final = data(
        await doctor.from("prescriptions").select("id,status"),
        "FINAL_COUNTS_FAILED",
      );
      check(
        final.length === 2 &&
          final.filter((r) => r.status === "issued").length === 1 &&
          final.filter((r) => r.status === "cancelled").length === 1,
        "FINAL_DUPLICATE_HISTORY",
      );
      await pass(
        "final_fresh_login_same_reference_no_store_two_histories_only",
      );
      stage = "passed";
      await report();
      return;
    }
    const run = promisify(execFile);
    let receiptOutput;
    try {
      receiptOutput = await run(
        process.execPath,
        [
          "node_modules/supabase/dist/supabase.js",
          "db",
          "query",
          "--linked",
          "--project-ref",
          source,
          "--file",
          "tests/database/hosted-phase4b-acceptance-receipts.sql",
          "--agent",
          "no",
          "--output-format",
          "json",
        ],
        { timeout: 20000, maxBuffer: 1000000 },
      );
    } catch {
      throw Error("RETRY_METADATA_READ_FAILED");
    }
    const metadata = JSON.parse(receiptOutput.stdout)[0].retry_metadata;
    receiptOutput = null;
    check(
      metadata.issuance.length === 2 && metadata.cancellation.id === b,
      "RETRY_RECEIPTS_MISMATCH",
    );
    const ca = metadata.cancellation;
    const cancelArgs = {
      p_id: b,
      p_expected_updated_at: ca.version,
      p_request_id: ca.request,
      p_reason: ca.reason,
    };
    const replay = data(
      await rpc(doctor, "cancel_doctor_prescription", cancelArgs),
      "CANCELLATION_REPLAY_FAILED",
    );
    check(
      replay.replayed &&
        replay.cancelled_at === ca.cancelled_at &&
        replay.reason === ca.reason,
      "CANCELLATION_REPLAY_CHANGED",
    );
    const conflict = async (name, args) => {
      const started = performance.now();
      const r = await rpc(doctor, name, args);
      check(
        r.status === 409 &&
          r.error?.code === "PT409" &&
          performance.now() - started < 10000,
        "NATIVE_CONFLICT_FAILED_STOP_NO_RETRY",
      );
    };
    await conflict("cancel_doctor_prescription", {
      ...cancelArgs,
      p_reason: "duplicate_prescription",
    });
    await conflict("cancel_doctor_prescription", {
      ...cancelArgs,
      p_request_id: randomUUID(),
    });
    await pass(
      "native_cancellation_identical_replay_original_reason_time_changed_payload_conflicts",
    );
    const references = [];
    for (const id of [a, b]) {
      const first = data(
        await rpc(doctor, "reveal_doctor_reference", { p_id: id }),
        "REFERENCE_READ_FAILED",
      );
      const ir = metadata.issuance.find((r) => r.id === id);
      const issueArgs = {
        p_id: id,
        p_expected_updated_at: ir.version,
        p_request_id: ir.request,
        p_review_fingerprint: ir.fingerprint,
      };
      const retries = await Promise.all([
        rpc(doctor, "issue_doctor_prescription", issueArgs),
        rpc(doctor, "issue_doctor_prescription", issueArgs),
      ]);
      check(
        retries.every(
          (r) =>
            !r.error &&
            r.data.replayed &&
            r.data.reference === first.reference &&
            r.data.issued_at === first.issued_at &&
            r.data.expires_at === first.expires_at,
        ),
        "ISSUANCE_REPLAY_CHANGED_HISTORY",
      );
      check(
        Date.parse(first.expires_at) - Date.parse(first.issued_at) ===
          7 * 86400000,
        "VALIDITY_CHANGED",
      );
      references.push(first.reference);
    }
    check(references[0] !== references[1], "REFERENCE_UNIQUENESS_FAILED");
    await pass(
      "native_both_histories_concurrent_issuance_replays_same_references_times_no_new_issuance",
    );
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "ar-EG",
      timezoneId: "Africa/Cairo",
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const uiLogin = async (p, role) => {
      await p.goto(`${origin}/login`);
      await p
        .getByLabel("البريد الإلكتروني", { exact: true })
        .fill(credentials[role].email);
      await p
        .getByLabel("كلمة المرور", { exact: true })
        .fill(credentials[role].password);
      await p
        .getByRole("button", { name: "تسجيل الدخول", exact: true })
        .click();
      await p.waitForURL(role === "doctor" ? /\/doctor$/ : /\/pharmacy$/);
    };
    const post = (p, id, body) =>
      p.request.post(`${origin}/api/doctor/prescriptions/${id}/lifecycle`, {
        headers: { Origin: origin, "Content-Type": "application/json" },
        data: body,
        timeout: 15000,
      });
    await uiLogin(page, "doctor");
    stage = "browser_existing_history_verification";
    await report();
    for (const [index, id] of [a, b].entries()) {
      await page.goto(`${origin}/doctor/prescriptions/${id}`);
      await page.reload();
      check(
        (await page.locator(".document-medication").count()) === 2 &&
          (await page.locator(".secure-reference").count()) === 0,
        "BROWSER_HISTORY_OR_EPHEMERAL_REFERENCE_FAILED",
      );
      check(
        (await page
          .getByRole("link", { name: "تعديل المسودة", exact: true })
          .count()) === 0,
        "ISSUED_EDIT_LINK_EXPOSED",
      );
      if (index === 1) {
        check(
          (await page.locator(".document-label").innerText()).includes("ملغاة"),
          "CANCELLATION_LABEL_MISSING",
        );
        check(
          (await page
            .getByRole("button", { name: "تأكيد إلغاء الوصفة", exact: true })
            .count()) === 0,
          "CANCELLED_RECORD_ELIGIBLE_AGAIN",
        );
        const browserReplay = await post(page, b, {
          operation: "cancel",
          requestId: ca.request,
          version: ca.version,
          reason: ca.reason,
          confirmed: true,
        });
        check(
          browserReplay.status() === 200 &&
            (await browserReplay.json()).result.replayed,
          "BROWSER_CANCELLATION_REPLAY_FAILED",
        );
      }
      await page.evaluate(() => {
        window.__prints = 0;
        window.print = () => {
          window.__prints++;
        };
      });
      for (let count = 1; count <= 2; count++) {
        await page
          .getByRole("button", { name: "استرجاع النسخة وطباعتها", exact: true })
          .click();
        await page.waitForFunction((n) => window.__prints === n, count);
        check(
          (await page.locator(".secure-reference").innerText()) ===
            references[index],
          "BROWSER_REPRINT_REFERENCE_CHANGED",
        );
        await page.emulateMedia({ media: "print" });
        check(
          await page.locator(".issued-document").isVisible(),
          "PRINT_LAYOUT_HIDDEN",
        );
        if (index === 1)
          check(
            (
              await page.locator(".document-warning").first().innerText()
            ).includes("غير صالحة للصرف"),
            "CANCELLED_PRINT_WARNING_MISSING",
          );
        await page.emulateMedia({ media: "screen" });
        check(
          !(await page.evaluate(
            (code) =>
              location.href.includes(code) ||
              JSON.stringify({
                local: { ...localStorage },
                session: { ...sessionStorage },
              }).includes(code),
            references[index],
          )),
          "BROWSER_REFERENCE_PERSISTENCE",
        );
        await page.evaluate(() =>
          window.dispatchEvent(new Event("afterprint")),
        );
        await page.locator(".secure-reference").waitFor({ state: "detached" });
      }
      await page.goto(`${origin}/doctor/prescriptions/${id}/edit`);
      check(
        (await page.locator("h1").innerText()).includes("غير قابل للتعديل"),
        "BROWSER_ISSUED_EDIT_NOT_BLOCKED",
      );
    }
    await pass(
      "real_browser_issued_cancelled_reload_same_reference_reprints_warning_ephemeral_code_readonly",
    );
    const itemsBefore = data(
      await doctor
        .from("prescription_items")
        .select(
          "prescription_id,medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order",
        )
        .order("sort_order"),
      "ITEMS_READ_FAILED",
    );
    for (const id of [a, b]) {
      const rows = itemsBefore.filter((r) => r.prescription_id === id);
      check(
        rows.length === 2 &&
          rows.every(
            (r, i) =>
              r.medication_name === `SYNTHETIC 4B TEST ITEM ${i + 1}` &&
              r.quantity === i + 3 &&
              r.sort_order === i,
          ),
        "MEDICATION_VALUES_ORDER_CHANGED",
      );
      const payload = {
        p_request_id: randomUUID(),
        p_patient: { id: ledger.patientIds[0] },
        p_items: rows.map(({ prescription_id, sort_order, ...r }) => {
          void prescription_id;
          void sort_order;
          return r;
        }),
        p_doctor_notes: "SYNTHETIC FORBIDDEN EDIT",
        p_prescription_id: id,
        p_expected_updated_at: headers.find((r) => r.id === id).updated_at,
      };
      check(
        (await rpc(doctor, "save_doctor_draft", payload)).error?.code ===
          "42501",
        "ISSUED_DRAFT_EDIT_ALLOWED",
      );
      check(
        (
          await rpc(doctor, "delete_doctor_draft", {
            p_id: id,
            p_expected_updated_at: payload.p_expected_updated_at,
          })
        ).error?.code === "42501",
        "ISSUED_DRAFT_DELETE_ALLOWED",
      );
    }
    const patientBefore = data(
      await doctor
        .from("patients")
        .select("id,name,patient_identifier")
        .single(),
      "PATIENT_READ_FAILED",
    );
    check(
      Boolean(
        (
          await doctor
            .from("patients")
            .update({ name: "SYNTHETIC FORBIDDEN CORRECTION" })
            .eq("id", ledger.patientIds[0])
        ).error,
      ),
      "HISTORICAL_PATIENT_EDIT_ALLOWED",
    );
    check(
      JSON.stringify(patientBefore) ===
        JSON.stringify(
          data(
            await doctor
              .from("patients")
              .select("id,name,patient_identifier")
              .single(),
            "PATIENT_RECHECK_FAILED",
          ),
        ),
      "PATIENT_HISTORY_CHANGED",
    );
    check(
      JSON.stringify(itemsBefore) ===
        JSON.stringify(
          data(
            await doctor
              .from("prescription_items")
              .select(
                "prescription_id,medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order",
              )
              .order("sort_order"),
            "ITEMS_RECHECK_FAILED",
          ),
        ),
      "ITEM_HISTORY_CHANGED",
    );
    await pass("native_issued_cancelled_items_and_linked_patient_immutable");
    const ir = metadata.issuance.find((r) => r.id === a);
    const calls = [
      ["get_doctor_issue_review", { p_id: a }],
      ["get_doctor_lifecycle", { p_id: a }],
      ["reveal_doctor_reference", { p_id: a }],
      [
        "issue_doctor_prescription",
        {
          p_id: a,
          p_expected_updated_at: ir.version,
          p_request_id: ir.request,
          p_review_fingerprint: ir.fingerprint,
        },
      ],
      ["cancel_doctor_prescription", { ...cancelArgs, p_id: a }],
    ];
    for (const c of [anonymous, pharmacist])
      for (const [name, args] of calls)
        check(
          (await rpc(c, name, args)).error?.code === "42501",
          "UNAUTHORIZED_NATIVE_RPC_ALLOWED",
        );
    for (const table of [
      "patients",
      "prescriptions",
      "prescription_items",
      "dispensations",
    ])
      check(
        data(
          await pharmacist.from(table).select("id"),
          "PHARMACIST_READ_FAILED",
        ).length === 0,
        "PHARMACIST_REAL_RECORD_LEAK",
      );
    for (const c of [doctor, pharmacist])
      check(
        (await c.from("prescriptions").select("reference_digest")).error
          ?.code === "42501",
        "REFERENCE_DIGEST_EXPOSED",
      );
    const pharmacyContext = await browser.newContext({ locale: "ar-EG" }),
      pharmacyPage = await pharmacyContext.newPage();
    await uiLogin(pharmacyPage, "pharmacist");
    for (const operation of ["issue", "reveal", "cancel"])
      check(
        (await post(pharmacyPage, a, { operation })).status() === 403,
        "PHARMACIST_APP_RPC_ALLOWED",
      );
    await pharmacyPage
      .getByLabel("رمز الوصفة التجريبي", { exact: true })
      .fill(references[0]);
    await pharmacyPage
      .getByRole("button", { name: "بحث عن الوصفة", exact: true })
      .click();
    check(
      (
        await pharmacyPage.locator("#reference-code-error").innerText()
      ).includes("لم نعثر") &&
        (await pharmacyPage.locator(".pharmacy-result").count()) === 0,
      "SIMULATION_DISCOVERED_REAL_RECORD",
    );
    const anonContext = await browser.newContext(),
      anonPage = await anonContext.newPage();
    for (const operation of ["issue", "reveal", "cancel"])
      check(
        (await post(anonPage, a, { operation })).status() === 403,
        "ANONYMOUS_APP_RPC_ALLOWED",
      );
    await pass(
      "real_pharmacist_anonymous_all_lifecycle_rpc_api_denial_rls_digest_and_simulation_isolation",
    );
    await page.goto(`${origin}/doctor/prescriptions/${a}`);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      check(
        await page.evaluate(
          () =>
            document.documentElement.dir === "rtl" &&
            document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "RTL_OVERFLOW_FAILED",
      );
    }
    await pass("final_source_arabic_rtl_desktop_320px");
    await page.getByRole("button", { name: "القائمة", exact: true }).click();
    const oldToken = (await doctor.auth.getSession()).data.session.access_token,
      oldCookies = await context.cookies();
    await page
      .getByRole("button", { name: "تسجيل الخروج", exact: true })
      .click();
    await page.waitForURL(/\/login/);
    await context.clearCookies();
    await context.addCookies(oldCookies);
    check(
      (await post(page, a, { operation: "reveal" })).status() === 403,
      "REVOKED_COOKIE_REPLAY_ALLOWED",
    );
    for (const [name, args] of calls) {
      const denied = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`,
        {
          method: "POST",
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${oldToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(10000),
        },
      );
      check(
        denied.status === 403 && (await denied.json()).code === "42501",
        "REVOKED_NATIVE_RPC_ALLOWED",
      );
    }
    await pass(
      "real_globally_revoked_cookies_and_all_lifecycle_jwt_rpc_denied",
    );
    await uiLogin(page, "doctor");
    await login(doctor, "doctor");
    await page.goto(`${origin}/doctor/prescriptions/${a}`);
    const reveal = await post(page, a, { operation: "reveal" });
    check(
      reveal.status() === 200 &&
        reveal.headers()["cache-control"].includes("no-store") &&
        (await reveal.json()).result.reference === references[0],
      "FINAL_RELOGIN_REFERENCE_CACHE_FAILED",
    );
    check(
      data(
        await doctor.from("prescriptions").select("id,status"),
        "FINAL_COUNTS_FAILED",
      ).length === 2,
      "FINAL_DUPLICATE_HISTORY",
    );
    await pass("final_relogin_same_reference_no_store_two_histories_only");
    stage = "passed";
    await report();
  } catch (e) {
    const label = /^[A-Z0-9_]+$/.test(e.message)
      ? e.message
      : "SANITIZED_BROWSER_OR_NETWORK_FAILURE";
    results.push({ check: label, passed: false });
    await report();
    throw Error(label);
  } finally {
    if (browser) await browser.close();
    await doctor.auth.signOut({ scope: "local" }).catch(() => {});
    await pharmacist.auth.signOut({ scope: "local" }).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
