// Approval-gated operator entry point. Arguments contain file paths only.
import { isAbsolute, relative, resolve, dirname } from "node:path";
import { realpath } from "node:fs/promises";
import { readPrivateInput } from "./recovery-input.mjs";
import { fileURLToPath } from "node:url";
import { capture, restore, SOURCE } from "./portable-recovery.mjs";
import { requireSafe, RecoveryError } from "./recovery-archive.mjs";
const [mode, path, receiptPath] = process.argv.slice(2);
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let input;
try {
  requireSafe(
    ["capture", "restore"].includes(mode) && path && isAbsolute(path),
    "USAGE_capture_archive_OR_restore_archive_receipt",
  );
  for (const file of [path, ...(mode === "restore" ? [receiptPath] : [])]) {
    requireSafe(file && isAbsolute(file), "ABSOLUTE_PATH_REQUIRED");
    const parent = await realpath(dirname(file)),
      workspace = await realpath(
        fileURLToPath(new URL("../", import.meta.url)),
      ),
      inside = relative(workspace, resolve(parent, file.split(/[\\/]/).at(-1)));
    requireSafe(
      inside.startsWith("..") || isAbsolute(inside),
      "BACKUPS_MUST_STAY_OUTSIDE_CHECKOUT",
    );
  }
  console.log(
    "Separate export/restore approval required. Enter private JSON locally; never paste it in chat. Fields: connection, passphrase, confirmSource, approvedOperation; restore also target, confirmTarget, isolated, signupDisabled, noAppTraffic, noExternalJobs.",
  );
  input = JSON.parse(await readPrivateInput({ signal: controller.signal }));
  requireSafe(
    input.confirmSource === SOURCE && input.approvedOperation === mode,
    "OPERATOR_CONFIRMATION_REQUIRED",
  );
  const common = {
    connection: input.connection,
    passphrase: input.passphrase,
    path,
    signal: controller.signal,
  };
  let result;
  if (mode === "capture") result = await capture(common);
  else {
    requireSafe(
      input.confirmTarget === input.target &&
        input.signupDisabled === true &&
        input.noAppTraffic === true &&
        input.noExternalJobs === true,
      "RECOVERY_TARGET_ISOLATION_REQUIRED",
    );
    result = await restore({
      ...common,
      target: input.target,
      isolated: input.isolated,
      receiptPath,
      verifyOnly: input.verifyOnly ?? false,
    });
  }
  console.log(JSON.stringify(result));
} catch (e) {
  console.error(
    e instanceof RecoveryError ? e.code : "RECOVERY_FAILED_NO_SECRET_OUTPUT",
  );
  process.exitCode = 1;
} finally {
  input = null;
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
