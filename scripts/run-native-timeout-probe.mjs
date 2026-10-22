// One approved ordinary-user RPC; credentials are private stdin and memory only.
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readPrivateInput } from "./recovery-input.mjs";
const SOURCE = "fckdsiozmufyhbnignet";
export function timeoutPassed(result, elapsedMs) {
  return (
    result.status >= 400 && result.error?.code === "57014" && elapsedMs < 3000
  );
}
async function main() {
  if (
    await lstat(".local/phase4b-native-timeout-result.json").then(
      () => true,
      () => false,
    )
  )
    throw new Error("PREVIOUS_PROBE_RESULT_EXISTS_INSPECT_DO_NOT_REPEAT");
  nextEnv.loadEnvConfig(process.cwd());
  if (
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
    `${SOURCE}.supabase.co`
  )
    throw new Error("SOURCE_MISMATCH");
  const client = createClient(
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
          fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    },
  );
  let credentials,
    loggedIn = false;
  try {
    console.log(
      "Approved source timeout probe only. No draft/issuance/key/export operations.",
    );
    console.log("Enter doctor email privately, then press Enter:");
    const email = await readPrivateInput();
    console.log(
      "Enter doctor password privately, then press Enter. No characters will appear:",
    );
    credentials = { email, password: await readPrivateInput() };
    const login = await client.auth.signInWithPassword(credentials);
    credentials.password = "";
    credentials = null;
    if (login.error) throw new Error("PRIVATE_SIGN_IN_FAILED");
    loggedIn = true;
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user)
      throw new Error("VERIFIED_USER_REQUIRED");
    const member = await client
      .from("app_users")
      .select("id,role,is_active")
      .single();
    if (
      member.error ||
      member.data.id !== verified.data.user.id ||
      member.data.role !== "doctor" ||
      !member.data.is_active
    )
      throw new Error("ACTIVE_DOCTOR_REQUIRED");
    const session = await client.rpc("has_active_session");
    if (session.error || session.data !== true)
      throw new Error("LIVE_SESSION_REQUIRED");
    // Exactly one bounded attempt. A client abort is a failure, never success evidence.
    const started = performance.now();
    const result = await client
      .rpc("phase4b_deadline_probe")
      .abortSignal(AbortSignal.timeout(3000));
    const elapsedMs = Math.round(performance.now() - started);
    const output = {
      project: SOURCE,
      passed: timeoutPassed(result, elapsedMs),
      httpStatus: result.status,
      sqlstate: result.error?.code ?? null,
      elapsedMs,
      attempts: 1,
      independentInspectionPending: true,
    };
    await writeFile(
      ".local/phase4b-native-timeout-result.json",
      JSON.stringify(output, null, 2),
      { flag: "wx" },
    );
    console.log(JSON.stringify(output));
    if (!output.passed)
      throw new Error("PROBE_DID_NOT_PROVE_TIMEOUT_STOP_INSPECT_DO_NOT_RETRY");
  } finally {
    credentials = null;
    if (loggedIn) await client.auth.signOut({ scope: "local" }).catch(() => {});
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch {
    console.error(
      "PROBE_STOPPED: independent database inspection required; no automatic retry. No secret values logged.",
    );
    process.exitCode = 1;
  }
}
