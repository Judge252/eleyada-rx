// Explicitly authorized, bounded synthetic hosted acceptance. Never imported by the app.
// Existing CLI operator authorization stays in memory. Clinical writes use ordinary
// provider-issued sessions, the public application API and existing protected RPCs.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());
const project = "fckdsiozmufyhbnignet",
  origin = "http://127.0.0.1:3210";
// Set privately to the recipient explicitly approved for this operator run.
const approvedRecipient = process.env.CLINIC_RX_APPROVED_TEST_EMAIL?.trim().toLowerCase();
const ledgerPath = resolve(".local/clinic-hosted-acceptance.json");
const lockPath = resolve(".local/clinic-hosted-acceptance.lock");
const syntheticPharmacyName = "SYNTHETIC — Clinic RX acceptance pharmacy";
const run = promisify(execFile),
  clients = [];
let stage = "inspection",
  ledger,
  admin,
  browser,
  lock,
  original,
  restored = true;
const ensure = (condition, label) => {
  if (!condition) throw Error("CHECK_" + label);
};
const safeFetch = (url, init) =>
  fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
const persist = async () =>
  writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
const pass = async (label) => {
  if (!ledger.checks.includes(label)) ledger.checks.push(label);
  await persist();
  console.log("PASS " + label);
};
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
async function cli(...args) {
  try {
    return JSON.parse(
      (
        await run(
          process.execPath,
          [
            "node_modules/supabase/dist/supabase.js",
            ...args,
            "--agent",
            "no",
            "--output-format",
            "json",
          ],
          { windowsHide: true, maxBuffer: 3000000 },
        )
      ).stdout,
    );
  } catch {
    throw Error("CHECK_OPERATOR_COMMAND_FAILED_DETAILS_SUPPRESSED");
  }
}
async function sql(statement) {
  // SQL files contain operator metadata/internal UUIDs only; never tokens/passwords
  // or clinical payloads. Clinical payloads travel in memory-only HTTPS/HTTP bodies.
  const file = resolve(".local/clinic-operator-step.sql");
  await writeFile(file, statement);
  const result = await cli(
    "db",
    "query",
    "--linked",
    "--project-ref",
    project,
    "--file",
    file,
  );
  return Array.isArray(result) ? result : (result.rows ?? result.data ?? []);
}
async function snapshot() {
  const rows = await sql(`select jsonb_build_object(
    'clinic_count',(select count(*) from public.clinics),
    'pharmacies',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.id,'pharmacy_id',u.pharmacy_id,'active',u.is_active,'pharmacy_active',p.is_active,'credential_fingerprint',md5(coalesce(a.encrypted_password,'')))),'[]') from public.app_users u join auth.users a on a.id=u.id join public.pharmacies p on p.id=u.pharmacy_id where u.role='pharmacist' and p.name<>${quote(syntheticPharmacyName)}),
    'approved_doctors',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.id,'clinic_id',m.clinic_id,'approved',d.approved,'member_active',m.is_active,'active',u.is_active)),'[]') from public.app_users u join public.prescribers d on d.user_id=u.id join public.clinic_memberships m on m.user_id=u.id where u.role='doctor'),
    'clinical_counts',(select jsonb_build_object('patients',(select count(*) from public.patients),'prescriptions',(select count(*) from public.prescriptions),'form_receipts',(select count(*) from rx_private.form_receipts),'dispensations',(select count(*) from public.dispensations)))
  ) as inspection;`);
  return rows[0]?.inspection;
}
async function rpc(client, name, params, label, expectedCode) {
  const response = await client
    .rpc(name, params)
    .abortSignal(AbortSignal.timeout(12000));
  const code = response.error?.code ?? response.data?.code;
  if (expectedCode) {
    ensure(code === expectedCode, label);
    return response;
  }
  ensure(!code && response.data !== null, label);
  return response.data;
}
async function nativeSession(user) {
  ensure(user.email && user.role === "authenticated", "ORDINARY_AUTH_IDENTITY");
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  ensure(
    !link.error &&
      link.data.user?.id === user.id &&
      link.data.properties?.hashed_token,
    "NATIVE_SESSION_LINK",
  );
  const jar = new Map();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      },
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: safeFetch },
      cookies: {
        getAll: () => [...jar.values()],
        setAll: (values) => {
          for (const value of values) jar.set(value.name, value);
        },
      },
    },
  );
  const verified = await client.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  ensure(
    !verified.error && verified.data.user?.id === user.id,
    "NATIVE_PROVIDER_SESSION",
  );
  ensure(
    await rpc(client, "has_active_session", {}, "ACTIVE_SESSION"),
    "SESSION_NOT_ACTIVE",
  );
  clients.push(client);
  return { client, userId: user.id, jar };
}
const cookie = (session) =>
  [...session.jar.values()].map((c) => `${c.name}=${c.value}`).join("; ") +
  "; clinic_rx_language=en";
