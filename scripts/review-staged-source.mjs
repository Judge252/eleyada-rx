// Read the Git index, never environment/session files. Report paths/rule names only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 20000000, windowsHide: true });
const paths = git("diff", "--cached", "--name-only", "--diff-filter=ACM", "-z")
  .toString()
  .split("\0")
  .filter(Boolean);
const forbidden =
  /(^|\/)(node_modules|\.next|\.local|\.vercel|test-results|playwright-report|blob-report|downloads|pgdata|postgres-data)(\/|$)|(^|\/)\.env(?!\.example$)|\.(log|har|trace|pdf|dump|backup|exe|zip|pem|key|p12|pfx)$|(^|\/)(credentials|auth-state|session-state).*\.json$/i;
const patterns = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["managed_key", /(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]{25,}/],
  ["github_token", /gh[pousr]_[A-Za-z0-9]{25,}/],
  ["jwt", /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
  [
    "prescription_reference",
    /RX1-?K1-?[0123456789ABCDEFGHJKMNPQRSTVWXYZ-]{32,}/,
  ],
  [
    "literal_credential",
    /(?<![.\w])(?:password|passphrase|access_token|refresh_token|service_role_key)\s*(?:=|:)\s*["'][^"'\r\n]{8,}["']/i,
  ],
];
const findings = [];
for (const path of paths) {
  if (forbidden.test(path)) findings.push({ path, rule: "forbidden_artifact" });
  const body = git("show", `:${path}`);
  if (path.endsWith(".png")) continue;
  for (const [rule, pattern] of patterns)
    if (pattern.test(body.toString("utf8"))) findings.push({ path, rule });
  if (
    path.startsWith("supabase/migrations/") ||
    path.startsWith("supabase/operations/")
  ) {
    const hash = (b) => createHash("sha256").update(b).digest("hex");
    if (hash(body) !== hash(readFileSync(path)))
      findings.push({ path, rule: "reviewed_sql_bytes_changed_in_index" });
  }
  if (path === ".env.example")
    for (const line of body.toString().split(/\r?\n/))
      if (
        /^[A-Z_]+=/.test(line) &&
        line.split("=").slice(1).join("=").trim() !== ""
      )
        findings.push({ path, rule: "nonempty_environment_example" });
}
if (findings.length) {
  console.error(
    JSON.stringify({ status: "REVIEW_REQUIRED", findings }, null, 2),
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      status: "PASS",
      reviewed_files: paths.length,
      forbidden_artifacts: 0,
      credential_reference_patterns: 0,
      reviewed_SQL_bytes_match: true,
    }),
  );
