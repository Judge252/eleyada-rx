// Operator-only bounded, framed AEAD archive. Never imported by application code.
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  createHash,
  randomUUID,
} from "node:crypto";
import { open, link, unlink, lstat } from "node:fs/promises";
export const MAX_FRAME = 1024 * 1024;
const MAGIC = Buffer.from("RXBACK01");
const LIMIT = 1000000;
const KDF = { name: "scrypt", N: 32768, r: 8, p: 1, length: 32 };
export class RecoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = "RecoveryError";
    this.code = code;
  }
}
export function requireSafe(ok, code) {
  if (!ok) throw new RecoveryError(code);
}
function derive(pass, salt) {
  requireSafe(
    typeof pass === "string" && pass.length >= 24 && pass.length <= 1024,
    "PASSPHRASE_POLICY",
  );
  return scryptSync(pass, salt, 32, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: 64 * 1024 * 1024,
  });
}
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
async function writeAll(file, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(
      buffer,
      offset,
      buffer.length - offset,
    );
    requireSafe(bytesWritten > 0, "ARCHIVE_WRITE");
    offset += bytesWritten;
  }
}
async function exact(file, length, allowEOF = false) {
  const b = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(b, offset, length - offset);
    if (!bytesRead && allowEOF && offset === 0) return null;
    requireSafe(bytesRead > 0, "ARCHIVE_TRUNCATED");
    offset += bytesRead;
  }
  return b;
}
export async function createArchive(path, pass) {
  requireSafe(
    !(await lstat(path).then(
      () => true,
      () => false,
    )),
    "ARCHIVE_ALREADY_EXISTS",
  );
  const salt = randomBytes(32),
    prefix = randomBytes(8);
  const header = Buffer.from(
    JSON.stringify({
      format: 1,
      kdf: KDF,
      salt: salt.toString("hex"),
      noncePrefix: prefix.toString("hex"),
    }),
  );
  const aad = Buffer.concat([MAGIC, u32(header.length), header]);
  const key = derive(pass, salt),
    pending = `${path}.incomplete-${randomUUID()}`;
  let file,
    index = 0,
    previous = Buffer.alloc(16),
    sealed = false,
    published = false;
  try {
    file = await open(pending, "wx", 0o600);
    await writeAll(file, aad);
  } catch {
    key.fill(0);
    if (file) {
      await file.close();
      await unlink(pending).catch(() => {});
    }
    throw new RecoveryError("ARCHIVE_CREATE");
  }
  return {
    pending,
    async write(record) {
      requireSafe(!sealed && index < LIMIT, "ARCHIVE_FRAME_LIMIT");
      const plain = Buffer.from(JSON.stringify(record));
      try {
        requireSafe(
          plain.length > 0 && plain.length <= MAX_FRAME,
          "ARCHIVE_FRAME_SIZE",
        );
        const size = u32(plain.length),
          counter = u32(index++),
          nonce = Buffer.concat([prefix, counter]);
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(Buffer.concat([aad, counter, size, previous]));
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
        previous = cipher.getAuthTag();
        await writeAll(file, Buffer.concat([size, encrypted, previous]));
      } finally {
        plain.fill(0);
      }
    },
    async seal() {
      requireSafe(!sealed, "ARCHIVE_STATE");
      await file.sync();
      await file.close();
      sealed = true;
      key.fill(0);
    },
    async publish() {
      requireSafe(sealed && !published, "ARCHIVE_STATE");
      try {
        await link(pending, path);
        published = true;
        await unlink(pending);
      } catch {
        throw new RecoveryError("ARCHIVE_PUBLISH");
      }
    },
    async abort({ retain = false } = {}) {
      key.fill(0);
      if (!sealed) {
        await file.close().catch(() => {});
        sealed = true;
      }
      if (!retain && !published) await unlink(pending).catch(() => {});
    },
  };
}
export async function* readArchive(path, pass, { signal } = {}) {
  let file, key;
  try {
    file = await open(path, "r");
    const magic = await exact(file, 8),
      len = await exact(file, 4);
    requireSafe(
      magic.equals(MAGIC) && len.readUInt32BE() <= 2048,
      "ARCHIVE_HEADER",
    );
    const header = await exact(file, len.readUInt32BE());
    const h = JSON.parse(header.toString("utf8"));
    requireSafe(
      h.format === 1 &&
        JSON.stringify(h.kdf) === JSON.stringify(KDF) &&
        /^[a-f0-9]{64}$/.test(h.salt) &&
        /^[a-f0-9]{16}$/.test(h.noncePrefix),
      "ARCHIVE_HEADER",
    );
    key = derive(pass, Buffer.from(h.salt, "hex"));
    const aad = Buffer.concat([magic, len, header]),
      prefix = Buffer.from(h.noncePrefix, "hex");
    let index = 0,
      previous = Buffer.alloc(16);
    while (true) {
      requireSafe(!signal?.aborted, "INTERRUPTED");
      const size = await exact(file, 4, true);
      if (!size) break;
      const length = size.readUInt32BE();
      requireSafe(
        length > 0 && length <= MAX_FRAME && index < LIMIT,
        "ARCHIVE_FRAME_SIZE",
      );
      const encrypted = await exact(file, length),
        tag = await exact(file, 16),
        counter = u32(index++);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.concat([prefix, counter]),
      );
      decipher.setAAD(Buffer.concat([aad, counter, size, previous]));
      decipher.setAuthTag(tag);
      // A chunk is yielded only after its authentication tag has verified.
      const first = decipher.update(encrypted);
      let final, plain;
      try {
        final = decipher.final();
        plain = Buffer.concat([first, final]);
        const record = JSON.parse(plain.toString("utf8"));
        yield record;
      } finally {
        first.fill(0);
        final?.fill(0);
        plain?.fill(0);
      }
      previous = tag;
    }
  } catch (e) {
    if (e instanceof RecoveryError) throw e;
    throw new RecoveryError("ARCHIVE_AUTHENTICATION_OR_FORMAT");
  } finally {
    key?.fill(0);
    await file?.close().catch(() => {});
  }
}
export function recordHash() {
  const hash = createHash("sha256");
  return {
    add(record) {
      hash.update(JSON.stringify(record));
      hash.update("\n");
    },
    digest() {
      return hash.digest("hex");
    },
  };
}
