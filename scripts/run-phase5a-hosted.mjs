// Explicitly approved two-record native acceptance. No account/admin/secret writes.
// Credentials enter only private stdin; codes/cookies/tokens remain in memory.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { readFile, writeFile, open, mkdir } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
nextEnv.loadEnvConfig(process.cwd());
const project = "fckdsiozmufyhbnignet",
  file = ".local/phase5a-hosted-ledger.json",
  resultFile = ".local/phase5a-hosted-result.json";
let stage = "private_input",
  browser,
  server,
  lock,
  password,
  routeFailed = false;
const checks = [];
const ensure = (condition, label) => {
  if (!condition) throw Error(`CHECK_${label}`);
};
const data = (r, label) => {
  ensure(!r.error && r.data !== null, label);
  return r.data;
};
for (const event of ["uncaughtException", "unhandledRejection"])
  process.on(event, () => {
    process.stderr.write("PHASE5A_UNCAUGHT_SANITIZED\n");
    process.exit(1);
  });
let ledger = { project, fixtures: {}, checks: [] };
const save = () => writeFile(file, JSON.stringify(ledger, null, 2));
const pass = async (label) => {
  if (!checks.includes(label)) checks.push(label);
  ledger.checks = [...new Set([...ledger.checks, label])];
  await save();
  console.log(`PASS ${label}`);
};
const report = async (status, reason) =>
  writeFile(
    resultFile,
    JSON.stringify(
      {
        project,
        status,
        stage,
        reason,
        checks: ledger.checks,
        fixtures: Object.fromEntries(
          Object.entries(ledger.fixtures).map(([k, v]) => [
            k,
            {
              id: v.id ?? null,
              issued: !!v.issued,
              dispensed: !!v.dispensed,
              cancelled: !!v.cancelled,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
async function privateInput() {
  return new Promise((resolve, reject) => {
    const input = process.stdin,
      raw = !!input.isTTY;
    let bytes = [];
    if (raw) input.setRawMode(true);
    const finish = () => {
      input.off("data", read);
      input.pause();
      if (raw) input.setRawMode(false);
      const value = Buffer.from(bytes).toString("utf8");
      bytes.fill(0);
      resolve(value);
    };
    const read = (chunk) => {
      for (const b of chunk) {
        if (b === 10 || b === 13) {
          finish();
          return;
        }
        if (b === 3 || bytes.length > 1024) {
          reject(Error("CHECK_PRIVATE_INPUT"));
          return;
        }
        bytes.push(b);
      }
    };
    input.on("data", read);
    input.resume();
    console.log("PRIVATE_STDIN_READY_NO_ECHO");
  });
}
const fetchBounded = (u, i) =>
  fetch(u, {
    ...i,
    signal: AbortSignal.any([
      AbortSignal.timeout(10000),
      ...(i?.signal ? [i.signal] : []),
    ]),
  });
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
      global: { fetch: fetchBounded },
    },
  );
const rpc = (c, name, args) =>
  c.rpc(name, args).abortSignal(AbortSignal.timeout(10000));
const login = async (c, email) => {
  const r = await c.auth.signInWithPassword({ email, password });
  if (r.error) {
    const code = /^[a-z_]+$/.test(r.error.code ?? "")
      ? r.error.code
      : "provider_error";
    throw Error(`CHECK_LOGIN_${code.toUpperCase()}`);
  }
  return r.data;
};
async function sql(statement) {
  try {
    return JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [
            "node_modules/supabase/dist/supabase.js",
            "db",
            "query",
            "--linked",
            "--project-ref",
            project,
            statement,
            "--agent",
            "no",
            "--output-format",
            "json",
          ],
          { timeout: 20000, maxBuffer: 2000000 },
        )
      ).stdout,
    );
  } catch {
    throw Error("CHECK_SAFE_METADATA_QUERY");
  }
}
async function counters() {
  return await sql(
    "begin read only;set local statement_timeout='5s';select scope,sum(attempts)::int attempts from rx_private.pharmacy_rate_limits group by scope order by scope;commit;",
  );
}
const noStore = (r) =>
  ensure(r.headers()["cache-control"]?.includes("no-store"), "NO_STORE");
const terminal = (value, state) =>
  ensure(
    value?.state === state &&
      !Object.hasOwn(value, "patient") &&
      !Object.hasOwn(value, "items") &&
      !Object.hasOwn(value, "reference"),
    "TERMINAL_MINIMAL",
  );
const conflict = (r) =>
  ensure(r.status === 409 && r.error?.code === "PT409", "HTTP_PT409");
const dispenseArgs = (l, id = randomUUID()) => ({
  p_lookup_id: l.lookup_id,
  p_prescription_id: l.prescription_id,
  p_request_id: id,
  p_identity_confirmed: true,
  p_full_confirmed: true,
});
let doctor, pharmacist, anonymous;
try {
  ensure(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname ===
      `${project}.supabase.co`,
    "TARGET",
  );
  await mkdir(".local", { recursive: true });
  lock = await open(".local/phase5a-hosted.lock", "wx").catch(() => {
    throw Error("CHECK_LOCKED_INSPECT");
  });
  try {
    ledger = JSON.parse(await readFile(file, "utf8"));
    ensure(ledger.project === project, "LEDGER_TARGET");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  password = await privateInput();
  ensure(password.length > 0, "PRIVATE_INPUT_EMPTY");
  doctor = client();
  pharmacist = client();
  anonymous = client();
  stage = "native_auth_and_bounded_probe";
  await login(doctor, "tclinic65@gmail.com");
  await login(pharmacist, "ahmedhany2522006@gmail.com");
  if (
    !ledger.checks.includes(
      "native_auth_first_rpc_HTTP404_committed_rate_counter",
    )
  ) {
    ledger.invalidLookups = (ledger.invalidLookups ?? 0) + 1;
    await save();
    const first = await rpc(pharmacist, "lookup_pharmacy_prescription", {
      p_reference: "invalid",
    });
    ensure(
      first.status === 404 && first.error?.code === "PT404",
      "NATIVE_RPC_FIRST_BOUNDED_PROBE",
    );
    const firstCounters = await counters();
    ensure(
      firstCounters.some(
        (r) => r.scope === "lookup_actor_minute" && r.attempts >= 1,
      ),
      "FAILED_ATTEMPT_COMMITTED",
    );
    await pass("native_auth_first_rpc_HTTP404_committed_rate_counter");
  } else {
    ledger.invalidLookups ??= 1;
    await save();
  }
  const patient = data(
    await doctor.from("patients").select("id,name,patient_identifier"),
    "PATIENT",
  );
  ensure(patient.length === 1, "PATIENT_COUNT");
  const originalIds = [
    "423504eb-b50d-4d09-b19a-2009c4d92911",
    "4bbcd887-f4d1-4ae3-a7c7-cbdefdaec3a1",
  ];
  const snapshot = async () =>
    data(
      await doctor
        .from("prescriptions")
        .select(
          "id,patient_id,doctor_user_id,status,doctor_notes,issued_at,expires_at,created_at,updated_at,items:prescription_items(id,medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order)",
        )
        .in("id", originalIds)
        .order("id"),
      "OLD_SNAPSHOT",
    );
  const old = await snapshot();
  ensure(
    old.length === 2 &&
      old.some((r) => r.status === "issued") &&
      old.some((r) => r.status === "cancelled"),
    "PHASE4B_BASELINE",
  );
  // Local production server is owned by this run; stdout/stderr suppressed.
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await fetch(`${origin}/login`, {
      signal: AbortSignal.timeout(700),
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (ready) break;
    await delay(200);
  }
  ensure(ready, "SERVER_READY");
  browser = await chromium.launch({ headless: true });
  const dc = await browser.newContext({
      locale: "ar-EG",
      timezoneId: "Africa/Cairo",
      viewport: { width: 1440, height: 1100 },
    }),
    pc = await browser.newContext({
      locale: "ar-EG",
      timezoneId: "Africa/Cairo",
      viewport: { width: 390, height: 950 },
    });
  const dp = await dc.newPage(),
    pp = await pc.newPage();
  for (const page of [dp, pp]) {
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    page.on("pageerror", () => {
      routeFailed = true;
    });
    page.on("dialog", (d) => d.accept().catch(() => {}));
  }
  async function uiLogin(page, role) {
    await page.goto(`${origin}/login`);
    await page
      .getByLabel("البريد الإلكتروني", { exact: true })
      .fill(
        role === "doctor"
          ? "tclinic65@gmail.com"
          : "ahmedhany2522006@gmail.com",
      );
    await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "تسجيل الدخول", exact: true })
      .click();
    await page.waitForURL(
      `${origin}/${role === "doctor" ? "doctor" : "pharmacy"}`,
    );
  }
  const post = async (page, body, path = "/api/pharmacy/prescriptions") => {
    const r = await page.evaluate(
      async ({ path, body }) => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12000),
        });
        return {
          status: response.status,
          body: await response.json(),
          cache: response.headers.get("cache-control"),
        };
      },
      { path, body },
    );
    ensure(r.cache?.includes("no-store"), "NO_STORE");
    return r;
  };
  async function lookupUI(reference) {
    await pp.getByLabel("الرمز المرجعي", { exact: true }).fill(reference);
    const response = pp.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/pharmacy/prescriptions" &&
        r.request().method() === "POST",
    );
    await pp
      .getByRole("button", { name: "بحث عن الوصفة", exact: true })
      .click();
    const r = await response;
    noStore(r);
    ensure(r.status() === 200, "UI_LOOKUP_SUCCESS");
    const v = (await r.json()).result;
    ensure(
      (await pp.getByLabel("الرمز المرجعي", { exact: true }).inputValue()) ===
        "",
      "INPUT_CLEARED",
    );
    return v;
  }
  async function reference(id) {
    return data(
      await rpc(doctor, "reveal_doctor_reference", { p_id: id }),
      "REFERENCE",
    ).reference;
  }
  const itemsFor = (label) =>
    [1, 2].map((n) => ({
      medication_name: `SYNTHETIC 5A ${label} ITEM ${n}`,
      strength: `test ${n}`,
      dose: `test ${n}`,
      frequency: `test ${n}`,
      duration: `test ${n}`,
      quantity: n + 2,
      special_instructions: "SYNTHETIC SOFTWARE TEST ONLY",
    }));
  async function createIssue(label) {
    const f = (ledger.fixtures[label] ??= { issueRequestId: randomUUID() });
    await save();
    const all = data(
      await doctor
        .from("prescriptions")
        .select("id,status,doctor_notes,updated_at"),
      "DISCOVER_FIXTURE",
    );
    if (!f.id) {
      const found = all.filter(
        (r) => r.doctor_notes === `SYNTHETIC PHASE 5A ${label} ACCEPTANCE ONLY`,
      );
      ensure(found.length <= 1, "DUPLICATE_FIXTURE");
      if (found.length) {
        f.id = found[0].id;
        await save();
      }
    }
    if (!f.id) {
      stage = `browser_create_${label}`;
      ensure(all.length < 4, "FIXTURE_BOUND");
      await dp.goto(`${origin}/doctor/prescriptions/new`);
      await dp
        .getByLabel("اختيار المريض", { exact: true })
        .selectOption("existing");
      await dp.getByLabel("البحث عن مريض بالاسم").fill(patient[0].name);
      await dp
        .getByRole("button", { name: "بحث عن مريض", exact: true })
        .click();
      await dp.locator(".patient-options button").click();
      await dp.getByRole("button", { name: "إضافة دواء آخر" }).click();
      for (const [i, item] of itemsFor(label).entries())
        for (const [key, value] of Object.entries(item))
          await dp.locator(`[id="${i}-${key}"]`).fill(String(value));
      await dp
        .getByLabel("ملاحظات الطبيب (اختياري)")
        .fill(`SYNTHETIC PHASE 5A ${label} ACCEPTANCE ONLY`);
      await dp
        .getByRole("button", { name: "مراجعة المسودة", exact: true })
        .click();
      await dp
        .getByRole("button", { name: "حفظ المسودة", exact: true })
        .click();
      await dp.waitForURL(/\/doctor\/prescriptions\/[a-f0-9-]+\?saved=1$/);
      f.id = new URL(dp.url()).pathname.split("/").at(-1);
      await save();
    }
    const record = data(
      await doctor
        .from("prescriptions")
        .select(
          "status,updated_at,items:prescription_items(medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order)",
        )
        .eq("id", f.id)
        .single(),
      "DRAFT_VALUES",
    );
    ensure(
      record.items.length === 2 &&
        record.items
          .sort((a, b) => a.sort_order - b.sort_order)
          .every((v, i) =>
            Object.entries(itemsFor(label)[i]).every(([k, x]) => v[k] === x),
          ),
      "SAVED_VALUES_ORDER",
    );
    if (record.status === "draft") {
      stage = `browser_issue_${label}`;
      await dp.goto(`${origin}/doctor/prescriptions/${f.id}/issue`);
      await dp.getByRole("checkbox").check();
      const res = dp.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith("/lifecycle") &&
          r.request().method() === "POST",
      );
      await dp
        .getByRole("button", { name: "تأكيد الإصدار النهائي", exact: true })
        .click();
      const r = await res;
      noStore(r);
      ensure(r.status() === 200, "BROWSER_ISSUE");
      await dp.waitForURL(`${origin}/doctor/prescriptions/${f.id}`);
    }
    f.issued = true;
    await save();
    await pass(
      `browser_existing_patient_two_medications_create_issue_${label}`,
    );
    return f;
  }
  await uiLogin(dp, "doctor");
  await uiLogin(pp, "pharmacist");
  const A = await createIssue("A"),
    B = await createIssue("B");
  const codeA = await reference(A.id),
    codeB = await reference(B.id);
  ensure(codeA !== codeB, "UNIQUE_REFERENCES");
  // No clinical access through ordinary SELECT, even after capability lookup.
  for (const table of [
    "patients",
    "prescriptions",
    "prescription_items",
    "dispensations",
  ]) {
    const r = await pharmacist.from(table).select("id");
    ensure(!r.error && r.data.length === 0, "NO_BROWSING");
  }
  ensure(
    (await pharmacist.from("prescriptions").select("reference_digest")).error,
    "DIGEST_DENIED",
  );
  ensure(
    (
      await rpc(anonymous, "lookup_pharmacy_prescription", {
        p_reference: "invalid",
      })
    ).error,
    "ANON_RPC_DENIED",
  );
  ensure(
    (
      await rpc(doctor, "lookup_pharmacy_prescription", {
        p_reference: "invalid",
      })
    ).error?.code === "42501",
    "DOCTOR_RPC_DENIED",
  );
  const doctorRoute = await post(dp, {
    operation: "lookup",
    reference: "invalid",
  });
  ensure(doctorRoute.status === 403, "DOCTOR_ROUTE_DENIED");
  await pass(
    "anonymous_doctor_denied_no_general_clinical_browsing_digest_denied",
  );
  stage = "unfinished_session_binding";
  // Obtain B confirmation with a real ordinary Auth session, sign out only it.
  const unfinished = data(
    await rpc(pharmacist, "lookup_pharmacy_prescription", {
      p_reference: codeB,
    }),
    "UNFINISHED_LOOKUP",
  );
  ensure(unfinished.state === "eligible", "UNFINISHED_ELIGIBLE");
  const revokedToken = (await pharmacist.auth.getSession()).data.session
    .access_token;
  ensure(
    !(await pharmacist.auth.signOut({ scope: "local" })).error,
    "LOCAL_SIGNOUT",
  );
  await login(pharmacist, "ahmedhany2522006@gmail.com");
  conflict(
    await rpc(
      pharmacist,
      "dispense_pharmacy_prescription",
      dispenseArgs(unfinished),
    ),
  );
  const revokedResponse = await fetchBounded(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/lookup_pharmacy_prescription`,
    {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${revokedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_reference: "invalid" }),
    },
  );
  ensure(
    revokedResponse.status === 403 &&
      (await revokedResponse.json()).code === "42501",
    "REVOKED_RPC_DENIED",
  );
  await pass(
    "unfinished_confirmation_rejected_after_new_session_revoked_RPC_denied",
  );
  stage = "browser_lookup_A";
  await pp.goto(`${origin}/pharmacy`);
  if (!A.dispensed) {
    let la = await lookupUI(codeA.toLowerCase().replaceAll("-", " "));
    ensure(
      la.state === "eligible" && la.prescription_id === A.id,
      "A_ELIGIBLE",
    );
    ensure(
      la.items.length === 2 &&
        la.items.every((item, i) =>
          Object.entries(itemsFor("A")[i]).every(([k, v]) => item[k] === v),
        ),
      "LOOKUP_ORDER_VALUES",
    );
    ensure(
      !JSON.stringify(la).includes(codeA) &&
        !Object.hasOwn(la, "reference_digest") &&
        !Object.hasOwn(la, "doctor_notes"),
      "MINIMAL_LOOKUP",
    );
    ensure(
      (await pp.locator(".document-medication input").count()) === 0,
      "READ_ONLY_MEDICATIONS",
    );
    await pp.setViewportSize({ width: 320, height: 1000 });
    ensure(
      await pp.evaluate(
        () =>
          document.documentElement.dir === "rtl" &&
          document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "MOBILE_RTL",
    );
    ensure(
      await pp
        .getByRole("button", { name: "متابعة تأكيد الصرف الكامل", exact: true })
        .isDisabled(),
      "IDENTITY_REQUIRED",
    );
    const mismatched = dispenseArgs({ ...la, prescription_id: B.id });
    conflict(
      await rpc(pharmacist, "dispense_pharmacy_prescription", mismatched),
    );
    const invalidConfirm = await rpc(
      pharmacist,
      "dispense_pharmacy_prescription",
      { ...dispenseArgs(la), p_full_confirmed: false },
    );
    ensure(
      invalidConfirm.status === 400 && invalidConfirm.error?.code === "22023",
      "FULL_CONFIRM_REQUIRED",
    );
    await pass(
      "real_browser_normalized_lookup_order_minimal_readonly_320RTL_confirmations",
    );
  }
  if (!A.dispensed) {
    stage = "browser_lost_response_duplicate_A";
    let intercepted = 0,
      sealed,
      completion;
    await pp.route("**/api/pharmacy/prescriptions", async (route) => {
      try {
        const input = route.request().postDataJSON();
        if (input.operation === "dispense") {
          intercepted++;
          if (!sealed) {
            sealed = input;
          }
          ensure(
            JSON.stringify(input) === JSON.stringify(sealed),
            "SEALED_RETRY",
          );
        }
        await route.continue();
      } catch {
        routeFailed = true;
        await route.abort("failed").catch(() => {});
      }
    });
    // Preserve the actual browser's HttpOnly Secure cookie transport. A Node
    // route.fetch/APIRequestContext replay on local HTTP is not that transport.
    // Drop the committed response at the component's fetch boundary instead.
    await pp.evaluate(() => {
      const original = window.fetch.bind(window);
      let lost = false;
      window.fetch = async (input, init) => {
        const r = await original(input, init);
        if (
          String(input) === "/api/pharmacy/prescriptions" &&
          init?.body &&
          JSON.parse(String(init.body)).operation === "dispense" &&
          !lost &&
          r.ok
        ) {
          const body = await r.clone().json();
          if (body.result?.state === "dispensed") {
            lost = true;
            throw new TypeError("Simulated response loss after commit");
          }
        }
        return r;
      };
    });
    const committedResponse = pp.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/pharmacy/prescriptions" &&
        r.request().postDataJSON()?.operation === "dispense",
    );
    await pp
      .getByLabel("راجعت هوية المريض ومطابقتها للوصفة المعروضة.", {
        exact: true,
      })
      .check();
    await pp
      .getByRole("button", { name: "متابعة تأكيد الصرف الكامل", exact: true })
      .click();
    ensure(
      await pp
        .getByRole("button", { name: "تأكيد الصرف الكامل", exact: true })
        .isDisabled(),
      "FULL_CONFIRM_CHECKBOX_REQUIRED",
    );
    await pp
      .getByLabel("أؤكد صرف جميع الأدوية والكميات المعروضة دون تعديل.", {
        exact: true,
      })
      .check();
    await pp
      .getByRole("button", { name: "تأكيد الصرف الكامل", exact: true })
      .evaluate((b) => {
        b.click();
        b.click();
      });
    await pp.getByRole("alert").waitFor();
    const committed = await committedResponse;
    ensure(
      committed.status() === 200,
      `BROWSER_DISPENSE_HTTP_${committed.status()}`,
    );
    noStore(committed);
    completion = (await committed.json()).result;
    ensure(completion.state === "dispensed", "COMPLETION");
    A.dispensed = true;
    await save();
    ensure(
      intercepted === 1 && !routeFailed,
      "ONE_CLICK_COMMITTED_LOST_RESPONSE",
    );
    await pp
      .getByRole("button", { name: "إعادة محاولة طلب الصرف نفسه", exact: true })
      .click();
    await pp
      .getByRole("heading", { name: "الوصفة مصروفة بالكامل", exact: true })
      .waitFor();
    ensure(intercepted === 2, "ONE_RETRY");
    await pp.unroute("**/api/pharmacy/prescriptions");
    const retry = await post(pp, sealed);
    ensure(
      retry.status === 200 &&
        retry.body.result.replayed &&
        retry.body.result.id === completion.id &&
        retry.body.result.dispensed_at === completion.dispensed_at,
      "SAME_ORIGINAL_COMPLETION",
    );
    const changed = await post(pp, { ...sealed, requestId: randomUUID() });
    ensure(changed.status === 409, "CHANGED_REQUEST_HTTP409");
    conflict(
      await rpc(pharmacist, "dispense_pharmacy_prescription", {
        p_lookup_id: sealed.lookupId,
        p_prescription_id: sealed.prescriptionId,
        p_request_id: randomUUID(),
        p_identity_confirmed: true,
        p_full_confirmed: true,
      }),
    );
    await pass(
      "real_browser_duplicate_click_lost_response_identical_retry_one_completion_changed_HTTP409",
    );
  }
  stage = "browser_reload_login_doctor_completion";
  await pp.reload();
  terminal(await lookupUI(codeA), "dispensed");
  // Browser's normal sign-out revokes its session. Save only in-memory stale cookies.
  const staleCookies = await pc.cookies();
  await pp.getByRole("button", { name: "القائمة", exact: true }).click();
  await pp.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await pp.waitForURL(/\/login\?signedOut=1/);
  const stale = await browser.newContext();
  await stale.addCookies(staleCookies);
  const stalePage = await stale.newPage();
  await stalePage.goto(`${origin}/login`);
  const stalePost = await post(stalePage, {
    operation: "lookup",
    reference: "invalid",
  });
  ensure(stalePost.status === 403, "REVOKED_BROWSER_COOKIES");
  await stale.close();
  await uiLogin(pp, "pharmacist");
  await login(pharmacist, "ahmedhany2522006@gmail.com");
  terminal(await lookupUI(codeA), "dispensed");
  await dp.goto(`${origin}/doctor/prescriptions/${A.id}`);
  await dp.getByText("صرف كامل مسجل — نسخة تاريخية", { exact: true }).waitFor();
  const projection = await doctor
    .from("prescriptions")
    .select("dispensations(id,dispensed_at,pharmacy:pharmacies(name))")
    .eq("id", A.id)
    .single();
  ensure(
    !projection.error &&
      projection.data?.dispensations &&
      !Array.isArray(projection.data.dispensations),
    "NATIVE_DOCTOR_COMPLETION_PROJECTION",
  );
  const stamp = new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "Africa/Cairo",
  }).format(new Date(projection.data.dispensations.dispensed_at));
  ensure(
    (await dp.locator(".document-warning").first().innerText()).includes(stamp),
    "DOCTOR_ACTUAL_COMPLETION_TIME",
  );
  ensure(
    (await dp.locator("body").innerText()).includes("صرف كامل مسجل"),
    "DOCTOR_COMPLETION_DETAIL",
  );
  ensure(
    (await dp.locator("#cancellation-reason").count()) === 0,
    "COMPLETED_NO_CANCEL_UI",
  );
  await dp.goto(`${origin}/doctor`);
  await dp.getByText("عمليات صرف كامل", { exact: true }).waitFor();
  ensure(
    (await dp.locator("body").innerText()).includes("عمليات صرف كامل"),
    "DOCTOR_STATS",
  );
  await pass(
    "reload_fresh_login_completed_lookup_revoked_browser_denial_doctor_completion",
  );
  stage = "cancellation_dispensing_race_B";
  // A natural reset also ensures no functional race is obscured by lookup quotas.
  console.log("WAITING_NATURAL_LOOKUP_WINDOW_65_SECONDS");
  await delay(65000);
  const lb = data(
    await rpc(pharmacist, "lookup_pharmacy_prescription", {
      p_reference: codeB,
    }),
    "B_LOOKUP",
  );
  const bstate = data(
    await rpc(doctor, "get_doctor_lifecycle", { p_id: B.id }),
    "B_LIFECYCLE",
  );
  if (bstate.status === "issued" && !bstate.dispensed) {
    const version = data(
      await doctor
        .from("prescriptions")
        .select("updated_at")
        .eq("id", B.id)
        .single(),
      "B_VERSION",
    ).updated_at;
    const cancelArgs = {
      p_id: B.id,
      p_expected_updated_at: version,
      p_request_id: (ledger.fixtures.B.cancelRequestId ??= randomUUID()),
      p_reason: "other_administrative_reason",
    };
    await save();
    const dispense = dispenseArgs(lb);
    const [cancelResult, dispenseResult] = await Promise.all([
      rpc(doctor, "cancel_doctor_prescription", cancelArgs),
      rpc(pharmacist, "dispense_pharmacy_prescription", dispense),
    ]);
    const final = data(
      await rpc(doctor, "get_doctor_lifecycle", { p_id: B.id }),
      "B_FINAL",
    );
    ensure(
      (final.status === "cancelled") !== final.dispensed,
      "RACE_EXCLUSIVE",
    );
    if (final.status === "cancelled") {
      ensure(!cancelResult.error, "CANCEL_WIN");
      conflict(dispenseResult);
      B.cancelled = true;
    } else {
      ensure(
        !dispenseResult.error && dispenseResult.data.state === "dispensed",
        "DISPENSE_WIN",
      );
      conflict(cancelResult);
      B.dispensed = true;
    }
    await save();
    conflict(
      await rpc(pharmacist, "dispense_pharmacy_prescription", dispenseArgs(lb)),
    );
  } else {
    ensure(
      bstate.status === "cancelled" || bstate.dispensed,
      "RESUME_B_TERMINAL",
    );
    B.cancelled = bstate.status === "cancelled";
    B.dispensed = bstate.dispensed;
    await save();
  }
  terminal(
    data(
      await rpc(pharmacist, "lookup_pharmacy_prescription", {
        p_reference: codeB,
      }),
      "B_TERMINAL",
    ),
    B.cancelled ? "cancelled" : "dispensed",
  );
  await pass(
    "native_parent_lock_cancel_dispense_race_exactly_one_outcome_stale_HTTP409_terminal_minimal",
  );
  stage = "persistent_throttle";
  console.log("WAITING_NATURAL_LOOKUP_WINDOW_65_SECONDS");
  await delay(65000);
  // Keep the total malformed authenticated probes <=11 across resumes, including
  // the initial native probe. Fill the rest of this fresh window with valid,
  // minimal terminal lookups of A, not additional clinical fixtures.
  const before = await counters();
  const failuresRemaining = 11 - (ledger.invalidLookups ?? 0);
  ensure(
    failuresRemaining >= 1 && failuresRemaining <= 11,
    "INVALID_PROBE_BOUND",
  );
  const validFill = 11 - failuresRemaining;
  for (let n = 0; n < validFill; n++)
    terminal(
      data(
        await rpc(pharmacist, "lookup_pharmacy_prescription", {
          p_reference: codeA,
        }),
        "VALID_RATE_FILL",
      ),
      "dispensed",
    );
  let invalid = 0,
    blocked = 0;
  for (let i = validFill; i < 11; i++) {
    ledger.invalidLookups = (ledger.invalidLookups ?? 0) + 1;
    await save();
    if (i % 2 === 0) {
      const r = await rpc(pharmacist, "lookup_pharmacy_prescription", {
        p_reference: "invalid",
      });
      ensure(
        r.status === (i < 10 ? 404 : 429) &&
          r.error?.code === (i < 10 ? "PT404" : "PT429"),
        "DURABLE_HTTP_FAILURE",
      );
    } else {
      const r = await post(pp, { operation: "lookup", reference: "invalid" });
      ensure(r.status === (i < 10 ? 404 : 429), "APP_ERROR_HTTP");
    }
    if (i < 10) invalid++;
    else blocked++;
  }
  const after = await counters();
  ensure(
    invalid === failuresRemaining - 1 &&
      blocked === 1 &&
      after.some((r) => r.scope === "lookup_actor_minute" && r.attempts === 11),
    "THROTTLE_COUNTER_PERSISTED",
  );
  ensure(
    after.find((r) => r.scope === "lookup_actor_hour").attempts >=
      before.find((r) => r.scope === "lookup_actor_hour").attempts + 11,
    "HOUR_DURABLE",
  );
  await pass(
    "bounded_failed_requests_across_direct_API_and_app_commit_eleventh_HTTP429_persistent_counters",
  );
  stage = "final_integrity";
  const latest = await snapshot();
  ensure(JSON.stringify(latest) === JSON.stringify(old), "PHASE4B_UNCHANGED");
  const counts = await Promise.all(
    ["patients", "prescriptions", "prescription_items", "dispensations"].map(
      (t) => doctor.from(t).select("id", { count: "exact", head: true }),
    ),
  );
  ensure(
    counts.every((r) => !r.error),
    "FINAL_COUNTS",
  );
  ensure(
    counts[0].count === 1 &&
      counts[1].count === 4 &&
      counts[2].count === 8 &&
      counts[3].count === (B.dispensed ? 2 : 1),
    "BOUNDED_COUNTS",
  );
  const completions = data(
    await doctor
      .from("dispensations")
      .select("id,prescription_id,pharmacist_user_id,pharmacy_id,dispensed_at"),
    "COMPLETION_COUNTS",
  );
  ensure(
    completions.every((r) => [A.id, B.id].includes(r.prescription_id)),
    "NO_OLD_DISPENSING",
  );
  ensure(!routeFailed, "BROWSER_RUNTIME_ERRORS");
  // No browser persistence holds references; evaluate comparisons in memory only.
  ensure(
    await pp.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
    "BROWSER_PERSISTENCE_EMPTY",
  );
  await pass(
    "final_counts_one_patient_four_prescriptions_eight_items_original_4B_unchanged_no_old_dispensing_no_browser_persistence",
  );
  stage = "passed";
  await report("PASS");
  console.log("PHASE5A_NATIVE_ACCEPTANCE_PASS");
} catch (error) {
  const safe = /^CHECK_[A-Z0-9_]+$/.test(error.message ?? "")
    ? error.message
    : error.name === "TimeoutError" || error.name === "AbortError"
      ? "BOUNDED_TIMEOUT_STOP_INSPECT_EXECUTION"
      : "SANITIZED_TEST_FAILURE";
  await report("FAILED", safe).catch(() => {});
  console.error(`PHASE5A_STOP ${stage} ${safe}`);
  process.exitCode = 1;
} finally {
  password = undefined;
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) {
    const ended = new Promise((r) => server.once("exit", r));
    server.kill();
    await ended;
  }
  // Revoke only SDK sessions this runner created, never unrelated sessions.
  for (const c of [doctor, pharmacist])
    if (c) await c.auth.signOut({ scope: "local" }).catch(() => {});
  if (lock) {
    const name = ".local/phase5a-hosted.lock";
    await lock.close();
    await import("node:fs/promises")
      .then((fs) => fs.unlink(name))
      .catch(() => {});
  }
}
