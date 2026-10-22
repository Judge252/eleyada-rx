// Bounded opt-in hosted acceptance. No trace/HAR/screenshots/PDF/storage state.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, access, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const origin = "http://127.0.0.1:3107";
const resultPath = ".local/phase4b-hosted-result.json";
const ledgerPath = ".local/phase4b-hosted-records.json";
const check = (condition, label) => {
  if (!condition) throw Error(label);
};
const ok = (r, label) => {
  check(!r.error && r.data !== null, label);
  return r.data;
};
export async function runAcceptance(
  credentials,
  { resumeExistingDrafts = false } = {},
) {
  // Two operator windows must never consume the bounded fixture allowance twice.
  const lockPath = ".local/phase4b-acceptance.lock";
  const lock = await open(lockPath, "wx").catch(() => {
    throw Error("ACCEPTANCE_LOCKED_INSPECT_DO_NOT_REPEAT");
  });
  const results = [];
  let stage = "preflight";
  const report = async () =>
    writeFile(
      resultPath,
      JSON.stringify(
        { project: "fckdsiozmufyhbnignet", stage, results },
        null,
        2,
      ),
    );
  const passed = async (label) => {
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
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: AbortSignal.any([
                AbortSignal.timeout(10000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            }),
        },
      },
    );
  const doctor = client(),
    pharmacist = client(),
    anonymous = client();
  let browser;
  const ledger = {
    patientIds: [],
    retainedPrescriptionIds: [],
    deletedDraftIds: [],
  };
  const record = () => writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
  const login = async (c, role) => {
    const response = await c.auth.signInWithPassword(credentials[role]);
    if (response.error) {
      const safeCode = /^[a-z_]+$/.test(response.error.code ?? "")
        ? response.error.code.toUpperCase()
        : "UNKNOWN";
      throw Error(`${role.toUpperCase()}_SIGN_IN_FAILED_${safeCode}`);
    }
  };
  const rpc = (c, name, args) =>
    c.rpc(name, args).abortSignal(AbortSignal.timeout(10000));
  const conflict = async (name, args) => {
    const start = performance.now();
    const r = await rpc(doctor, name, args);
    check(
      r.status === 409 &&
        r.error?.code === "PT409" &&
        performance.now() - start < 10000,
      "CONFLICT_FAILED_STOP_NO_RETRY",
    );
  };
  try {
    const hasLedger = await access(ledgerPath).then(
      () => true,
      () => false,
    );
    check(
      !hasLedger || resumeExistingDrafts,
      "PRIOR_HOSTED_LEDGER_INSPECT_DO_NOT_RECREATE",
    );
    if (hasLedger)
      Object.assign(ledger, JSON.parse(await readFile(ledgerPath, "utf8")));
    await login(doctor, "doctor");
    await login(pharmacist, "pharmacist");
    if (resumeExistingDrafts) {
      check(
        !(await doctor.auth.signOut({ scope: "global" })).error,
        "TEST_SESSION_REVOCATION_FAILED",
      );
      await login(doctor, "doctor");
      await passed("prior_test_sessions_revoked_before_resume");
    }
    const prior = JSON.parse(
      await readFile(".local/phase4a-acceptance-records.json", "utf8"),
    );
    const patientId = prior.patientIds[0];
    ledger.patientIds = [patientId];
    const patients = ok(
      await doctor.from("patients").select("id,name,patient_identifier"),
      "PATIENT_SELECTION_FAILED",
    );
    check(
      patients.length === 1 && patients[0].id === patientId,
      "RETAINED_PATIENT_MISMATCH",
    );
    const baseline = ok(
      await doctor
        .from("prescriptions")
        .select("id,status,updated_at,draft_request_id"),
      "BASELINE_FAILED",
    );
    check(
      hasLedger
        ? baseline.length === 2 &&
            ledger.retainedPrescriptionIds.length === 2 &&
            baseline.every(
              (r) =>
                r.status === "draft" &&
                ledger.retainedPrescriptionIds.includes(r.id),
            )
        : baseline.length === 0,
      "UNEXPECTED_EXISTING_PRESCRIPTIONS",
    );
    await record();
    await passed("real_doctor_and_pharmacist_auth_existing_patient");
    const med = (n) => ({
      medication_name: `SYNTHETIC 4B TEST ITEM ${n}`,
      strength: `test ${n}`,
      dose: `test ${n}`,
      frequency: `test ${n}`,
      duration: `test ${n}`,
      quantity: n + 2,
      special_instructions: "SYNTHETIC SOFTWARE TEST ONLY",
    });
    const items = [med(1), med(2)];
    const make = async () => {
      const payload = {
        p_request_id: randomUUID(),
        p_patient: { id: patientId },
        p_items: items,
        p_doctor_notes: "SYNTHETIC PHASE 4B ACCEPTANCE ONLY",
      };
      const d = ok(
        await rpc(doctor, "save_doctor_draft", payload),
        "DRAFT_CREATE_FAILED",
      );
      ledger.retainedPrescriptionIds.push(d.id);
      await record();
      return { ...d, payload };
    };
    stage = "create_two_drafts";
    await report();
    const reuse = (id) => {
      const d = baseline.find((r) => r.id === id);
      return {
        ...d,
        payload: {
          p_request_id: d.draft_request_id,
          p_patient: { id: patientId },
          p_items: items,
          p_doctor_notes: "SYNTHETIC PHASE 4B ACCEPTANCE ONLY",
        },
      };
    };
    const a = hasLedger
        ? reuse(ledger.retainedPrescriptionIds[0])
        : await make(),
      b = hasLedger ? reuse(ledger.retainedPrescriptionIds[1]) : await make();
    await passed("two_two_medication_drafts_existing_patient_only");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "ar-EG",
      timezoneId: "Africa/Cairo",
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    let routeFailed = false;
    const installRoute = (pattern, handler) =>
      page.route(pattern, async (route) => {
        try {
          await handler(route);
        } catch {
          routeFailed = true;
          await route.abort("failed").catch(() => {});
        }
      });
    const until = async (predicate) => {
      const end = Date.now() + 20000;
      while (!predicate()) {
        check(!routeFailed, "SANITIZED_ROUTE_HANDLER_FAILED");
        check(Date.now() < end, "BOUNDED_BROWSER_WAIT_FAILED");
        await delay(50);
      }
    };
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(25000);
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
    stage = "issue_a_lost_response";
    await report();
    await page.goto(`${origin}/doctor/prescriptions/${a.id}/issue`);
    check(
      (await page.locator(".document-medication").count()) === 2,
      "BROWSER_MEDICATION_COUNT_FAILED",
    );
    for (let i = 0; i < 2; i++)
      check(
        (
          await page.locator(".document-medication").nth(i).innerText()
        ).includes(items[i].medication_name),
        "BROWSER_MEDICATION_ORDER_FAILED",
      );
    let issueA,
      firstA,
      issueACalls = 0,
      lostA = false;
    const aEndpoint = `**/api/doctor/prescriptions/${a.id}/lifecycle`;
    await installRoute(aEndpoint, async (route) => {
      const body = route.request().postDataJSON();
      if (body.operation !== "issue") return route.continue();
      issueACalls++;
      if (!issueA) issueA = body;
      else
        check(
          JSON.stringify(issueA) === JSON.stringify(body),
          "ISSUE_RETRY_PAYLOAD_CHANGED",
        );
      if (!lostA) {
        lostA = true;
        const response = await route.fetch({ timeout: 15000 });
        check(response.status() === 200, "ISSUE_A_FAILED");
        firstA = (await response.json()).result;
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "تأكيد الإصدار النهائي", exact: true })
      .click();
    await until(() => Boolean(firstA?.reference));
    await page.locator(".form-section p[role=alert]").waitFor();
    check(Boolean(firstA?.reference), "LOST_RESPONSE_NOT_COMMITTED");
    await page
      .getByRole("button", { name: "تأكيد الإصدار النهائي", exact: true })
      .click();
    await page.waitForURL(`${origin}/doctor/prescriptions/${a.id}`);
    check(issueACalls === 2, "ISSUE_RETRY_CALL_COUNT_FAILED");
    await page.unroute(aEndpoint);
    await page.reload();
    await page
      .getByRole("button", { name: "إظهار الرمز المرجعي", exact: true })
      .click();
    await page.locator(".secure-reference").waitFor();
    check(
      (await page.locator(".secure-reference").innerText()) ===
        firstA.reference,
      "INITIAL_REFERENCE_MISMATCH",
    );
    await passed("browser_issuance_lost_response_same_request_retry_reload");
    stage = "relogin_reference_print";
    await report();
    await page
      .getByRole("button", { name: "تسجيل الخروج", exact: true })
      .click();
    await page.waitForURL(/\/login/);
    await uiLogin(page, "doctor");
    await login(doctor, "doctor");
    await page.goto(`${origin}/doctor/prescriptions/${a.id}`);
    check(
      (await page.locator(".secure-reference").count()) === 0,
      "REFERENCE_PERSISTED_IN_DOM",
    );
    await page.evaluate(() => {
      window.__printCount = 0;
      window.print = () => {
        window.__printCount++;
      };
    });
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "استرجاع النسخة وطباعتها", exact: true })
        .click();
      await page.waitForFunction((n) => window.__printCount === n, i + 1);
      check(
        (await page.locator(".secure-reference").innerText()) ===
          firstA.reference,
        "REPRINT_REFERENCE_CHANGED",
      );
      await page.emulateMedia({ media: "print" });
      check(
        await page.locator(".issued-document").isVisible(),
        "ISSUED_PRINT_HIDDEN",
      );
      check(
        (await page.locator(".document-warning").first().innerText()).includes(
          "غير معتمدة",
        ),
        "PRINT_WARNING_MISSING",
      );
      await page.emulateMedia({ media: "screen" });
      const persisted = await page.evaluate(
        (code) =>
          JSON.stringify({
            local: { ...localStorage },
            session: { ...sessionStorage },
          }).includes(code) || location.href.includes(code),
        firstA.reference,
      );
      check(!persisted, "REFERENCE_IN_BROWSER_PERSISTENCE");
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      await page.locator(".secure-reference").waitFor({ state: "detached" });
    }
    await passed(
      "browser_relogin_same_reference_reprint_print_css_and_ephemeral_code",
    );
    const aRpc = {
      p_id: a.id,
      p_expected_updated_at: issueA.version,
      p_review_fingerprint: issueA.fingerprint,
      p_request_id: issueA.requestId,
    };
    const replays = await Promise.all([
      rpc(doctor, "issue_doctor_prescription", aRpc),
      rpc(doctor, "issue_doctor_prescription", aRpc),
    ]);
    check(
      replays.every(
        (r) =>
          !r.error &&
          r.data.replayed &&
          r.data.reference === firstA.reference &&
          r.data.issued_at === firstA.issued_at &&
          r.data.expires_at === firstA.expires_at,
      ),
      "IDENTICAL_ISSUE_RETRY_CHANGED_RESULT",
    );
    check(
      Date.parse(firstA.expires_at) - Date.parse(firstA.issued_at) ===
        7 * 86400000,
      "VALIDITY_NOT_SEVEN_DAYS",
    );
    await conflict("issue_doctor_prescription", {
      ...aRpc,
      p_review_fingerprint: "0".repeat(64),
    });
    await conflict("issue_doctor_prescription", {
      ...aRpc,
      p_request_id: randomUUID(),
    });
    await passed(
      "authenticated_api_concurrent_identical_retries_and_changed_payload_conflicts",
    );
    stage = "stale_review_b";
    await report();
    await page.goto(`${origin}/doctor/prescriptions/${b.id}/issue`);
    const edited = ok(
      await rpc(doctor, "save_doctor_draft", {
        ...b.payload,
        p_prescription_id: b.id,
        p_expected_updated_at: b.updated_at,
        p_doctor_notes: "SYNTHETIC UPDATED REVIEW ONLY",
      }),
      "B_EDIT_FAILED",
    );
    const staleInputs = [];
    const bEndpoint = `**/api/doctor/prescriptions/${b.id}/lifecycle`;
    await installRoute(bEndpoint, async (route) => {
      staleInputs.push(route.request().postDataJSON());
      const r = await route.fetch({ timeout: 15000 });
      check(r.status() === 409, "STALE_BROWSER_ISSUE_NOT_CONFLICT");
      await route.fulfill({ response: r });
    });
    await page.getByRole("checkbox").check();
    for (let i = 0; i < 2; i++) {
      const response = page.waitForResponse((r) =>
        r.url().endsWith(`/api/doctor/prescriptions/${b.id}/lifecycle`),
      );
      await page
        .getByRole("button", { name: "تأكيد الإصدار النهائي", exact: true })
        .click();
      check((await response).status() === 409, "STALE_BROWSER_ISSUE_FAILED");
      await page.locator(".form-section p[role=alert]").waitFor();
    }
    check(
      staleInputs.length === 2 &&
        JSON.stringify(staleInputs[0]) === JSON.stringify(staleInputs[1]) &&
        staleInputs[0].version === b.updated_at,
      "STALE_RETRY_VERSION_CHANGED",
    );
    await page.unroute(bEndpoint);
    await page.reload();
    let issueB,
      firstB,
      bCalls = 0;
    await installRoute(bEndpoint, async (route) => {
      bCalls++;
      issueB = route.request().postDataJSON();
      const r = await route.fetch({ timeout: 15000 });
      check(r.status() === 200, "ISSUE_B_FAILED");
      firstB = (await r.json()).result;
      await route.fulfill({ response: r });
    });
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "تأكيد الإصدار النهائي", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await page.waitForURL(`${origin}/doctor/prescriptions/${b.id}`);
    check(
      bCalls === 1 &&
        issueB.version === edited.updated_at &&
        firstB.reference !== firstA.reference,
      "DUPLICATE_CLICK_OR_VERSION_FAILED",
    );
    await page.unroute(bEndpoint);
    await passed(
      "browser_repeated_stale_review_keeps_precondition_fresh_review_issues_once",
    );
    const issuedB = ok(
      await doctor
        .from("prescriptions")
        .select("updated_at")
        .eq("id", b.id)
        .single(),
      "ISSUED_B_VERSION_FAILED",
    );
    await conflict("cancel_doctor_prescription", {
      p_id: b.id,
      p_expected_updated_at: b.updated_at,
      p_request_id: randomUUID(),
      p_reason: "entered_in_error",
    });
    stage = "cancel_b_lost_response";
    await report();
    let cancelBody,
      cancelled,
      cancelCalls = 0;
    await installRoute(bEndpoint, async (route) => {
      const body = route.request().postDataJSON();
      if (body.operation !== "cancel") return route.continue();
      cancelCalls++;
      if (!cancelBody) cancelBody = body;
      else
        check(
          JSON.stringify(cancelBody) === JSON.stringify(body),
          "CANCEL_RETRY_CHANGED",
        );
      const r = await route.fetch({ timeout: 15000 });
      check(r.status() === 200, "CANCEL_B_FAILED");
      cancelled = (await r.json()).result;
      if (cancelCalls === 1) await route.abort("failed");
      else await route.fulfill({ response: r });
    });
    await page
      .getByLabel("سبب الإلغاء", { exact: true })
      .selectOption("entered_in_error");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "تأكيد إلغاء الوصفة", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "إعادة محاولة طلب الإلغاء نفسه",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", {
        name: "إعادة محاولة طلب الإلغاء نفسه",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: "إعادة محاولة طلب الإلغاء نفسه",
        exact: true,
      })
      .waitFor({ state: "detached" });
    await until(() => cancelCalls === 2 && cancelled?.replayed === true);
    check(
      cancelCalls === 2 &&
        cancelled.replayed === true &&
        cancelBody.version === issuedB.updated_at,
      "CANCEL_RETRY_NOT_SAFE",
    );
    await page.unroute(bEndpoint);
    await page.reload();
    check(
      (await page.locator(".document-label").innerText()).includes("ملغاة"),
      "CANCELLED_LABEL_MISSING",
    );
    const cancelRpc = {
      p_id: b.id,
      p_expected_updated_at: cancelBody.version,
      p_request_id: cancelBody.requestId,
      p_reason: cancelBody.reason,
    };
    const replayCancel = ok(
      await rpc(doctor, "cancel_doctor_prescription", cancelRpc),
      "CANCEL_REPLAY_FAILED",
    );
    check(
      replayCancel.replayed &&
        replayCancel.cancelled_at === cancelled.cancelled_at,
      "CANCEL_TIME_CHANGED",
    );
    await conflict("cancel_doctor_prescription", {
      ...cancelRpc,
      p_reason: "duplicate_prescription",
    });
    await passed(
      "browser_cancel_lost_response_retry_reason_timestamp_and_stale_conflicts",
    );
    stage = "authorization_immutability_isolation";
    await report();
    const calls = [
      ["get_doctor_issue_review", { p_id: a.id }],
      ["get_doctor_lifecycle", { p_id: a.id }],
      ["reveal_doctor_reference", { p_id: a.id }],
      ["issue_doctor_prescription", aRpc],
      ["cancel_doctor_prescription", { ...cancelRpc, p_id: a.id }],
    ];
    for (const c of [anonymous, pharmacist])
      for (const [name, args] of calls)
        check(
          (await rpc(c, name, args)).error?.code === "42501",
          "UNAUTHORIZED_RPC_ALLOWED",
        );
    for (const table of [
      "patients",
      "prescriptions",
      "prescription_items",
      "dispensations",
    ])
      check(
        ok(
          await pharmacist.from(table).select("id"),
          "PHARMACIST_SELECT_FAILED",
        ).length === 0,
        "PHARMACIST_REAL_RECORD_LEAK",
      );
    for (const c of [doctor, pharmacist])
      check(
        (await c.from("prescriptions").select("reference_digest")).error
          ?.code === "42501",
        "DIGEST_EXPOSED",
      );
    for (const d of [a, b]) {
      check(
        Boolean(
          (
            await rpc(doctor, "save_doctor_draft", {
              ...d.payload,
              p_prescription_id: d.id,
              p_expected_updated_at: d.updated_at,
            })
          ).error,
        ),
        "ISSUED_EDIT_ALLOWED",
      );
      check(
        Boolean(
          (
            await rpc(doctor, "delete_doctor_draft", {
              p_id: d.id,
              p_expected_updated_at: d.updated_at,
            })
          ).error,
        ),
        "ISSUED_DELETE_ALLOWED",
      );
    }
    const beforePatient = ok(
      await doctor
        .from("patients")
        .select("id,name,patient_identifier")
        .eq("id", patientId)
        .single(),
      "PATIENT_READ_FAILED",
    );
    check(
      Boolean(
        (
          await doctor
            .from("patients")
            .update({ name: "SYNTHETIC FORBIDDEN CORRECTION" })
            .eq("id", patientId)
        ).error,
      ),
      "ISSUED_PATIENT_MUTATION_ALLOWED",
    );
    const afterPatient = ok(
      await doctor
        .from("patients")
        .select("id,name,patient_identifier")
        .eq("id", patientId)
        .single(),
      "PATIENT_RECHECK_FAILED",
    );
    check(
      JSON.stringify(beforePatient) === JSON.stringify(afterPatient),
      "PATIENT_IDENTITY_CHANGED",
    );
    const pharmacyContext = await browser.newContext({ locale: "ar-EG" });
    const pharmacyPage = await pharmacyContext.newPage();
    await uiLogin(pharmacyPage, "pharmacist");
    for (const operation of ["issue", "reveal", "cancel"])
      check(
        (await post(pharmacyPage, a.id, { operation })).status() === 403,
        "PHARMACIST_APP_API_ALLOWED",
      );
    await pharmacyPage
      .getByLabel("رمز الوصفة التجريبي", { exact: true })
      .fill(firstA.reference);
    await pharmacyPage
      .getByRole("button", { name: "بحث عن الوصفة", exact: true })
      .click();
    check(
      (
        await pharmacyPage.locator("#reference-code-error").innerText()
      ).includes("لم نعثر"),
      "SIMULATION_DISCOVERED_REAL_REFERENCE",
    );
    check(
      (await pharmacyPage.locator(".pharmacy-result").count()) === 0,
      "SIMULATION_REAL_RESULT",
    );
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    check(
      (await post(anonPage, a.id, { operation: "reveal" })).status() === 403,
      "ANONYMOUS_APP_API_ALLOWED",
    );
    const response = await post(page, a.id, { operation: "reveal" });
    check(
      response.status() === 200 &&
        response.headers()["cache-control"].includes("no-store") &&
        (await response.json()).result.reference === firstA.reference,
      "REFERENCE_API_CACHE_OR_EQUALITY_FAILED",
    );
    await passed(
      "anonymous_pharmacist_rpc_api_rls_denial_real_reference_simulation_isolation_and_immutability",
    );
    stage = "rtl_and_revoked_session";
    await report();
    await page.goto(`${origin}/doctor/prescriptions/${a.id}`);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      check(
        await page.evaluate(
          () =>
            document.documentElement.dir === "rtl" &&
            document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "RTL_OR_OVERFLOW_FAILED",
      );
    }
    await passed("browser_arabic_rtl_desktop_and_320px");
    await page.getByRole("button", { name: "القائمة", exact: true }).click();
    const token = (await doctor.auth.getSession()).data.session.access_token;
    const oldCookies = await context.cookies();
    await page
      .getByRole("button", { name: "تسجيل الخروج", exact: true })
      .click();
    await page.waitForURL(/\/login/);
    await context.clearCookies();
    await context.addCookies(oldCookies);
    check(
      (await post(page, a.id, { operation: "reveal" })).status() === 403,
      "REVOKED_COOKIE_REPLAY_ALLOWED",
    );
    const revoked = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/reveal_doctor_reference`,
      {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_id: a.id }),
        signal: AbortSignal.timeout(10000),
      },
    );
    check(
      revoked.status === 403 && (await revoked.json()).code === "42501",
      "REVOKED_JWT_RPC_ALLOWED",
    );
    await passed(
      "globally_revoked_real_session_cookie_and_direct_jwt_rpc_denied",
    );
    await login(doctor, "doctor");
    const finalHeaders = ok(
      await doctor
        .from("prescriptions")
        .select("id,status,issued_at,expires_at,patient_id"),
      "FINAL_HEADERS_FAILED",
    );
    const finalItems = ok(
      await doctor
        .from("prescription_items")
        .select(
          "prescription_id,medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order",
        )
        .order("sort_order"),
      "FINAL_ITEMS_FAILED",
    );
    check(
      finalHeaders.length === 2 &&
        finalHeaders.filter((h) => h.status === "issued").length === 1 &&
        finalHeaders.filter((h) => h.status === "cancelled").length === 1 &&
        finalHeaders.every((h) => h.patient_id === patientId),
      "FINAL_HEADER_COUNTS_FAILED",
    );
    for (const d of [a, b])
      check(
        JSON.stringify(
          finalItems
            .filter((i) => i.prescription_id === d.id)
            .map((row) =>
              Object.fromEntries(
                Object.entries(row).filter(
                  ([key]) => key !== "prescription_id",
                ),
              ),
            ),
        ) ===
          JSON.stringify(items.map((i, sort_order) => ({ ...i, sort_order }))),
        "FINAL_MEDICATION_VALUES_ORDER_CHANGED",
      );
    check(
      finalHeaders.find((h) => h.id === a.id).issued_at === firstA.issued_at &&
        finalHeaders.find((h) => h.id === b.id).issued_at === firstB.issued_at,
      "HISTORICAL_TIMES_CHANGED",
    );
    const fresh = ok(
      await rpc(doctor, "reveal_doctor_reference", { p_id: a.id }),
      "FINAL_REFERENCE_FAILED",
    );
    check(fresh.reference === firstA.reference, "FINAL_REFERENCE_CHANGED");
    await passed(
      "final_two_histories_four_items_one_cancelled_no_drafts_no_duplicate_issuance",
    );
    stage = "passed";
    await report();
  } catch (e) {
    const failed = /^[A-Z0-9_]+$/.test(e.message)
      ? e.message
      : "BROWSER_OR_NETWORK_CHECK_FAILED";
    results.push({ check: failed, passed: false });
    await report();
    throw Error(failed);
  } finally {
    if (browser) {
      for (const c of browser.contexts())
        await c.unrouteAll({ behavior: "wait" }).catch(() => {});
      await browser.close();
    }
    await doctor.auth.signOut({ scope: "local" }).catch(() => {});
    await pharmacist.auth.signOut({ scope: "local" }).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
