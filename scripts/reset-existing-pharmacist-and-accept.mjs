// One explicitly authorized existing-account password reset. No account creation or role writes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { readPrivateInput } from "./recovery-input.mjs";
import { runAcceptance } from "./phase4b-hosted-acceptance.mjs";
nextEnv.loadEnvConfig(process.cwd());
const project = "fckdsiozmufyhbnignet",
  email = "ahmedhany2522006@gmail.com";
const run = promisify(execFile);
let password, key, admin, ordinary;
const check = (condition, label) => {
  if (!condition) throw Error(label);
};
const options = {
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
};
const cli = async (...args) => {
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
          { timeout: 20000, maxBuffer: 2000000 },
        )
      ).stdout,
    );
  } catch {
    throw Error("TRUSTED_ADMIN_CLI_UNAVAILABLE");
  }
};
try {
  check(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname ===
      `${project}.supabase.co`,
    "SOURCE_MISMATCH",
  );
  const probe = JSON.parse(
    await readFile(".local/phase4b-native-timeout-result.json", "utf8"),
  );
  const cleanup = JSON.parse(
    (
      await readFile(".local/phase4b-timeout-cleanup-confirmed.json", "utf8")
    ).replace(/^\uFEFF/, ""),
  );
  check(
    probe.passed &&
      probe.attempts === 1 &&
      cleanup.executionEnded &&
      cleanup.temporaryObjectsRemoved &&
      cleanup.project === project,
    "COMPLETED_DIAGNOSTIC_NOT_CLEARED",
  );
  check(
    !(await access(".local/phase4b-pharmacist-reset-result.json").then(
      () => true,
      () => false,
    )),
    "RESET_ALREADY_RECORDED_INSPECT_DO_NOT_REPEAT",
  );
  const metadata = await cli("projects", "list");
  check(
    metadata.projects.some((p) => p.ref === project && p.name === "Eleyada RX"),
    "SOURCE_IDENTITY_NOT_CONFIRMED",
  );
  let keys = await cli(
    "projects",
    "api-keys",
    "--project-ref",
    project,
    "--reveal",
  );
  key = keys.keys.find((k) => k.type === "secret")?.api_key;
  keys = null;
  check(key?.startsWith("sb_secret_"), "TRUSTED_ADMIN_KEY_UNAVAILABLE");
  admin = createClient(`https://${project}.supabase.co`, key, options);
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  check(!listed.error, "TRUSTED_ADMIN_AUTH_UNAVAILABLE");
  const targets = listed.data.users.filter(
    (u) => u.email?.toLowerCase() === email,
  );
  check(
    targets.length === 1 && targets[0].role === "authenticated",
    "EXACT_EXISTING_PHARMACIST_NOT_FOUND",
  );
  const id = targets[0].id;
  // Service-role app-table access is deliberately restricted. Inspect only
  // sanitized trusted metadata; never broaden those grants for this utility.
  const inspected = await cli(
    "db",
    "query",
    "--linked",
    "--project-ref",
    project,
    "--file",
    "tests/database/hosted-phase4b-account-status.sql",
  );
  const before = (Array.isArray(inspected) ? inspected[0] : inspected.rows?.[0])
    ?.account_status;
  check(
    before?.pharmacist_auth_accounts === 1 &&
      before.pharmacist_memberships === 1 &&
      before.pharmacist_role_correct &&
      before.pharmacist_membership_active &&
      before.pharmacist_pharmacy_active &&
      before.pharmacist_pharmacy_link_present,
    "EXISTING_PHARMACIST_MEMBERSHIP_MISMATCH",
  );
  console.log(
    "Trusted source/admin verified. Enter the authorized shared password privately; no echo or storage:",
  );
  password = await readPrivateInput();
  check(password.length >= 8, "PRIVATE_INPUT_INVALID");
  // The only administrative mutation: password of this exact pre-existing Auth UUID.
  const reset = await admin.auth.admin.updateUserById(id, { password });
  check(
    !reset.error &&
      reset.data.user?.id === id &&
      reset.data.user.email?.toLowerCase() === email,
    "PHARMACIST_PASSWORD_RESET_FAILED",
  );
  await writeFile(
    ".local/phase4b-pharmacist-reset-result.json",
    JSON.stringify(
      {
        project,
        passwordReset: true,
        existingAccountOnly: true,
        loginVerified: false,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  ordinary = createClient(
    `https://${project}.supabase.co`,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );
  const login = await ordinary.auth.signInWithPassword({ email, password });
  check(!login.error, "POST_RESET_PHARMACIST_LOGIN_FAILED");
  const verified = await ordinary.auth.getUser();
  check(
    !verified.error && verified.data.user?.id === id,
    "POST_RESET_IDENTITY_MISMATCH",
  );
  const member = await ordinary
    .from("app_users")
    .select("id,role,pharmacy_id,is_active")
    .single();
  check(
    !member.error &&
      createHash("sha256")
        .update(
          [
            member.data.id,
            member.data.role,
            member.data.pharmacy_id,
            String(member.data.is_active),
          ].join("|"),
        )
        .digest("hex") === before.pharmacist_membership_fingerprint,
    "POST_RESET_MEMBERSHIP_CHANGED",
  );
  const pharmacy = await ordinary.from("pharmacies").select("id,name").single();
  check(
    !pharmacy.error && pharmacy.data.id === member.data.pharmacy_id,
    "POST_RESET_PHARMACY_MISMATCH",
  );
  await writeFile(
    ".local/phase4b-pharmacist-reset-result.json",
    JSON.stringify(
      {
        project,
        passwordReset: true,
        existingAccountOnly: true,
        loginVerified: true,
        membershipUnchanged: true,
        pharmacyActive: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS existing pharmacist password reset; real login verified; membership unchanged; pharmacy active.",
  );
  await ordinary.auth.signOut({ scope: "local" });
  ordinary = null;
  admin = null;
  key = null;
  await runAcceptance({
    doctor: { email: "tclinic65@gmail.com", password },
    pharmacist: { email, password },
  });
  console.log("Authorized Phase 4B acceptance finished.");
} catch (e) {
  console.error(
    "PHASE4B_STOPPED",
    /^[A-Z0-9_]+$/.test(e.message)
      ? e.message
      : "CHECK_FAILED_INSPECT_SAFE_RESULT",
  );
  process.exitCode = 1;
} finally {
  password = null;
  key = null;
  admin = null;
  if (ordinary) await ordinary.auth.signOut({ scope: "local" }).catch(() => {});
}
