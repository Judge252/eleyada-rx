import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { accessInput } from "./contracts";

// Dependency-injected for local Auth-boundary tests; never logs provider payloads.
export async function passwordless(
  client: SupabaseClient<Database>,
  input: NonNullable<ReturnType<typeof accessInput>>,
  enabled: boolean,
) {
  if (input.operation !== "onboard" && !enabled)
    return { state: "unavailable" };
  const budget = await client.rpc("request_prescriber_access", {
    p_email: input.email,
    p_operation: input.operation,
    p_name: input.operation === "onboard" ? input.name : "",
    p_clinic: input.operation === "onboard" ? input.clinic : "",
  });
  if (budget.error) return { state: "unavailable" };
  if (input.operation === "onboard") return { state: "accepted" };
  if (input.operation === "challenge") {
    if (budget.data === true)
      await client.auth.signInWithOtp({
        email: input.email,
        options: { shouldCreateUser: false },
      });
    return { state: "accepted" }; // identical for missing, inactive, throttled or provider-denied addresses
  }
  if (budget.data !== true) return { state: "unauthorized" };
  const verified = await client.auth.verifyOtp({
    email: input.email,
    token: input.token!,
    type: "email",
  });
  if (verified.error) return { state: "unauthorized" };
  const user = await client.auth.getUser();
  const session = await client.rpc("has_active_session");
  const context = await client.rpc("get_prescriber_context");
  const data = context.data as { state?: string } | null;
  if (
    user.error ||
    !user.data.user ||
    session.error ||
    session.data !== true ||
    context.error ||
    data?.state !== "verified"
  ) {
    await client.auth.signOut({ scope: "local" });
    return { state: "unauthorized" };
  }
  return { state: "verified", context: context.data };
}
