import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { roleHome, validMembership, type Account, type AppRole } from "./access";

// React.cache deduplicates within one request only. Never cache identity across users.
export const getAccount = cache(async (): Promise<Account | null> => {
  const client = await createServerSupabaseClient();
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return null;
    const session = await client.rpc("has_active_session");
    if (session.error || session.data !== true) return null;
    const { data: member, error: memberError } = await client.from("app_users")
      .select("id, role, pharmacy_id, is_active").eq("id", user.id).maybeSingle();
    if (memberError || !validMembership(member)) return null;
    let pharmacy: Account["pharmacy"] = null;
    if (member.role === "pharmacist") {
      const result = await client.from("pharmacies").select("id, name")
        .eq("id", member.pharmacy_id!).eq("is_active", true).maybeSingle();
      if (result.error || !result.data) return null;
      pharmacy = result.data;
    }
    return { id: user.id, email: user.email ?? "", role: member.role, pharmacy };
  } catch {
    // Provider outages and invalid sessions fail closed without logging tokens.
    return null;
  }
});

export async function requireRole(role: AppRole) {
  const account = await getAccount();
  if (!account) redirect("/login?reason=access");
  if (account.role !== role) redirect(roleHome(account.role));
  return account;
}
