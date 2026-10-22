import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createArchive, readArchive } from "../scripts/recovery-archive.mjs";
import { readPrivateInput } from "../scripts/recovery-input.mjs";

test("AEAD frames use fresh salt/nonces; reject reordered, repeated and altered frames without plaintext artifacts", async () => {
  const folder = await mkdtemp(resolve(".local/archive-test-")),
    pass = randomBytes(32).toString("hex"),
    value = randomBytes(32).toString("hex");
  try {
    const a = join(folder, "a.enc"),
      b = join(folder, "b.enc");
    for (const path of [a, b]) {
      const w = await createArchive(path, pass);
      await w.write({ kind: "sample", value });
      await w.write({ kind: "end" });
      await w.seal();
      await w.publish();
    }
    const bytes = await readFile(a),
      other = await readFile(b);
    assert.ok(!bytes.equals(other), "Distinct encrypted output");
    assert.ok(!bytes.includes(Buffer.from(value)), "No plaintext bytes");
    let read;
    for await (const r of readArchive(a, pass))
      if (r.kind === "sample") read = r.value;
    assert.ok(read === value, "Authenticated plaintext equality");
    const header = 12 + bytes.readUInt32BE(8),
      size = bytes.readUInt32BE(header) + 20,
      one = bytes.subarray(header, header + size),
      two = bytes.subarray(header + size);
    for (const data of [
      Buffer.concat([bytes.subarray(0, header), two, one]),
      Buffer.concat([bytes.subarray(0, header), one, one]),
      (() => {
        const changed = Buffer.from(bytes);
        changed[20] ^= 1;
        return changed;
      })(),
    ]) {
      const path = join(folder, "bad.enc");
      await writeFile(path, data);
      await assert.rejects(
        async () => {
          for await (const r of readArchive(path, pass)) void r;
        },
        (e) => typeof e.code === "string",
      );
    }
    assert.ok((await readdir(folder)).every((name) => name.endsWith(".enc")));
  } finally {
    assert.equal(dirname(folder), resolve(".local"));
    await rm(folder, { recursive: true, force: true });
  }
});
test("private input is bounded and closed input rejects", async () => {
  const input = new PassThrough();
  const pending = readPrivateInput({ input, maxBytes: 8 });
  input.end("123456789\n");
  await assert.rejects(pending, (e) => e.code === "PRIVATE_INPUT_LIMIT");
  const closed = new PassThrough();
  const result = readPrivateInput({ input: closed });
  closed.end();
  await assert.rejects(result, (e) => e.code === "PRIVATE_INPUT_CLOSED");
});
test("private TTY restores echo mode on success, cancellation and abort", async () => {
  for (const outcome of ["success", "cancel", "abort"]) {
    const input = new PassThrough(),
      states = [];
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (state) => {
      input.isRaw = state;
      states.push(state);
    };
    const controller = new AbortController();
    const pending = readPrivateInput({ input, signal: controller.signal });
    if (outcome === "success") {
      input.write(Buffer.from("private\n"));
      assert.ok((await pending) === "private");
    } else if (outcome === "cancel") {
      input.write(Buffer.from([3]));
      await assert.rejects(
        pending,
        (e) => e.code === "PRIVATE_INPUT_INTERRUPTED",
      );
    } else {
      controller.abort();
      await assert.rejects(
        pending,
        (e) => e.code === "PRIVATE_INPUT_INTERRUPTED",
      );
    }
    assert.deepEqual(states, [true, false]);
    assert.equal(input.listenerCount("data"), 0);
  }
});
