import { expect, test } from "@playwright/test";
import { credentials, uiSignIn } from "./auth-helpers";
import { createClient } from "@supabase/supabase-js";

test("unauthenticated direct pages, nested routes and session API fail closed", async ({ page, request }) => {
  for (const path of ["/doctor", "/doctor/prescriptions/new", "/doctor/prescriptions/rx-001", "/pharmacy"]) {
    const response = await page.goto(path);
    await expect(page).toHaveURL(/\/login\?reason=access$/);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator(".workspace")).toHaveCount(0);
  }
  const session = await request.get("/api/auth/session");
  expect(session.status()).toBe(401);
});

test("incorrect credentials rejected with a safe error and no redirect", async ({ page }) => {
  await page.goto("/login?next=https://example.org");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(credentials("doctor").email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill("intentionally-invalid-test-value");
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(page.locator('.feedback-message[role="alert"]')).toContainText("تعذّر تسجيل الدخول");
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/auth/session")).status()).toBe(401);
});

for (const role of ["doctor", "pharmacist"] as const) {
  test(`${role}: real UI sign-in, role isolation, refresh, cookie security and sign-out replay rejection`, async ({ page, browser }) => {
    test.setTimeout(90_000);
    await uiSignIn(page,role);
    await expect(page.locator(".account")).toContainText(credentials(role).email);
    if (role === "pharmacist") await expect(page.locator(".pharmacy-account strong")).toHaveText("Ahmed");
    const home = role === "doctor" ? "/doctor" : "/pharmacy";
    const denied = role === "doctor" ? ["/pharmacy"] : ["/doctor", "/doctor/prescriptions/new", "/doctor/prescriptions/rx-001"];
    for (const path of denied) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${home}$`));
    }
    const response = await page.reload();
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator(".workspace")).toBeVisible();
    const cookies = (await page.context().cookies()).filter(c => c.name.startsWith("sb-"));
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
    }
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator(".workspace")).toHaveCount(0);
    // Replaying the old, still cryptographically valid cookie must also fail.
    const replay = await browser.newContext();
    try {
      await replay.addCookies(cookies);
      const stolen = await replay.newPage();
      await stolen.goto(home);
      await expect(stolen).toHaveURL(/\/login/);
      expect((await replay.request.get("http://127.0.0.1:3107/api/auth/session")).status()).toBe(401);
    } finally { await replay.close(); }
  });
}

test("malformed cookies cannot impersonate a doctor", async ({ page }) => {
  await page.context().addCookies([{ name:"sb-fckdsiozmufyhbnignet-auth-token",value:"base64-invalid",url:"http://127.0.0.1:3107" }]);
  await page.goto("/doctor");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator(".workspace")).toHaveCount(0);
});

test("expired stored session metadata triggers real refresh and persists fresh HttpOnly cookies", async ({ page }) => {
  await uiSignIn(page,"doctor");
  const cookies = (await page.context().cookies())
    .filter(c => /^sb-fckdsiozmufyhbnignet-auth-token(?:\.\d+)?$/.test(c.name))
    .sort((a,b) => a.name.localeCompare(b.name,undefined,{numeric:true}));
  const encoded = cookies.map(c => c.value).join("");
  expect(encoded.startsWith("base64-")).toBe(true);
  const oldSession = JSON.parse(Buffer.from(encoded.slice(7),"base64url").toString("utf8"));
  // Keep the real signed tokens; age only SDK storage metadata to exercise refresh.
  const aged = { ...oldSession, expires_at: Math.floor(Date.now()/1000)-3600 };
  const agedValue = `base64-${Buffer.from(JSON.stringify(aged)).toString("base64url")}`;
  let position = 0;
  const modified = cookies.map((cookie,index) => {
    const value = index === cookies.length-1 ? agedValue.slice(position) : agedValue.slice(position,position+cookie.value.length);
    position += value.length;
    return { ...cookie, value };
  });
  await page.context().addCookies(modified);
  const response = await page.reload();
  await expect(page).toHaveURL(/\/doctor$/);
  await expect(page.locator(".workspace")).toBeVisible();
  expect(response?.headers()["cache-control"]).toContain("no-store");
  const refreshed = (await page.context().cookies())
    .filter(c => /^sb-fckdsiozmufyhbnignet-auth-token(?:\.\d+)?$/.test(c.name))
    .sort((a,b) => a.name.localeCompare(b.name,undefined,{numeric:true}));
  const newSession = JSON.parse(Buffer.from(refreshed.map(c => c.value).join("").slice(7),"base64url").toString("utf8"));
  // Compare booleans so a failed assertion can never print either token.
  expect(newSession.refresh_token !== oldSession.refresh_token).toBe(true);
  expect(newSession.expires_at > Math.floor(Date.now()/1000)).toBe(true);
  expect(refreshed.every(c => c.httpOnly && c.secure)).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/\/doctor$/);
  await page.getByRole("button", {name:"تسجيل الخروج",exact:true}).click();
  await expect(page).toHaveURL(/\/login\?signedOut=1$/);
});

test("signed pharmacist API cannot read clinical tables or change role/membership", async () => {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const login = await client.auth.signInWithPassword(credentials("pharmacist"));
  expect(login.error === null).toBe(true);
  try {
    for (const table of ["patients","prescriptions","prescription_items","dispensations"]) {
      const result = await client.from(table).select("id");
      expect(result.error === null).toBe(true);
      expect(result.data).toEqual([]);
    }
    const own = await client.from("app_users").select("id,role,pharmacy_id");
    expect(own.data?.length).toBe(1);
    for (const values of [{role:"doctor",pharmacy_id:null},{is_active:false},{pharmacy_id:crypto.randomUUID()}]) {
      const denied = await client.from("app_users").update(values).eq("id",login.data.user!.id);
      expect(denied.error?.code).toBe("42501");
    }
  } finally { await client.auth.signOut({scope:"local"}); }
});
