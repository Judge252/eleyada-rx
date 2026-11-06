import { createServerClient } from "@supabase/ssr";
import { loadEnvConfig } from "@next/env";
import { expect, type Page } from "@playwright/test";

loadEnvConfig(process.cwd());
export const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.any([
      AbortSignal.timeout(10_000),
      ...(init?.signal ? [init.signal] : []),
    ]),
  });
export function credentials(role: "doctor" | "pharmacist") {
  const prefix = role === "doctor" ? "E2E_DOCTOR" : "E2E_PHARMACIST";
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password)
    throw new Error(
      `Approved ${role} test credentials are missing from process memory.`,
    );
  return { email, password };
}

export async function uiSignIn(page: Page, role: "doctor" | "pharmacist") {
  await page.goto("/login");
  const values = credentials(role);
  await page
    .getByLabel("البريد الإلكتروني", { exact: true })
    .fill(values.email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(values.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(page).toHaveURL(role === "doctor" ? /\/$/ : /\/portal$/, {
    timeout: 20_000,
  });
}

// Real GoTrue sign-in and SSR-issued cookies, never a production auth bypass.
// Used only to retain the existing mock workflow regression checks behind auth.
export async function visit(page: Page, path: string) {
  const role = path.startsWith("/doctor")
    ? "doctor"
    : path.startsWith("/pharmacy")
      ? "pharmacist"
      : null;
  if (role) {
    const current = await page.request.get("/api/auth/session");
    const sameRole = current.ok() && (await current.json()).role === role;
    if (!sameRole) {
      await page.context().clearCookies();
      const client = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
          global: { fetch: boundedFetch },
          cookieOptions: {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
          },
          cookies: {
            getAll: () => [],
            setAll: async (cookies) => {
              await page.context().addCookies(
                cookies
                  .filter((c) => c.value)
                  .map((c) => ({
                    name: c.name,
                    value: c.value,
                    url: "http://127.0.0.1:3107",
                    httpOnly: true,
                    secure: true,
                    sameSite: "Lax" as const,
                  })),
              );
            },
          },
        },
      );
      const { error } = await client.auth.signInWithPassword(credentials(role));
      if (error)
        throw new Error(
          "Real hosted test sign-in failed; no credentials were logged.",
        );
    }
  }
  return page.goto(path);
}
