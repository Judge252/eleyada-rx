// Bounded private operator input. No prompt values or input are echoed/logged.
import { RecoveryError, requireSafe } from "./recovery-archive.mjs";
export async function readPrivateInput({
  input = process.stdin,
  signal,
  maxBytes = 32768,
} = {}) {
  requireSafe(maxBytes > 0 && maxBytes <= 32768, "PRIVATE_INPUT_LIMIT");
  const storage = Buffer.alloc(maxBytes);
  let size = 0;
  try {
    return await new Promise((resolve, reject) => {
      const raw = Boolean(input.isTTY);
      const priorRaw = Boolean(input.isRaw);
      const finish = (error) => {
        input.off("data", receive);
        input.off("end", closed);
        input.off("error", closed);
        signal?.removeEventListener("abort", aborted);
        if (raw) input.setRawMode(priorRaw);
        input.pause();
        if (error) reject(new RecoveryError(error));
        else resolve(storage.subarray(0, size).toString("utf8"));
      };
      const aborted = () => finish("PRIVATE_INPUT_INTERRUPTED");
      const closed = () => finish("PRIVATE_INPUT_CLOSED");
      const receive = (chunk) => {
        for (const byte of chunk) {
          if (byte === 3) {
            finish("PRIVATE_INPUT_INTERRUPTED");
            return;
          }
          if (byte === 10 || byte === 13) {
            finish();
            return;
          }
          if (raw && (byte === 8 || byte === 127)) {
            if (size) {
              size--;
              while (size > 0 && (storage[size] & 0xc0) === 0x80) size--;
            }
            continue;
          }
          if (size === maxBytes) {
            finish("PRIVATE_INPUT_LIMIT");
            return;
          }
          storage[size++] = byte;
        }
      };
      if (signal?.aborted) {
        finish("PRIVATE_INPUT_INTERRUPTED");
        return;
      }
      if (raw) input.setRawMode(true);
      input.on("data", receive);
      input.once("end", closed);
      input.once("error", closed);
      signal?.addEventListener("abort", aborted, { once: true });
      input.resume();
    });
  } finally {
    storage.fill(0);
  }
}
