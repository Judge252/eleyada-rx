import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabasePublicConfig();
  const client = createServerClient<Database>(url, publishableKey, {
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers ?? {}))
          response.headers.set(name, value);
      },
    },
  });
  try {
    await client.auth.getUser();
  } catch {
    /* Server authorization fails closed. */
  }
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.append("Vary", "Cookie");
  if (
    request.nextUrl.pathname === "/login" &&
    request.nextUrl.searchParams.has("signedOut")
  )
    response.headers.set("Clear-Site-Data", '"cache"');
  return response;
}

export const config = {
  matcher: [
    "/login",
    "/doctor/:path*",
    "/pharmacy/:path*",
    "/api/auth/:path*",
    "/api/doctor/:path*",
    "/api/pharmacy/:path*",
    "/api/experience/:path*",
    "/",
    "/portal",
  ],
};
