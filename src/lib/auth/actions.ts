"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccount } from "./server";
import { roleHome } from "./access";

export type AuthState = { message: string; errors?: Record<string, string> };

export async function signIn(_previous: AuthState, values: FormData): Promise<AuthState> {
  const email = String(values.get("email") ?? "").trim();
  const password = String(values.get("password") ?? "");
  const errors: Record<string, string> = {};
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "أدخل بريدًا إلكترونيًا بصيغة صحيحة.";
  if (!password || password.length > 1024) errors.password = "أدخل كلمة المرور.";
  if (Object.keys(errors).length) return { message: "", errors };
  try {
    const client = await createServerSupabaseClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { message: error.status === 429
      ? "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة."
      : "تعذّر تسجيل الدخول. تحقق من بياناتك أو تواصل مع مسؤول العيادة." };
  } catch {
    return { message: "تعذّر الاتصال بخدمة الدخول. أعد المحاولة لاحقًا." };
  }
  const account = await getAccount();
  if (!account) {
    const client = await createServerSupabaseClient();
    await client.auth.signOut({ scope: "local" });
    return { message: "هذا الحساب غير مخوّل للدخول أو غير نشط. تواصل مع مسؤول العيادة." };
  }
  revalidatePath("/", "layout");
  // Destination comes only from the server-authorized membership, never a URL/form.
  redirect(roleHome(account.role));
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
