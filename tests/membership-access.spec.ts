// Opt-in trusted-operator verification. Temporarily deactivate only the approved
// pharmacist/pharmacy, restore in finally, never delete memberships or patient data.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { credentials, uiSignIn } from "./auth-helpers";

const run = promisify(execFile);
async function query(sql: string) {
  const result = await run(process.execPath,["node_modules/supabase/dist/supabase.js","db","query",
    "--linked","--project-ref","fckdsiozmufyhbnignet","--agent","no","--output-format","json",sql]);
  return JSON.parse(result.stdout);
}

test("inactive pharmacist and inactive pharmacy deny real sessions; operator restores both", async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_CHECKS !== "1", "Explicit trusted-operator test opt-in required.");
  test.setTimeout(180_000);
  const result = await query(`select u.id::text,u.pharmacy_id::text,p.name
    from public.app_users u join auth.users a on a.id=u.id
    join public.pharmacies p on p.id=u.pharmacy_id
    where a.email='ahmedhany2522006@gmail.com' and u.role='pharmacist'
      and u.is_active and p.is_active and p.name='Ahmed'`);
  expect(result.length).toBe(1);
  const identity = result[0] as {id:string;pharmacy_id:string};
  expect(/^[0-9a-f-]{36}$/.test(identity.id) && /^[0-9a-f-]{36}$/.test(identity.pharmacy_id)).toBe(true);
  try {
    await uiSignIn(page,"pharmacist");
    await query(`update public.app_users set is_active=false where id='${identity.id}'::uuid and role='pharmacist'`);
    await page.reload();
    await expect(page).toHaveURL(/\/login\?reason=access$/);
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);
    await page.getByLabel("البريد الإلكتروني",{exact:true}).fill(credentials("pharmacist").email);
    await page.getByLabel("كلمة المرور",{exact:true}).fill(credentials("pharmacist").password);
    await page.getByRole("button",{name:"تسجيل الدخول",exact:true}).click();
    await expect(page.locator('.feedback-message[role="alert"]')).toContainText("غير مخوّل");
    await expect(page).toHaveURL(/\/login/);
    await query(`update public.app_users set is_active=true where id='${identity.id}'::uuid and role='pharmacist'`);
    await uiSignIn(page,"pharmacist");
    await query(`update public.pharmacies set is_active=false where id='${identity.pharmacy_id}'::uuid`);
    await page.reload();
    await expect(page).toHaveURL(/\/login\?reason=access$/);
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);
  } finally {
    await query(`do $$ begin
      update public.pharmacies set is_active=true where id='${identity.pharmacy_id}'::uuid;
      update public.app_users set is_active=true where id='${identity.id}'::uuid and role='pharmacist';
      end; $$;`);
    const restored = await query(`select u.is_active as membership_active,p.is_active as pharmacy_active
      from public.app_users u join public.pharmacies p on p.id=u.pharmacy_id where u.id='${identity.id}'::uuid`);
    expect(restored).toEqual([{membership_active:true,pharmacy_active:true}]);
  }
  await page.context().clearCookies();
  await uiSignIn(page,"pharmacist");
  await expect(page.locator(".pharmacy-account strong")).toHaveText("Ahmed");
  await page.getByRole("button",{name:"تسجيل الخروج",exact:true}).click();
  await expect(page).toHaveURL(/\/login\?signedOut=1$/);
});
