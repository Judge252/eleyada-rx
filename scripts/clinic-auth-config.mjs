// Narrow operator tooling. Uses the existing CLI credential store; never reads/prints credentials.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const run = promisify(execFile),
  project = "fckdsiozmufyhbnignet",
  root = resolve(".local/clinic-auth-config");
if ((await readFile("supabase/.temp/project-ref", "utf8")).trim() !== project)
  throw Error("TARGET_MISMATCH");
await mkdir(root + "/supabase/templates", { recursive: true });
await writeFile(
  root + "/supabase/templates/magic-link.html",
  await readFile("supabase/templates/magic-link.html", "utf8"),
);
await writeFile(
  root + "/supabase/config.toml",
  `project_id="clinic-rx"\n[auth]\nenable_signup=false\n[auth.email]\nenable_signup=false\nenable_confirmations=true\n[auth.email.template.magic_link]\nsubject="Clinic RX — קוד כניסה / Sign-in code"\ncontent_path="./supabase/templates/magic-link.html"\n`,
);
const args = (command) => [
  "node_modules/supabase/dist/supabase.js",
  "config",
  command,
  "--project-ref",
  project,
  "--workdir",
  root,
  "--output-format",
  "json",
];
async function cli(command, extra = []) {
  try {
    const result = await run(process.execPath, [...args(command), ...extra], {
      windowsHide: true,
      maxBuffer: 2000000,
    });
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw Error("CLI_RESPONSE_NOT_JSON");
    }
  } catch (error) {
    let message = "";
    try {
      message = JSON.parse(error.stdout).error?.message ?? "";
    } catch {
      /* Never print provider output or configuration values. */
    }
    if (
      message.includes(
        "Email template modification is not available for free tier projects using the default email provider",
      )
    )
      throw Error(
        "AUTH_TEMPLATE_REQUIRES_CUSTOM_SMTP; no settings changed; no upgrade attempted",
      );
    throw Error("AUTH_CONFIG_OPERATION_FAILED_DETAILS_SUPPRESSED");
  }
}
const preview = await cli("diff");
const permitted =
  /^auth\.(enable_signup|email\.(enable_signup|enable_confirmations|template\.magic_link\.(subject|content_path|content)))$/;
const declared = preview.changes.filter((c) => c.declared);
for (const c of declared)
  if (!permitted.test(c.path.join(".")))
    throw Error("UNEXPECTED_CONFIG_FIELD_" + c.path.join("."));
console.log(
  JSON.stringify({
    target: project,
    changedFields: declared.map((c) => c.path.join(".")),
    templateIncludesToken: (
      await readFile("supabase/templates/magic-link.html", "utf8")
    ).includes("{{ .Token }}"),
    applied: false,
  }),
);
if (process.argv.includes("--apply")) {
  const applied = await cli("push", ["--yes"]);
  const after = await cli("diff");
  if (after.changes.filter((c) => c.declared).length)
    throw Error("AUTH_CONFIG_RECHECK_FAILED");
  console.log(
    JSON.stringify({
      target: project,
      applied: true,
      remainingDifferences: after.changes.filter((c) => c.declared).length,
      status: applied.message ? "completed" : "verified",
    }),
  );
}
