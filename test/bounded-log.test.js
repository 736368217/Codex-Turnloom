import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { appendWithRotation, trimLargeFile } = require("../scripts/bounded-log.cjs");

function withTempDir(fn) {
  const dir = mkdtempSync(`${tmpdir()}\\turnloom-log-`);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("appendWithRotation keeps a hard size bound and a fixed number of generations", () => {
  withTempDir((dir) => {
    const file = `${dir}\\watchdog.log`;
    const chunk = "0123456789\n";
    const maxBytes = 128;
    const retain = 2;
    for (let i = 0; i < 100; i += 1) {
      appendWithRotation(file, chunk, { maxBytes, retain });
      assert.ok(statSync(file).size <= maxBytes, `current log exceeded ${maxBytes} bytes`);
    }
    const names = readdirSync(dir).sort();
    assert.deepEqual(names, ["watchdog.log", "watchdog.log.1", "watchdog.log.2"]);
    for (const name of names) {
      assert.ok(statSync(`${dir}\\${name}`).size <= maxBytes);
      assert.ok(readFileSync(`${dir}\\${name}`, "utf8").includes("0123456789"));
    }
  });
});

test("appendWithRotation bounds an oversized record and legacy generations", () => {
  withTempDir((dir) => {
    const file = `${dir}\\watchdog.log`;
    writeFileSync(file, "legacy\n".repeat(200));
    writeFileSync(`${file}.1`, "old-generation\n".repeat(200));
    appendWithRotation(file, "x".repeat(500), { maxBytes: 128, retain: 2 });
    assert.ok(statSync(file).size <= 128);
    for (const name of readdirSync(dir)) {
      assert.ok(statSync(`${dir}\\${name}`).size <= 128, `${name} exceeded the hard bound`);
    }
    assert.equal(readFileSync(file, "utf8"), "x".repeat(128));
  });
});

test("trimLargeFile preserves the newest bytes without renaming an inherited handle", () => {
  withTempDir((dir) => {
    const file = `${dir}\\dispatcher-out.log`;
    const prefix = "X".repeat(4096);
    const tail = "LAST-LINE\n";
    writeFileSync(file, prefix + tail);
    assert.equal(trimLargeFile(file, { maxBytes: 1024, tailBytes: 64 }), true);
    const result = readFileSync(file, "utf8");
    assert.ok(statSync(file).size <= 1024);
    assert.ok(result.endsWith(tail));
    assert.equal(trimLargeFile(file, { maxBytes: 1024, tailBytes: 64 }), false);
    assert.deepEqual(readdirSync(dir), ["dispatcher-out.log"]);
  });
});
