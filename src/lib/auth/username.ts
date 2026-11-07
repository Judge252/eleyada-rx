// Usernames are login identifiers only. They are NOT authorization claims: access is decided by
// app_users / prescribers / clinic_memberships / entitlements in the database on every request.
// Supabase Auth requires an email identity, so a username maps deterministically to a reserved,
// non-deliverable address. There is no username -> email lookup, directory, table or RPC.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const LOGIN_EMAIL_DOMAIN = "prescribers.clinic-rx.invalid";

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(username) ? username : null;
}
export function loginEmail(username: string, domain = LOGIN_EMAIL_DOMAIN) {
  return `${username}@${domain}`;
}
