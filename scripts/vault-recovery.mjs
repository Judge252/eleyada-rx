// Operator tool, NEVER invoked by the app. Export reads a highly privileged secret;
// import changes an empty restore target. Both require separate owner authorization.
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { privateLine } from "./private-input.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const SOURCE = "fckdsiozmufyhbnignet";
const AAD = Buffer.from("al-eyada-rx|vault-root-escrow|1");
export function cliRoot(output) {
  const result = JSON.parse(output);
  const root = result.root_key ?? result.rootKey;
  if (typeof root !== "string" || !/^[a-f0-9]{64}$/i.test(root))
    throw new Error("Unexpected CLI root response");
  return root;
}
function validate(record) {
  if (
    record?.format !== 1 ||
    record.project !== SOURCE ||
    typeof record.root_key !== "string" ||
    !/^[a-f0-9]{64}$/i.test(record.root_key) ||
    !Number.isFinite(Date.parse(record.captured_at))
  )
    throw new Error("Invalid recovery record");
}
function key(pass, salt) {
  if (typeof pass !== "string" || pass.length < 24 || pass.length > 1024)
    throw new Error(
      "Use a separate custodian passphrase of at least 24 characters",
    );
  return scryptSync(pass, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}
export function encryptRecovery(record, pass) {
  validate(record);
  const salt = randomBytes(32),
    iv = randomBytes(12),
    derived = key(pass, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", derived, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(record), "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      format: 1,
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      ciphertext: ciphertext.toString("hex"),
    });
  } finally {
    derived.fill(0);
  }
}
export function decryptRecovery(envelope, pass) {
  const e = JSON.parse(envelope);
  if (
    e.format !== 1 ||
    !/^[a-f0-9]{64}$/.test(e.salt) ||
    !/^[a-f0-9]{24}$/.test(e.iv) ||
    !/^[a-f0-9]{32}$/.test(e.tag) ||
    typeof e.ciphertext !== "string" ||
    e.ciphertext.length > 3000 ||
    !/^(?:[a-f0-9]{2})+$/.test(e.ciphertext)
  )
    throw new Error("Invalid encrypted envelope");
  const derived = key(pass, Buffer.from(e.salt, "hex"));
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derived,
      Buffer.from(e.iv, "hex"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(e.tag, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(e.ciphertext, "hex")),
      decipher.final(),
    ]);
    try {
      const record = JSON.parse(plaintext.toString("utf8"));
      validate(record);
      return record;
    } finally {
      plaintext.fill(0);
    }
  } finally {
    derived.fill(0);
  }
}
async function api(path, token, method = "GET", body) {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Provider operation failed");
  return res.json();
}
async function main() {
  const [mode, file, target] = process.argv.slice(2);
  if (
    !["export", "export-cli", "import"].includes(mode) ||
    !file ||
    !isAbsolute(file)
  )
    throw new Error(
      "Use export-cli <absolute encrypted backup path>, export <absolute path> or import <absolute path> <approved empty target ref>",
    );
  const path = resolve(file),
    within = relative(process.cwd(), path);
  if (!within.startsWith("..") && !isAbsolute(within))
    throw new Error("Recovery escrow must stay outside this checkout");
  console.log(
    mode === "export-cli"
      ? "Separate export authorization required. Supply private non-echo JSON: passphrase, confirmProject. Existing CLI login is reused; no token entry."
      : "Separate authorization required. Supply private JSON: token, passphrase, confirmProject; import also confirmTarget. Values are never displayed.",
  );
  let input = JSON.parse(await privateLine());
  if (
    input.confirmProject !== SOURCE ||
    (mode !== "export-cli" && (typeof input.token !== "string" || !input.token))
  )
    throw new Error("Exact source confirmation required");
  if (mode === "export" || mode === "export-cli") {
    // Refuse overwrite before acquiring the root key.
    if (
      await stat(path).then(
        () => true,
        () => false,
      )
    )
      throw new Error("Backup path already exists");
    key(input.passphrase, Buffer.alloc(32)).fill(0);
    // Export is approval-gated; stdout remains in memory and is never forwarded.
    // No token/key is placed in child arguments. Tests never call this command.
    const body =
      mode === "export-cli"
        ? {
            root_key: cliRoot(
              (
                await promisify(execFile)(
                  process.execPath,
                  [
                    "node_modules/supabase/dist/supabase.js",
                    "encryption",
                    "get-root-key",
                    "--project-ref",
                    SOURCE,
                    "--output",
                    "json",
                  ],
                  { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true },
                )
              ).stdout,
            ),
          }
        : await api(`/projects/${SOURCE}/pgsodium`, input.token);
    const record = {
      format: 1,
      project: SOURCE,
      captured_at: new Date().toISOString(),
      root_key: body.root_key,
    };
    await writeFile(path, encryptRecovery(record, input.passphrase), {
      flag: "wx",
      mode: 0o600,
    });
    body.root_key = null;
    record.root_key = null;
    console.log(
      "Encrypted root escrow written. A consistent encrypted database backup and restore drill are also required.",
    );
  } else {
    if (
      !/^[a-z]{20}$/.test(target ?? "") ||
      target === SOURCE ||
      input.confirmTarget !== target
    )
      throw new Error(
        "Distinct explicitly approved empty restore target required",
      );
    if ((await stat(path)).size > 4096)
      throw new Error("Invalid envelope size");
    const record = decryptRecovery(
      await readFile(path, "utf8"),
      input.passphrase,
    );
    // Import BEFORE restoring the dump. Never replace the key of an occupied target.
    const rows = await api(
      `/projects/${target}/database/query`,
      input.token,
      "POST",
      {
        query: "select count(*)::int as count from vault.secrets",
        read_only: true,
      },
    );
    if (!Array.isArray(rows) || rows[0]?.count !== 0)
      throw new Error("Restore target Vault must be empty");
    await api(`/projects/${target}/pgsodium`, input.token, "PUT", {
      root_key: record.root_key,
    });
    record.root_key = null;
    console.log(
      "Root copied to approved empty restore target. Restore the matching database backup, then verify decryption/receipt integrity before use.",
    );
  }
  input = null;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch {
    console.error(
      "Recovery operation failed safely. No secret values were logged. Do not retry import until the target state is inspected.",
    );
    process.exitCode = 1;
  }
}
