import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

// User-scoped only. Proxy refreshes cookies before Server Components run.
export async function createServerSupabaseClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, publishableKey, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Read-only Server Component; the proxy handles refreshed cookies.
        }
      },
    },
  });
}