async function api(session, body, expectedStatus = 200) {
  const response = await safeFetch(origin + "/api/experience", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(session ? { Cookie: cookie(session) } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  ensure(
    response.status === expectedStatus,
    "APPLICATION_HTTP_" + expectedStatus,
  );
  return data;
}
function formPayload() {
  return {
    name: "SYNTHETIC Clinic RX acceptance — NOT FOR TREATMENT",
    country: "IL",
    type: "national_id",
    identifier: "000" + ledger.requestA.replaceAll("-", "").slice(0, 12),
    notes: "Synthetic software acceptance only. Not clinical advice.",
    items: [1, 2].map((n) => ({
      medication_name: "SYNTHETIC NONCLINICAL ITEM " + n,
      strength: "TEST ONLY",
      dose: "TEST ONLY",
      frequency: "TEST ONLY",
      duration: "TEST ONLY",
      quantity: n,
      special_instructions:
        "Synthetic fixture. Do not use for treatment or dispensing to a person.",
    })),
  };
}
async function inspectCommittedState() {
  const requestIds = [ledger.requestA, ledger.requestB].map(quote).join(",");
  const rows = await sql(
    `select jsonb_build_object('receipts',(select coalesce(jsonb_agg(jsonb_build_object('request_id',r.request_id,'prescription_id',r.prescription_id,'status',p.status,'dispensed',exists(select 1 from public.dispensations d where d.prescription_id=p.id))),'[]') from rx_private.form_receipts r join public.prescriptions p on p.id=r.prescription_id where r.request_id in (${requestIds})),'membership',(select clinic_id from public.clinic_memberships where user_id=${quote(ledger.doctorId)}::uuid),'entitlement',(select jsonb_build_object('starts_at',starts_at,'ends_at',ends_at,'active',is_active) from public.clinic_entitlements where clinic_id=${quote(ledger.clinicId)}::uuid)) as committed;`,
  );
  ledger.committed = rows[0]?.committed;
  await persist();
}
async function restoreMembership() {
  if (restored || !ledger?.crossClinicId) return;
  const state = await sql(
    `begin; update public.clinic_memberships set clinic_id=${quote(ledger.clinicId)}::uuid where user_id=${quote(ledger.doctorId)}::uuid and clinic_id=${quote(ledger.crossClinicId)}::uuid; update public.clinics set is_active=false where id=${quote(ledger.crossClinicId)}::uuid; commit; select clinic_id=${quote(ledger.clinicId)}::uuid as restored from public.clinic_memberships where user_id=${quote(ledger.doctorId)}::uuid;`,
  );
  ensure(state[0]?.restored, "MEMBERSHIP_RESTORATION");
  restored = true;
  ledger.membershipRestored = true;
  await persist();
}
async function verifyRemaining(doctorUser, pharmacyUser) {
  ensure(
    ledger.status === "stopped_for_committed_state_review" &&
      ledger.failedStage === "cross_clinic_and_entitlement_denials" &&
      ledger.membershipRestored &&
      ledger.syntheticPharmacyDisabled,
    "REVIEWED_RESUME_BOUNDARY",
  );
  await inspectCommittedState();
  ensure(
    ledger.committed.membership === ledger.clinicId &&
      ledger.committed.receipts.length === 2 &&
      ledger.committed.receipts.some(
        (r) => r.prescription_id === ledger.a && r.dispensed,
      ) &&
      ledger.committed.receipts.some(
        (r) =>
          r.prescription_id === ledger.b &&
          r.status === "cancelled" &&
          !r.dispensed,
      ),
    "RESUME_COMMITTED_STATE",
  );
  lock = await open(lockPath, "wx");
  const doctor = await nativeSession(doctorUser),
    pharmacy = await nativeSession(pharmacyUser);
  stage = "remaining_cross_clinic_verification";
  const fixture = await sql(
    `select id from public.clinics where id=${quote(ledger.crossClinicId)}::uuid and name='SYNTHETIC — Clinic RX cross-clinic denial fixture' and not is_active and not exists(select 1 from rx_private.patient_clinics where clinic_id=${quote(ledger.crossClinicId)}::uuid);`,
  );
  ensure(fixture.length === 1, "EMPTY_SYNTHETIC_CLINIC_REUSE");
  restored = false;
  await sql(
    `begin; update public.clinics set is_active=true where id=${quote(ledger.crossClinicId)}::uuid; update public.clinic_memberships set clinic_id=${quote(ledger.crossClinicId)}::uuid where user_id=${quote(ledger.doctorId)}::uuid and clinic_id=${quote(ledger.clinicId)}::uuid; commit; select true as switched;`,
  );
  try {
    const visible = await doctor.client
      .from("prescriptions")
      .select("id")
      .eq("id", ledger.a);
    ensure(
      !visible.error && visible.data.length === 0,
      "CROSS_CLINIC_RLS_READ_DENIED",
    );
    await rpc(
      doctor.client,
      "get_doctor_lifecycle",
      { p_id: ledger.a },
      "CROSS_CLINIC_LEGACY_RPC_DENIED",
      "42501",
    );
    const response = await safeFetch(
      origin + `/doctor/prescriptions/${ledger.a}`,
      { headers: { Cookie: cookie(doctor) } },
    );
    const html = await response.text();
    const notFound =
      (response.status === 404 ||
        (response.status === 200 &&
          html.includes("noindex") &&
          html.includes("NEXT_HTTP_ERROR_FALLBACK;404"))) &&
      !html.includes(formPayload().name) &&
      !html.includes("SYNTHETIC NONCLINICAL ITEM");
    console.log(
      JSON.stringify({
        crossClinicPageStatus: response.status,
        notFoundWithoutClinicalContent: notFound,
      }),
    );
    ensure(notFound, "CROSS_CLINIC_STREAMED_NOT_FOUND");
    await api(
      doctor,
      {
        operation: "issue",
        requestId: randomUUID(),
        payload: formPayload(),
        confirmed: true,
        reviewedDoctorId: ledger.doctorId,
        reviewedClinicId: ledger.crossClinicId,
      },
      402,
    );
    await pass(
      "HOSTED_CROSS_CLINIC_RLS_LEGACY_ROUTE_AND_INACTIVE_ENTITLEMENT_DENIALS",
    );
  } finally {
    await restoreMembership();
  }
  stage = "remaining_final_integrity";
  await api(null, { operation: "context" }, 403);
  await rpc(
    pharmacy.client,
    "issue_form_prescription",
    { p_request_id: randomUUID(), p_payload: formPayload(), p_confirmed: true },
    "PHARMACIST_CANNOT_PRESCRIBE",
    "42501",
  );
  const current = await snapshot();
  ensure(
    JSON.stringify(current.pharmacies) === JSON.stringify(original.pharmacies),
    "EXISTING_PHARMACY_PASSWORD_AND_MEMBERSHIP_PRESERVED",
  );
  ensure(
    JSON.stringify(current.clinical_counts) ===
      JSON.stringify(original.clinical_counts),
    "NO_ADDITIONAL_CLINICAL_WRITES",
  );
  const state = await sql(
    `select (select count(*) from public.dispensations where prescription_id=${quote(ledger.a)}::uuid)=1 as one_dispensation,(select count(*) from rx_private.form_receipts where request_id in (${quote(ledger.requestA)}::uuid,${quote(ledger.requestB)}::uuid))=2 as two_receipts,(select not is_active from public.app_users where id=${quote(ledger.secondUserId)}::uuid) as synthetic_user_disabled,(select not is_active from public.pharmacies where id=${quote(ledger.secondPharmacyId)}::uuid) as synthetic_pharmacy_disabled,(select ends_at-starts_at=interval '7 days' from public.clinic_entitlements where clinic_id=${quote(ledger.clinicId)}::uuid) as exact_window;`,
  );
  ensure(
    state[0] && Object.values(state[0]).every((v) => v === true),
    "FINAL_SCOPED_INTEGRITY",
  );
  await inspectCommittedState();
  await pass(
    "UNAUTHORIZED_DENIALS_BOUNDED_WRITES_AND_EXISTING_PHARMACY_PRESERVATION",
  );
  ledger.status = "completed_operator_authenticated_hosted_acceptance";
  ledger.emailDelivery =
    "not tested; custom SMTP/token template still required";
  ledger.resumedVerificationWithoutNewClinicalWrites = true;
  await persist();
  console.log(
    JSON.stringify({
      status: ledger.status,
      checks: ledger.checks.length,
      issued: 2,
      dispensed: 1,
      cancelled: 1,
      liveEmailOtpVerified: false,
      startsAt: ledger.window.starts_at,
      endsAt: ledger.window.ends_at,
    }),
  );
}
async function main() {
  ensure(approvedRecipient, "EXPLICIT_APPROVED_TEST_RECIPIENT_REQUIRED");
  await mkdir(resolve(".local"), { recursive: true });
  ensure(
    (await readFile("supabase/.temp/project-ref", "utf8")).trim() === project,
    "LINKED_TARGET",
  );
  ensure(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname ===
      `${project}.supabase.co`,
    "APPLICATION_TARGET",
  );
  ensure(
    createHash("sha256")
      .update(
        await readFile(
          "supabase/migrations/20261106120000_multiclinic_form.sql",
        ),
      )
      .digest("hex")
      .toUpperCase() ===
      "EA53D97B0249101EE2858EAD6A773D046DB3B4418E305FC6AB74A791E883260A",
    "MIGRATION_BYTES",
  );
  const keys = await cli(
    "projects",
    "api-keys",
    "--project-ref",
    project,
    "--reveal",
  );
  let operatorKey = keys.keys?.find((k) => k.type === "secret")?.api_key;
  ensure(
    operatorKey?.startsWith("sb_secret_"),
    "EXISTING_OPERATOR_AUTHORIZATION",
  );
  admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, operatorKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: safeFetch },
  });
  operatorKey = "";
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  ensure(
    !listed.error && listed.data.users.length < 1000,
    "BOUNDED_IDENTITY_LIST",
  );
  const users = listed.data.users;
  const doctorUser = users.find(
    (u) => u.email?.toLowerCase() === approvedRecipient,
  );
  ensure(
    doctorUser?.email_confirmed_at,
    "APPROVED_RECIPIENT_EXISTING_IDENTITY",
  );
  original = await snapshot();
  ensure(
    original && original.pharmacies.length === 1,
    "EXISTING_PHARMACY_SCOPE",
  );
  const doctor = original.approved_doctors.find(
    (d) => d.user_id === doctorUser.id,
  );
  ensure(
    doctor?.approved && doctor.member_active && doctor.active,
    "EXISTING_APPROVED_PRESCRIBER",
  );
  const firstPharmacyUser = users.find(
    (u) => u.id === original.pharmacies[0].user_id,
  );
  ensure(
    firstPharmacyUser?.email_confirmed_at &&
      original.pharmacies[0].active &&
      original.pharmacies[0].pharmacy_active,
    "EXISTING_APPROVED_PHARMACY",
  );
  try {
    ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  } catch {
    ledger = {
      project,
      requestA: randomUUID(),
      requestB: randomUUID(),
      dispenseRequest: randomUUID(),
      cancelRequest: randomUUID(),
      syntheticSeed: randomUUID(),
      checks: [],
      status: "prepared",
    };
  }
  ensure(ledger.project === project, "LEDGER_TARGET");
  ledger.doctorId ??= doctorUser.id;
  ledger.clinicId ??= doctor.clinic_id;
  ensure(
    ledger.doctorId === doctorUser.id && ledger.clinicId === doctor.clinic_id,
    "DESIGNATED_CLINIC",
  );
  if (process.argv.includes("--verify-remaining"))
    return verifyRemaining(doctorUser, firstPharmacyUser);
  if (!process.argv.includes("--run")) {
    console.log(
      JSON.stringify({
        target: project,
        approvedRecipientIsExistingApprovedPrescriber: true,
        existingPharmacyPreserved: true,
        boundedPlan:
          "two synthetic prescriptions, one new synthetic pharmacy, seven-day entitlement on the designated existing clinic",
        emailDelivery: "not tested; operator-issued sessions are separate",
        writes: false,
      }),
    );
    return;
  }
  ensure(
    ledger.status === "prepared",
    "FRESH_RUN_REQUIRED_INSPECT_BEFORE_RESUMING",
  );
  lock = await open(lockPath, "wx");
  await persist();
  const ready = await safeFetch(origin + "/");
  ensure(ready.status === 200, "LOCAL_APPLICATION_READY");
  stage = "test_identity_provisioning";
  ledger.status = "running";
  await persist();
  const secondEmail = `clinic-rx-synthetic-${ledger.syntheticSeed}@example.invalid`;
  ensure(
    !users.some((u) => u.email?.toLowerCase() === secondEmail),
    "NO_DUPLICATE_TEST_IDENTITY",
  );
  const created = await admin.auth.admin.createUser({
    email: secondEmail,
    email_confirm: true,
    user_metadata: { clinic_rx_synthetic_test: true },
  });
  ensure(
    !created.error && created.data.user?.id,
    "SYNTHETIC_PHARMACY_AUTH_USER",
  );
  const secondUser = created.data.user;
  ledger.secondUserId = secondUser.id;
  await persist();
  const provisioned = await sql(
    `begin; insert into public.pharmacies(name) values(${quote(syntheticPharmacyName)}) returning id; insert into public.app_users(id,role,pharmacy_id) select ${quote(secondUser.id)}::uuid,'pharmacist',id from public.pharmacies where name=${quote(syntheticPharmacyName)}; commit; select pharmacy_id from public.app_users where id=${quote(secondUser.id)}::uuid;`,
  );
  ensure(provisioned[0]?.pharmacy_id, "SYNTHETIC_PHARMACY_MAPPING");
  ledger.secondPharmacyId = provisioned[0].pharmacy_id;
  await persist();
  stage = "native_operator_sessions";
  const doctorSession = await nativeSession(doctorUser),
    pharmacy = await nativeSession(firstPharmacyUser),
    second = await nativeSession(secondUser);
  await pass("REAL_PROVIDER_SESSIONS_NO_EMAIL_DELIVERY_CLAIM");
  stage = "seven_day_test_entitlement";
  const window = await sql(
    `begin; with t as materialized (select clock_timestamp() as started) update public.clinic_entitlements set starts_at=t.started,ends_at=t.started+interval '7 days',is_active=true from t where clinic_id=${quote(ledger.clinicId)}::uuid and not is_active; commit; select starts_at,ends_at,is_active,(ends_at-starts_at=interval '7 days') as seven_days from public.clinic_entitlements where clinic_id=${quote(ledger.clinicId)}::uuid;`,
  );
  ensure(
    window[0]?.is_active && window[0].seven_days,
    "FINITE_SEVEN_DAY_ENTITLEMENT",
  );
  ledger.window = window[0];
  await persist();
  const context = await api(doctorSession, { operation: "context" });
  ensure(
    context.result?.entitled && context.result.clinic_id === ledger.clinicId,
    "VERIFIED_ENTITLED_APPLICATION_CONTEXT",
  );
  await pass("SEVEN_DAY_ENTITLEMENT_LIMITED_TO_DESIGNATED_CLINIC");
  stage = "public_doctor_form_issuance";
  browser = await chromium.launch({ headless: true });
  const doctorBrowser = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await doctorBrowser.addCookies(
    [...doctorSession.jar.values()].map((c) => ({
      name: c.name,
      value: c.value,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })),
  );
  await doctorBrowser.addCookies([
    { name: "clinic_rx_language", value: "en", url: origin },
  ]);
  await doctorBrowser.addInitScript(
    (id) => sessionStorage.setItem("rx.issue.request", id),
    ledger.requestA,
  );
  const page = await doctorBrowser.newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  const payload = formPayload();
  await page.locator("#patient-name").fill(payload.name);
  await page.locator("#patient-id").fill("٠۰٠" + payload.identifier.slice(3));
  await page.locator("#patient-country").selectOption(payload.country);
  await page.locator("#notes").fill(payload.notes);
  await page.getByRole("button", { name: "Add another medication" }).click();
  for (let i = 0; i < 2; i++) {
    const med = payload.items[i];
    for (const [field, value] of Object.entries({
      name: med.medication_name,
      strength: med.strength,
      dose: med.dose,
      frequency: med.frequency,
      duration: med.duration,
      quantity: String(med.quantity),
      instructions: med.special_instructions,
    }))
      await page.locator(`#med-${i + 1}-${field}`).fill(value);
  }
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  const issuedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/experience") &&
      r.request().postDataJSON()?.operation === "issue",
  );
  await page
    .getByRole("button", { name: "Confirm prescription issuance" })
    .click();
  const issuedHttp = await issuedResponse,
    issued = await issuedHttp.json();
  ensure(
    issuedHttp.status() === 200 && issued.result?.id,
    "REAL_FORM_ISSUANCE",
  );
  ledger.a = issued.result.id;
  await persist();
  await page
    .getByRole("heading", { name: "Prescription issued", exact: true })
    .waitFor();
  await pass("REAL_DOCTOR_UI_REVIEW_CONFIRMATION_AND_RECEIPT");
  const issueBody = {
    operation: "issue",
    requestId: ledger.requestA,
    payload,
    confirmed: true,
    reviewedDoctorId: doctorUser.id,
    reviewedClinicId: ledger.clinicId,
  };
  const replay = await api(doctorSession, issueBody);
  ensure(
    replay.result?.id === ledger.a && replay.result.replayed,
    "ISSUANCE_IDENTICAL_REPLAY",
  );
  await api(
    doctorSession,
    {
      ...issueBody,
      payload: { ...payload, notes: "Changed synthetic payload" },
    },
    409,
  );
  const recovered = await api(doctorSession, {
    operation: "recoverIssue",
    requestId: ledger.requestA,
  });
  ensure(recovered.result?.id === ledger.a, "ISSUANCE_RECOVERY");
  await pass("ISSUANCE_REPLAY_CHANGED_PAYLOAD_CONFLICT_AND_RECOVERY");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const issuedB = await api(doctorSession, {
    ...issueBody,
    requestId: ledger.requestB,
  });
  ensure(
    issuedB.result?.id && issuedB.result.id !== ledger.a,
    "SECOND_BOUNDED_SYNTHETIC_PRESCRIPTION",
  );
  ledger.b = issuedB.result.id;
  await persist();
  stage = "pharmacy_identity_lookup";
  const pharmacyBrowser = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await pharmacyBrowser.addCookies(
    [...pharmacy.jar.values()].map((c) => ({
      name: c.name,
      value: c.value,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })),
  );
  await pharmacyBrowser.addCookies([
    { name: "clinic_rx_language", value: "en", url: origin },
  ]);
  await pharmacyBrowser.addInitScript(
    (id) => sessionStorage.setItem("rx.dispense.request", id),
    ledger.dispenseRequest,
  );
  const pharmacyPage = await pharmacyBrowser.newPage();
  await pharmacyPage.goto(origin + "/portal");
  await pharmacyPage.locator("#lookup-id").fill(payload.identifier);
  await pharmacyPage.locator("#lookup-country").selectOption("IL");
  const searchResponse = pharmacyPage.waitForResponse(
    (r) =>
      r.url().endsWith("/api/experience") &&
      r.request().postDataJSON()?.operation === "search",
  );
  await pharmacyPage
    .getByRole("button", { name: "Search for prescriptions", exact: true })
    .click();
  const found = await (await searchResponse).json();
  ensure(found.result?.matches?.length === 2, "TWO_EXACT_IDENTITY_MATCHES");
  const position = found.result.matches.findIndex((r) => r.id === ledger.a);
  ensure(position >= 0, "EXPLICIT_RESULT_SELECTION");
  const bGrant = await rpc(
    pharmacy.client,
    "select_pharmacy_prescription",
    { p_search_id: found.result.search_id, p_prescription_id: ledger.b },
    "CANCELLATION_REVIEW_GRANT",
  );
  const secondSearch = await rpc(
    second.client,
    "search_pharmacy_identity",
    {
      p_country: "IL",
      p_type: "national_id",
      p_identifier: payload.identifier,
      p_offset: 0,
    },
    "SECOND_PHARMACY_LOOKUP",
  );
  const secondGrant = await rpc(
    second.client,
    "select_pharmacy_prescription",
    { p_search_id: secondSearch.search_id, p_prescription_id: ledger.a },
    "SECOND_PHARMACY_SELECTION",
  );
  await rpc(
    second.client,
    "select_pharmacy_prescription",
    { p_search_id: found.result.search_id, p_prescription_id: ledger.a },
    "SEARCH_GRANT_ACTOR_ISOLATION",
    "PT404",
  );
  const selectedResponse = pharmacyPage.waitForResponse(
    (r) =>
      r.url().endsWith("/api/experience") &&
      r.request().postDataJSON()?.operation === "select",
  );
  await pharmacyPage
    .getByRole("button", { name: "Select prescription", exact: true })
    .nth(position)
    .click();
  const selected = await (await selectedResponse).json();
  ensure(
    selected.result?.prescription_id === ledger.a &&
      selected.result.items.length === 2,
    "IMMUTABLE_SELECTED_MEDICATION_REVIEW",
  );
  const confirm = pharmacyPage.getByRole("button", {
    name: "Confirm full dispensing",
    exact: true,
  });
  ensure(await confirm.isDisabled(), "BOTH_CONFIRMATIONS_REQUIRED");
  await pharmacyPage.getByRole("checkbox").nth(0).check();
  ensure(await confirm.isDisabled(), "FULL_CONFIRMATION_REQUIRED");
  await pharmacyPage.getByRole("checkbox").nth(1).check();
  await pass(
    "REAL_PHARMACY_UI_EXACT_LOOKUP_EXPLICIT_SELECTION_AND_BOTH_CONFIRMATIONS",
  );
  stage = "atomic_full_dispensing";
  const completedResponse = pharmacyPage.waitForResponse(
    (r) =>
      r.url().endsWith("/api/experience") &&
      r.request().postDataJSON()?.operation === "dispense",
  );
  await confirm.click();
  const completedHttp = await completedResponse,
    completed = await completedHttp.json();
  ensure(
    completedHttp.status() === 200 && completed.result?.state === "dispensed",
    "FULL_DISPENSING_COMMITTED",
  );
  ledger.dispensation = completed.result.id;
  await persist();
  await pharmacyPage
    .getByRole("heading", { name: "Full dispensing confirmed", exact: true })
    .waitFor();
  const dispenseBody = {
    operation: "dispense",
    requestId: ledger.dispenseRequest,
    lookupId: selected.result.lookup_id,
    prescriptionId: ledger.a,
    identityConfirmed: true,
    fullConfirmed: true,
  };
  const retry = await api(pharmacy, dispenseBody);
  ensure(
    retry.result?.id === ledger.dispensation && retry.result.replayed,
    "DISPENSING_IDENTICAL_REPLAY",
  );
  const recoveredDispense = await api(pharmacy, {
    operation: "recoverDispense",
    requestId: ledger.dispenseRequest,
  });
  ensure(
    recoveredDispense.result?.id === ledger.dispensation,
    "DISPENSING_RECOVERY",
  );
  await rpc(
    second.client,
    "dispense_pharmacy_prescription",
    {
      p_lookup_id: secondGrant.lookup_id,
      p_prescription_id: ledger.a,
      p_request_id: randomUUID(),
      p_identity_confirmed: true,
      p_full_confirmed: true,
    },
    "SECOND_PHARMACY_CANNOT_DISPENSE_AGAIN",
    "PT409",
  );
  await pass("FULL_DISPENSING_REPLAY_RECOVERY_AND_SECOND_PHARMACY_REJECTION");
  stage = "cancellation_and_expiry_protections";
  const version = await doctorSession.client
    .from("prescriptions")
    .select("updated_at")
    .eq("id", ledger.b)
    .single();
  ensure(!version.error, "CANCELLATION_VERSION");
  const cancellation = await safeFetch(
    origin + `/api/doctor/prescriptions/${ledger.b}/lifecycle`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie(doctorSession),
      },
      body: JSON.stringify({
        operation: "cancel",
        requestId: ledger.cancelRequest,
        version: version.data.updated_at,
        reason: "entered_in_error",
        confirmed: true,
      }),
    },
  );
  ensure(cancellation.status === 200, "AUTHORIZED_CANCELLATION");
  await rpc(
    pharmacy.client,
    "dispense_pharmacy_prescription",
    {
      p_lookup_id: bGrant.lookup_id,
      p_prescription_id: ledger.b,
      p_request_id: randomUUID(),
      p_identity_confirmed: true,
      p_full_confirmed: true,
    },
    "CANCELLED_PRESCRIPTION_REJECTED",
    "PT409",
  );
  const old = await doctorSession.client
    .from("prescriptions")
    .select("id,status,expires_at,dispensations(id)")
    .eq("status", "issued")
    .lt("expires_at", new Date().toISOString())
    .limit(5);
  ensure(!old.error, "EXPIRY_METADATA_READ");
  const expired = old.data.find(
    (r) =>
      !r.dispensations ||
      (Array.isArray(r.dispensations) && r.dispensations.length === 0),
  );
  if (expired) {
    const state = await rpc(
      doctorSession.client,
      "get_doctor_lifecycle",
      { p_id: expired.id },
      "EXPIRED_LIFECYCLE",
    );
    ensure(state.status === "expired", "EXPIRY_BY_DATABASE_CLOCK");
    const reference = await rpc(
      doctorSession.client,
      "reveal_doctor_reference",
      { p_id: expired.id },
      "EXPIRED_REFERENCE_READ",
    );
    const lookup = await rpc(
      pharmacy.client,
      "lookup_pharmacy_prescription",
      { p_reference: reference.reference },
      "EXPIRED_LOOKUP",
    );
    ensure(
      lookup.state === "expired" && !lookup.items && !lookup.patient,
      "EXPIRED_LOOKUP_NO_CLINICAL_CONTENT",
    );
    await pass("EXISTING_EXPIRED_SYNTHETIC_PRESCRIPTION_NOT_ELIGIBLE");
  } else
    ledger.expiryLimitation =
      "No uncompleted existing expired issued fixture; no history backdating performed.";
  await pass("AUTHORIZED_CANCELLATION_AND_CANCELLED_DISPENSING_REJECTION");
  stage = "cross_clinic_and_entitlement_denials";
  const scoped = await sql(
    `insert into public.clinics(name) values('SYNTHETIC — Clinic RX cross-clinic denial fixture') returning id;`,
  );
  ensure(scoped[0]?.id, "SYNTHETIC_CROSS_CLINIC_CONTEXT");
  ledger.crossClinicId = scoped[0].id;
  await persist();
  restored = false;
  await sql(
    `begin; update public.clinic_memberships set clinic_id=${quote(ledger.crossClinicId)}::uuid where user_id=${quote(ledger.doctorId)}::uuid and clinic_id=${quote(ledger.clinicId)}::uuid; commit; select true as switched;`,
  );
  try {
    const visible = await doctorSession.client
      .from("prescriptions")
      .select("id")
      .eq("id", ledger.a);
    ensure(
      !visible.error && visible.data.length === 0,
      "CROSS_CLINIC_RLS_READ_DENIED",
    );
    await rpc(
      doctorSession.client,
      "get_doctor_lifecycle",
      { p_id: ledger.a },
      "CROSS_CLINIC_LEGACY_RPC_DENIED",
      "42501",
    );
    const legacyPage = await safeFetch(
      origin + `/doctor/prescriptions/${ledger.a}`,
      { headers: { Cookie: cookie(doctorSession) } },
    );
    const legacyHtml = await legacyPage.text();
    ensure(
      (legacyPage.status === 404 ||
        (legacyPage.status === 200 &&
          legacyHtml.includes("noindex") &&
          legacyHtml.includes("NEXT_HTTP_ERROR_FALLBACK;404"))) &&
        !legacyHtml.includes(payload.name) &&
        !legacyHtml.includes("SYNTHETIC NONCLINICAL ITEM"),
      "CROSS_CLINIC_LEGACY_DOCUMENT_DENIED",
    );
    await api(
      doctorSession,
      {
        ...issueBody,
        requestId: randomUUID(),
        reviewedClinicId: ledger.crossClinicId,
      },
      402,
    );
    await pass(
      "HOSTED_CROSS_CLINIC_RLS_LEGACY_ROUTE_AND_INACTIVE_ENTITLEMENT_DENIALS",
    );
  } finally {
    await restoreMembership();
  }
  stage = "unauthorized_and_final_integrity";
  await api(null, issueBody, 403);
  await rpc(
    pharmacy.client,
    "issue_form_prescription",
    { p_request_id: randomUUID(), p_payload: payload, p_confirmed: true },
    "PHARMACIST_CANNOT_PRESCRIBE",
    "42501",
  );
  const current = await snapshot();
  ensure(
    JSON.stringify(current.pharmacies) === JSON.stringify(original.pharmacies),
    "EXISTING_PHARMACY_PASSWORD_AND_MEMBERSHIP_PRESERVED",
  );
  await inspectCommittedState();
  ensure(
    ledger.committed.receipts.length === 2 &&
      ledger.committed.receipts.some(
        (r) => r.prescription_id === ledger.a && r.dispensed,
      ) &&
      ledger.committed.receipts.some(
        (r) =>
          r.prescription_id === ledger.b &&
          r.status === "cancelled" &&
          !r.dispensed,
      ),
    "BOUNDED_COMMITTED_FINAL_STATE",
  );
  ensure(
    current.clinical_counts.prescriptions ===
      original.clinical_counts.prescriptions + 2 &&
      current.clinical_counts.patients ===
        original.clinical_counts.patients + 2 &&
      current.clinical_counts.dispensations ===
        original.clinical_counts.dispensations + 1,
    "NO_DUPLICATE_CLINICAL_WRITES",
  );
  await pass(
    "UNAUTHORIZED_DENIALS_BOUNDED_WRITES_AND_EXISTING_PHARMACY_PRESERVATION",
  );
  ledger.status = "completed_operator_authenticated_hosted_acceptance";
  ledger.emailDelivery =
    "not tested; custom SMTP/token template still required";
  await persist();
  console.log(
    JSON.stringify({
      status: ledger.status,
      checks: ledger.checks.length,
      issued: 2,
      dispensed: 1,
      cancelled: 1,
      liveEmailOtpVerified: false,
      startsAt: ledger.window.starts_at,
      endsAt: ledger.window.ends_at,
    }),
  );
}
try {
  await main();
} catch (error) {
  if (error instanceof Error && /^CHECK_[A-Z0-9_]+$/.test(error.message))
    console.error(error.message);
  if (ledger && lock && process.argv.includes("--run")) {
    ledger.status = "stopped_for_committed_state_review";
    ledger.failedStage = stage;
    try {
      await inspectCommittedState();
    } catch {
      ledger.committedStateInspectionPending = true;
    }
    await persist().catch(() => {});
  }
  console.error(
    "STOP " +
      stage +
      ": details suppressed; inspect committed state before any retry.",
  );
  process.exitCode = 1;
} finally {
  await restoreMembership().catch(() => {
    console.error("MEMBERSHIP_RESTORATION_REQUIRES_OPERATOR_REVIEW");
    process.exitCode = 1;
  });
  if (browser) await browser.close().catch(() => {});
  for (const client of clients)
    await client.auth.signOut({ scope: "local" }).catch(() => {});
  // Disable only the synthetic pharmacy created by this run. Keep identity/audit links.
  if (
    ledger?.secondUserId &&
    ledger?.secondPharmacyId &&
    lock &&
    process.argv.includes("--run")
  )
    try {
      await sql(
        `begin; update public.app_users set is_active=false where id=${quote(ledger.secondUserId)}::uuid and role='pharmacist' and pharmacy_id=${quote(ledger.secondPharmacyId)}::uuid; update public.pharmacies set is_active=false where id=${quote(ledger.secondPharmacyId)}::uuid and name=${quote(syntheticPharmacyName)}; commit; select true as synthetic_access_disabled;`,
      );
      ledger.syntheticPharmacyDisabled = true;
      await persist();
    } catch {
      console.error("SYNTHETIC_ACCESS_CLEANUP_REQUIRES_REVIEW");
      process.exitCode = 1;
    }
  if (lock) {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}
