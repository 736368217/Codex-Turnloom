"use strict";

/**
 * 日志包（2.2.5，task:6cc144c0）：只有 allowlist 字段进包。
 *
 * 判据不是"看起来脱敏了"，而是 Vera 的标记法：在消息、note、stack、detail
 * 里各埋一个 `QA-SECRET-…`，解包后逐文件搜索必须 0 命中；同时 access code /
 * token 也不能出现。反过来，路由、状态码、错误码这些排查必需的字段必须还在。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildLogBundle } = require("../server/log-bundle.cjs");

const SECRET_MARKERS = ["QA-SECRET-1a2b3c", "QA-SECRET-4d5e6f"];
const ACCESS_CODE = "517514";

/** Minimal reader for our store-only zip: walks the central directory. */
function readZip(buffer) {
  const entries = new Map();
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "zip must end with an EOCD record");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "central directory entry");
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.equal(method, 0, "entries are stored, not deflated");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, buffer.subarray(dataStart, dataStart + size).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function seedLogs() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-logs-"));
  fs.mkdirSync(path.join(logDir, "phone"), { recursive: true });
  const serverLines = [
    { ts: "2026-11-19T07:00:00.000Z", source: "server", level: "info", method: "GET", path: "/api/threads", status: 200, ms: 12 },
    { ts: "2026-11-19T07:00:01.000Z", source: "server", level: "error", method: "POST", path: "/api/send", status: 500, ms: 30, note: `send failed for ${SECRET_MARKERS[0]}`, stack: `Error: ${SECRET_MARKERS[0]}\n at send` },
    { ts: "2026-11-19T07:00:02.000Z", source: "server", level: "warn", method: "GET", path: "/api/app/update", status: 404, ms: 2, code: "update-unavailable", note: `token=${ACCESS_CODE}` },
  ];
  fs.writeFileSync(path.join(logDir, "server-20261119.log"), serverLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const phoneLines = [
    { at: "2026-11-19T07:01:00.000Z", kind: "send-failed", path: "/api/send", status: 500, code: "SEND_FAILED", appVersion: "2.2.4", message: `发送失败 ${SECRET_MARKERS[1]}`, detail: { text: SECRET_MARKERS[1] }, machine: "phone-a" },
    { at: "2026-11-19T07:01:10.000Z", kind: "health", path: "/api/health", status: 200, appVersion: "2.2.4", machine: "phone-a" },
  ];
  fs.writeFileSync(path.join(logDir, "phone", "phone-a-20261119.jsonl"), phoneLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  fs.writeFileSync(path.join(logDir, "supervisor.log"), `2026-11-19 16:30:13 [supervisor] Starting tunnel with ${SECRET_MARKERS[0]}\n`);
  return logDir;
}

test("日志包：只有 allowlist 字段进包，标记与 access code 0 命中", () => {
  const logDir = seedLogs();
  try {
    const bundle = buildLogBundle({ logDir, machine: "phone-a", now: new Date("2026-11-19T07:05:00Z"), secrets: [ACCESS_CODE] });
    const entries = readZip(bundle.buffer);
    assert.deepEqual([...entries.keys()].sort(), ["manifest.json", "phone/phone-a-20261119.jsonl", "server/server-20261119.log", "supervisor/supervisor.log"].sort());

    for (const [name, text] of entries) {
      for (const marker of SECRET_MARKERS) {
        assert.equal(text.includes(marker), false, `${name} leaked ${marker}:\n${text}`);
      }
      assert.equal(text.includes(ACCESS_CODE), false, `${name} leaked the access code`);
    }

    const server = JSON.parse(entries.get("server/server-20261119.log").trim().split("\n")[1]);
    assert.equal(server.path, "/api/send");
    assert.equal(server.status, 500);
    assert.equal(server.note, undefined, "note must not be copied");
    assert.equal(server.stack, undefined, "stack must not be copied");

    const phone = JSON.parse(entries.get("phone/phone-a-20261119.jsonl").trim().split("\n")[0]);
    assert.equal(phone.kind, "send-failed");
    assert.equal(phone.code, "SEND_FAILED");
    assert.equal(phone.message, undefined, "phone message text must not be copied");
    assert.equal(phone.detail, undefined, "phone detail must not be copied");

    const supervisor = entries.get("supervisor/supervisor.log");
    assert.match(supervisor, /2026-11-19 16:30:13 \[supervisor\] \[text omitted\]/);
    assert.equal(supervisor.includes(SECRET_MARKERS[0]), false);

    const manifest = JSON.parse(entries.get("manifest.json"));
    assert.equal(manifest.machine, "phone-a");
    assert.equal(manifest.files.length, 3);
    assert.deepEqual(manifest.filesOmitted, [], "nothing was left out, so nothing must be listed");
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

test("日志包：被上限挡掉的文件必须在 manifest 里留名，截断必须写 fromBytes", () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-logs-cap-"));
  const phoneDir = path.join(logDir, "phone");
  fs.mkdirSync(phoneDir, { recursive: true });
  const line = (date) => JSON.stringify({ ts: `${date}T07:00:00.000Z`, source: "server", level: "info", method: "GET", path: "/api/health", status: 200, ms: 1 }) + "\n";
  try {
    // Three server days; only the two newest may be packed.
    for (const [index, day] of ["20261117", "20261118", "20261119"].entries()) {
      const file = path.join(logDir, `server-${day}.log`);
      fs.writeFileSync(file, line(day));
      fs.utimesSync(file, new Date(2026, 10, 17 + index, 8), new Date(2026, 10, 17 + index, 8));
    }
    // 25 phone files against a 24-file cap.
    for (let index = 0; index < 25; index += 1) {
      const file = path.join(phoneDir, `phone-${String(index).padStart(2, "0")}-20261119.jsonl`);
      fs.writeFileSync(file, JSON.stringify({ at: "2026-11-19T07:00:00.000Z", kind: "health", status: 200 }) + "\n");
      fs.utimesSync(file, new Date(2026, 10, 19, 7, index), new Date(2026, 10, 19, 7, index));
    }

    const bundle = buildLogBundle({ logDir, machine: "cap-box", now: new Date("2026-11-19T09:00:00Z") });
    const entries = readZip(bundle.buffer);
    const manifest = JSON.parse(entries.get("manifest.json"));
    const omitted = manifest.filesOmitted.map((entry) => entry.path);

    assert.deepEqual(omitted, ["server/server-20261117.log", "phone/phone-00-20261119.jsonl"]);
    assert.equal(entries.has("server/server-20261117.log"), false, "an omitted file must not be inside the zip");
    assert.equal(entries.has("phone/phone-00-20261119.jsonl"), false);
    const oldest = manifest.filesOmitted.find((entry) => entry.path === "server/server-20261117.log");
    assert.equal(oldest.bytes, fs.statSync(path.join(logDir, "server-20261117.log")).size, "the manifest must report the real size");
    assert.equal(bundle.omitted.length, 2, "the caller sees the same omission count the manifest carries");
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

test("日志包：supervisor 连续重复行折叠成一行 + 次数，正文仍不进包", () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-logs-run-"));
  try {
    const repeat = `Starting tunnel to 121.40.69.97; remote port 18788 ${SECRET_MARKERS[0]}`;
    const lines = [
      `2026-11-19 14:27:01 [supervisor] ${repeat}`,
      `2026-11-19 14:27:08 [supervisor] ${repeat}`,
      `2026-11-19 14:27:15 [supervisor] ${repeat}`,
      `2026-11-19 14:27:22 [supervisor] tunnel ready on port 18788`,
      `2026-11-19 14:27:29 [supervisor] ${SECRET_MARKERS[1]}`,
    ];
    fs.writeFileSync(path.join(logDir, "supervisor.log"), `${lines.join("\n")}\n`);

    const bundle = buildLogBundle({ logDir, machine: "run-box", now: new Date("2026-11-19T15:00:00Z") });
    const entries = readZip(bundle.buffer);
    const supervisor = entries.get("supervisor/supervisor.log");

    assert.match(supervisor, /2026-11-19 14:27:01 \[supervisor\] \[text omitted\] ×3 \(until 2026-11-19 14:27:15\)/);
    assert.match(supervisor, /2026-11-19 14:27:22 \[supervisor\] \[text omitted\]\n/, "a single line carries no count");
    assert.equal(supervisor.split("\n").filter(Boolean).length, 3, "five lines collapse to three runs");
    for (const marker of SECRET_MARKERS) {
      assert.equal(supervisor.includes(marker), false, "collapsing must not drag the text along");
    }
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

test("日志包：超出单文件预算时按行切尾，并在 manifest 记 truncated/fromBytes", () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-logs-cut-"));
  try {
    const record = JSON.stringify({ ts: "2026-11-19T07:00:00.000Z", source: "server", level: "info", method: "GET", path: "/api/threads", status: 200, ms: 4 });
    const file = path.join(logDir, "server-20261119.log");
    fs.writeFileSync(file, `${Array.from({ length: 80000 }, () => record).join("\n")}\n`);
    const size = fs.statSync(file).size;
    assert.ok(size > 8 * 1024 * 1024, "the fixture must exceed the 8 MB per-file budget");

    const bundle = buildLogBundle({ logDir, machine: "cut-box", now: new Date("2026-11-19T09:00:00Z") });
    const entries = readZip(bundle.buffer);
    const manifest = JSON.parse(entries.get("manifest.json"));
    const entry = manifest.files.find((item) => item.path === "server/server-20261119.log");

    assert.equal(entry.truncated, true, "truncation is a fact, not an omission");
    assert.ok(entry.fromBytes > 0 && entry.fromBytes < size, `fromBytes must point into the original (got ${entry.fromBytes} of ${size})`);
    const firstLine = entries.get("server/server-20261119.log").split("\n")[0];
    assert.doesNotThrow(() => JSON.parse(firstLine), "the tail must start on a line boundary");
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

