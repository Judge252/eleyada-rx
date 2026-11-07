"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccount } from "./server";
import { loginEmail, normalizeUsername } from "./username";
import { signInErrorMessage, signInUnavailable } from "./sign-in-errors";

export type AuthState = { message: string; errors?: Record<string, string> };

const genericFailure =
  "تعذّر تسجيل الدخول. تحقق من بياناتك أو تواصل مع مسؤول العيادة.";

// Username + password sign-in for prescribers. Supabase Auth verifies the credential; every failure
// (unknown user, wrong password, non-prescriber, inactive, unapproved) returns the same generic message.
export async function signIn(_previous: AuthState, values: FormData): Promise<AuthState> {
  const username = normalizeUsername(values.get("username"));
  const password = String(values.get("password") ?? "");
  if (!password || password.length > 1024) return { message: genericFailure };
  try {
    const client = await createServerSupabaseClient();
    const forwarded = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim();
    const bucket = createHash("sha256").update("clinic-rx|client|" + (forwarded || "unknown")).digest("hex");
    // Persistent budget is consumed before any credential check, valid username or not.
    const budget = await client.rpc("consume_login_attempt", {
      p_username: username ?? "",
      p_client: bucket,
    });
    if (budget.error) return { message: signInUnavailable };
    if (budget.data !== true && username) return { message: "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة." };
    if (!username || budget.data !== true) return { message: genericFailure };
    const { error } = await client.auth.signInWithPassword({
      email: loginEmail(username, process.env.RX_LOGIN_EMAIL_DOMAIN || undefined),
      password,
    });
    if (error) return { message: signInErrorMessage(error) };
  } catch {
    return { message: signInUnavailable };
  }
  const account = await getAccount();
  if (!account || account.role !== "doctor") {
    const client = await createServerSupabaseClient();
    await client.auth.signOut({ scope: "local" });
    return { message: genericFailure };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut(_previous: AuthState): Promise<AuthState> {
  void _previous;
  try {
    const client = await createServerSupabaseClient();
    const { error } = await client.auth.signOut({ scope: "global" });
    if (error) return { message: "تعذّر إنهاء الجلسة. أعد المحاولة." };
  } catch {
    return { message: "تعذّر الاتصال لإنهاء الجلسة. أعد المحاولة." };
  }
  revalidatePath("/", "layout");
  redirect("/login?signedOut=1");
}
