// Operator-only: credentials stay in process memory; no trace, screenshot or secret output.
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { readPrivateInput } from "./recovery-input.mjs";
import { timeoutPassed } from "./run-native-timeout-probe.mjs";
import { access, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
nextEnv.loadEnvConfig(process.cwd());
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const marker = ".local/phase4b-timeout-cleanup-confirmed.json";
const resume = process.argv.includes("--continue-after-probe");
let values;
let client;
try {
  if (
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
    "fckdsiozmufyhbnignet.supabase.co"
  )
    throw Error("TARGET_MISMATCH");
  if (
    !resume &&
    ((await exists(".local/phase4b-native-timeout-result.json")) ||
      (await exists(marker)))
  )
    throw Error("PRIOR_RESULT_INSPECT_FIRST");
  if (resume) {
    const prior = JSON.parse(
      await readFile(".local/phase4b-native-timeout-result.json", "utf8"),
    );
    const cleanup = JSON.parse(
      (await readFile(marker, "utf8")).replace(/^\uFEFF/, ""),
    );
    if (
      !prior.passed ||
      prior.sqlstate !== "57014" ||
      prior.attempts !== 1 ||
      !cleanup.executionEnded ||
      !cleanup.rollbackConfirmed ||
      !cleanup.temporaryObjectsRemoved ||
      cleanup.project !== "fckdsiozmufyhbnignet"
    )
      throw Error("PRIOR_PROBE_NOT_CLEARED");
    console.log(
      "Approved continuation: timeout already passed and cleaned. It will NOT run again.",
    );
  }
  console.log(
    "PHASE 4B ONLY. Backup/recovery excluded. No input is echoed or saved.",
  );
  console.log(
    "Doctor tclinic65@gmail.com: enter password privately, then Enter:",
  );
  values = {
    doctor: {
      email: "tclinic65@gmail.com",
      password: await readPrivateInput(),
    },
  };
  console.log(
    "Pharmacist ahmedhany2522006@gmail.com: enter password privately, then Enter:",
  );
  values.pharmacist = {
    email: "ahmedhany2522006@gmail.com",
    password: await readPrivateInput(),
  };
  client = createClient(
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
  if ((await client.auth.signInWithPassword(values.doctor)).error)
    throw Error("PRIVATE_SIGN_IN_FAILED");
  if ((await client.auth.getUser()).error)
    throw Error("VERIFIED_USER_REQUIRED");
  const member = await client
    .from("app_users")
    .select("role,is_active")
    .single();
  if (
    member.error ||
    member.data.role !== "doctor" ||
    !member.data.is_active ||
    (await client.rpc("has_active_session")).data !== true
  )
    throw Error("LIVE_DOCTOR_REQUIRED");
  if (!resume) {
    const started = performance.now();
    const r = await client
      .rpc("phase4b_deadline_probe")
      .abortSignal(AbortSignal.timeout(3000));
    const elapsedMs = Math.round(performance.now() - started);
    const result = {
      project: "fckdsiozmufyhbnignet",
      passed: timeoutPassed(r, elapsedMs),
      httpStatus: r.status,
      sqlstate: r.error?.code ?? null,
      elapsedMs,
      attempts: 1,
      independentInspectionPending: true,
    };
    await writeFile(
      ".local/phase4b-native-timeout-result.json",
      JSON.stringify(result, null, 2),
      { flag: "wx" },
    );
    console.log(JSON.stringify(result));
    if (!result.passed) throw Error("TIMEOUT_PROBE_FAILED_STOP_NO_RETRY");
    console.log(
      "Waiting for independent database inspection and diagnostic cleanup. Do not close this window.",
    );
    const end = Date.now() + 15 * 60 * 1000;
    while (!(await exists(marker))) {
      if (Date.now() > end) throw Error("CLEANUP_CONFIRMATION_PENDING");
      await delay(1000);
    }
  }
  if (process.argv.includes("--finish-existing-histories")) {
    const { finishAcceptance } = await import(
      "./finish-phase4b-acceptance.mjs"
    );
    await finishAcceptance(values, {
      sessionOnly: process.argv.includes("--session-only"),
    });
  } else {
    const { runAcceptance } = await import("./phase4b-hosted-acceptance.mjs");
    await runAcceptance(values, {
      resumeExistingDrafts: process.argv.includes("--resume-existing-drafts"),
    });
  }
  console.log("Bounded Phase 4B acceptance finished. Return to chat.");
} catch (e) {
  console.error(
    "PHASE4B_STOPPED",
    /^[A-Z0-9_]+$/.test(e.message)
      ? e.message
      : "CHECK_FAILED_INSPECT_SAFE_RESULT",
  );
  process.exitCode = 1;
} finally {
  if (values) {
    values.doctor.password = "";
    if (values.pharmacist) values.pharmacist.password = "";
  }
  values = null;
  if (client) await client.auth.signOut({ scope: "local" }).catch(() => {});
}
