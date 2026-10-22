// Trusted operator utility, never imported into the app. No admin key is stored.
// Password is read once from stdin; never put it in arguments, env files or logs.
import { privateLine } from "./private-input.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const project = "fckdsiozmufyhbnignet";
const run = promisify(execFile);
const cli = async (...args) => {
  try {
    return (await run(process.execPath, ["node_modules/supabase/dist/supabase.js", ...args,
      "--agent", "no", "--output-format", "json"], { maxBuffer: 2_000_000 })).stdout;
  } catch { throw new Error("Trusted CLI operation failed; inspect project state before retrying."); }
};
const [email, role, pharmacyName] = process.argv.slice(2);
if (!email || !["doctor", "pharmacist"].includes(role) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (role === "doctor" && email !== "tclinic65@gmail.com") ||
    (role === "pharmacist" && (!pharmacyName?.trim() || pharmacyName.length > 160)))
  throw new Error("Provide the approved email, role, and pharmacist pharmacy name. Doctor identity is fixed.");

console.log("Waiting for password through private stdin; input will not be echoed.");
let password = await privateLine();
if (password.length < 8) throw new Error("Password does not meet the minimum length.");

const metadata = JSON.parse(await cli("projects", "list"));
if (!metadata.projects.some(p => p.ref === project && p.name === "Eleyada RX"))
  throw new Error("Exact project identity was not confirmed.");
const result = JSON.parse(await cli("projects", "api-keys", "--project-ref", project, "--reveal"));
const key = result.keys.find(k => k.type === "secret")?.api_key;
if (!key?.startsWith("sb_secret_")) throw new Error("Temporary admin authorization unavailable.");
const admin = createClient(`https://${project}.supabase.co`, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const settings = await fetch(`https://${project}.supabase.co/auth/v1/settings`, { headers: { apikey: key } });
if (!(await settings.json()).disable_signup) throw new Error("Public signup must remain disabled.");
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw new Error("Cannot inspect existing Auth identities.");
if (listed.data.users.some(u => u.email?.toLowerCase() === email.toLowerCase()))
  throw new Error("Auth identity already exists; do not reset credentials or duplicate it.");
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
password = "";
if (created.error || !created.data.user) throw new Error("Auth user creation failed; no role mapping attempted.");
const user = created.data.user;
if (user.role !== "authenticated" || user.email?.toLowerCase() !== email.toLowerCase())
  throw new Error("Created identity did not match the approved ordinary Auth user.");
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const tag = `$provision_${randomUUID().replaceAll("-", "")}$`;
const sql = `do ${tag} declare pharmacy uuid; begin
  if not exists(select 1 from auth.users where id=${quote(user.id)}::uuid and lower(email)=lower(${quote(email)}))
    then raise exception 'Identity mismatch'; end if;
  ${role === "doctor" ? `insert into public.app_users(id,role) values (${quote(user.id)}::uuid,'doctor');`
    : `if exists(select 1 from public.pharmacies where name=${quote(pharmacyName)}) then
         raise exception 'Pharmacy name already exists; select its reviewed UUID explicitly'; end if;
       insert into public.pharmacies(name) values (${quote(pharmacyName)}) returning id into pharmacy;
       insert into public.app_users(id,role,pharmacy_id) values (${quote(user.id)}::uuid,'pharmacist',pharmacy);`}
end; ${tag};`;
try { await cli("db", "query", "--linked", "--project-ref", project, sql); }
catch { throw new Error("Auth user exists but role mapping failed. Review the unmapped identity in the dashboard; do not recreate it."); }
console.log(`Provisioned approved ${role} account with ordinary authenticated privileges and trusted app_users mapping.`);
