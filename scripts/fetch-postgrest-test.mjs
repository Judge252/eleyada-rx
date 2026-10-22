// Official, pinned test-only Windows binary. No project connection or secrets.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const hash = "f24ca175b34d1ec0f3fc6d4c778f279f70577f6b3784b19aaa321e22bc3959b9";
if (process.platform !== "win32")
  throw new Error("This pinned test helper is Windows only");
const response = await fetch(
  "https://github.com/PostgREST/postgrest/releases/download/v14.18/postgrest-v14.18-windows-x86-64.zip",
  { signal: AbortSignal.timeout(120000) },
);
if (!response.ok) throw new Error("Official test binary download failed");
const data = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(data).digest("hex") !== hash)
  throw new Error("Test binary digest mismatch");
await mkdir(".local/postgrest", { recursive: true });
await writeFile(".local/postgrest/official.zip", data);
execFileSync(
  "tar",
  ["-xf", ".local/postgrest/official.zip", "-C", ".local/postgrest"],
  { windowsHide: true, stdio: "ignore" },
);
console.log(
  "Verified official PostgREST 14.18 test binary installed in ignored .local/postgrest.",
);
