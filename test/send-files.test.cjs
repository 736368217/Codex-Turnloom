"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_SEND_FILES,
  MAX_SEND_FILE_BYTES,
  MAX_SEND_FILES_TOTAL_BYTES,
  normalizeSendFiles,
  assertNormalizedSendFiles,
  sendFilesFingerprint,
  validateStagedSendFiles,
  formatSendFileReference,
  sendFilesPromptBlock,
  messageWithSendFiles,
  sendFilesPublicMetadata,
  sanitizeSendFileName,
  stageSendFiles
} = require("../shared/send-files.cjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function attach(name, bytes, mimeType = "application/octet-stream", extra = {}) {
  return {
    name,
    mimeType,
    data: Buffer.from(bytes).toString("base64"),
    ...extra
  };
}

function tempDataRoot(t, label = "send files") {
  const root = mkdtempSync(path.join(os.tmpdir(), `turnloom ${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function expectSendFileError(promise, code = "INVALID_SEND_FILE", status = 400) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.name, "SendFileError");
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.doesNotMatch(error.message, /secret|\.\.[\\/]|base64,/i);
    return true;
  });
}

test("normalizeSendFiles enforces 4 files, 4 MiB each and 6 MiB total", () => {
  assert.equal(MAX_SEND_FILES, 4);
  assert.equal(MAX_SEND_FILE_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_SEND_FILES_TOTAL_BYTES, 6 * 1024 * 1024);
  assert.deepEqual(normalizeSendFiles(), []);
  assert.deepEqual(normalizeSendFiles(null), []);

  const four = Array.from({ length: 4 }, (_, index) =>
    attach(`note-${index}.txt`, Buffer.alloc(1024, index + 1), "text/plain")
  );
  assert.equal(normalizeSendFiles(four).length, 4);
  assert.throws(
    () => normalizeSendFiles([...four, attach("fifth.txt", "x")]),
    (error) => error.code === "TOO_MANY_SEND_FILES" && error.status === 400
  );

  const exactlyFourMiB = attach("4MiB.bin", Buffer.alloc(MAX_SEND_FILE_BYTES, 7));
  assert.equal(normalizeSendFiles([exactlyFourMiB])[0].size, MAX_SEND_FILE_BYTES);
  assert.throws(
    () => normalizeSendFiles([attach("too-big.bin", Buffer.alloc(MAX_SEND_FILE_BYTES + 1))]),
    (error) => error.code === "SEND_FILE_TOO_LARGE" && error.status === 400
  );

  const halfPlusOne = MAX_SEND_FILES_TOTAL_BYTES / 2 + 1;
  assert.throws(
    () => normalizeSendFiles([
      attach("a.bin", Buffer.alloc(halfPlusOne, 1)),
      attach("b.bin", Buffer.alloc(halfPlusOne, 2))
    ]),
    (error) => error.code === "SEND_FILES_TOO_LARGE" && error.status === 400
  );
  const atAggregateLimit = [
    attach("a.bin", Buffer.alloc(MAX_SEND_FILES_TOTAL_BYTES / 2, 1)),
    attach("b.bin", Buffer.alloc(MAX_SEND_FILES_TOTAL_BYTES / 2, 2))
  ];
  assert.equal(
    normalizeSendFiles(atAggregateLimit).reduce((sum, file) => sum + file.size, 0),
    MAX_SEND_FILES_TOTAL_BYTES
  );
});

test("normalizeSendFiles accepts strict base64/data URLs and sanitizes names/MIME", () => {
  const bytes = Buffer.from("hello\0world", "utf8");
  const normalized = normalizeSendFiles([{
    name: "..\\..\\预算 2026;rm -rf.pdf",
    mimeType: "  APPLICATION/PDF  ",
    data: ` data:application/pdf;charset=binary;base64,${bytes.toString("base64")} `,
    path: "C:\\Windows\\System32\\evil.dll"
  }]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, "预算_2026_rm_-rf.pdf");
  assert.equal(normalized[0].mimeType, "application/pdf");
  assert.equal(normalized[0].data, bytes.toString("base64"));
  assert.equal(normalized[0].size, bytes.byteLength);
  assert.equal(normalized[0].sha256, sha256(bytes));
  assert.equal("path" in normalized[0], false);

  assert.equal(sanitizeSendFileName("C:/outside/../report.xlsx"), "report.xlsx");
  assert.equal(sanitizeSendFileName(".hidden"), "hidden");
  assert.equal(sanitizeSendFileName("a\r\nb\t.txt"), "ab.txt");
  assert.equal(sanitizeSendFileName("", 2), "file-3");

  for (const bad of [
    null,
    {},
    { name: "x", mimeType: "text/plain", data: 42 },
    { name: "x", mimeType: "text/plain", data: "" },
    { name: "x", mimeType: "text/plain", data: "!!!!" },
    { name: "x", mimeType: "text/plain", data: "YQ" },
    { name: "x", mimeType: "text/plain", data: "YQ===" },
    // Buffer.from would accept this non-canonical trailing-bit encoding.
    { name: "x", mimeType: "text/plain", data: "YR==" },
    { name: "x", mimeType: "text/plain", data: "YWJj\n" },
    { name: "x", mimeType: "text/plain\r\nInjected: 1", data: "YWJj" },
    { name: "x", mimeType: "not-a-mime", data: "YWJj" },
    { name: "x", mimeType: "text/plain", data: "YW\nJj" }
  ]) {
    assert.throws(() => normalizeSendFiles([bad]), (error) => error.name === "SendFileError" && error.status === 400);
  }
  assert.throws(() => normalizeSendFiles("YWJj"), (error) => error.name === "SendFileError");

  const error = (() => {
    try {
      normalizeSendFiles([{ name: "secret-token.txt", mimeType: "text/plain", data: "TOP-SECRET!!!" }]);
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert.ok(error);
  assert.doesNotMatch(error.message, /secret|TOP-SECRET|YWJj/);
});

test("ordinary files never enter the image pipeline", () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
  const normalized = normalizeSendFiles([
    attach("sneaky.png", bytes, "image/png"),
    attach("sneaky.PNG", bytes, "application/pdf")
  ]);
  assert.equal(normalized[0].mimeType, "application/octet-stream");
  assert.equal(normalized[1].mimeType, "application/pdf");
  assert.ok(normalized.every((entry) => !entry.mimeType.startsWith("image/")));
  assert.ok(normalized.every((entry) => !("url" in entry) && !("width" in entry) && !("height" in entry)));
});

test("stageSendFiles writes exact binary bytes to a bounded absolute scratch path", async (t) => {
  const dataRoot = tempDataRoot(t);
  const binary1 = Buffer.from([0, 1, 2, 253, 254, 255]);
  const binary2 = Buffer.from("%PDF-1.7\nSECRET-CONTENT\0END", "utf8");
  const normalized = normalizeSendFiles([
    attach("../../etc/report.pdf", binary1, "application/pdf", { path: "/etc/cron.d/evil" }),
    attach("C:\\Windows\\win.ini", binary2, "text/plain", { path: "C:\\Windows\\win.ini" })
  ]);
  const staged = await stageSendFiles(normalized, { dataRoot, sessionKey: "thread-123" });
  assert.equal(staged.length, 2);

  const scratchRoot = path.resolve(dataRoot, "scratch");
  for (const [index, entry] of staged.entries()) {
    assert.equal(entry.staged, true);
    assert.ok(path.isAbsolute(entry.path), `${entry.path} must be absolute`);
    assert.equal(path.relative(path.resolve(scratchRoot, "thread-123"), entry.path).startsWith(".."), false);
    assert.match(path.basename(entry.path), /^turnloom-file-[0-9a-f]{16}/i);
    assert.doesNotMatch(entry.path, /etc[\\/]cron\.d|Windows[\\/]win\.ini/i);
    const bytes = readFileSync(entry.path);
    assert.deepEqual(bytes, index === 0 ? binary1 : binary2);
    assert.equal(entry.size, bytes.byteLength);
    assert.equal(entry.sha256, sha256(bytes));
    assert.equal("data" in entry, false);
  }
  assert.notEqual(staged[0].path, staged[1].path);
  assert.equal(staged[0].name, "report.pdf");
  assert.equal(staged[1].name, "win.ini");
  assert.equal(readdirSync(path.resolve(scratchRoot, "thread-123")).length, 2);
  assert.deepEqual(await stageSendFiles([], { dataRoot, sessionKey: "thread-123" }), []);
});

test("stageSendFiles applies a non-image extension and quoted host-readable prompt references", async (t) => {
  const dataRoot = tempDataRoot(t, "space root");
  const bytes = Buffer.from("attachment-bytes-not-in-prompt", "utf8");
  const normalized = normalizeSendFiles([attach("photo.png", bytes, "image/png")]);
  const staged = await stageSendFiles(normalized, { dataRoot, sessionKey: "new-request" });
  assert.equal(staged.length, 1);
  assert.match(path.basename(staged[0].path), /^turnloom-file-[0-9a-f]{16}\.bin$/i);
  assert.equal(staged[0].mimeType, "application/octet-stream");

  const prompt = messageWithSendFiles("Please read the file", staged);
  assert.ok(prompt.startsWith("Please read the file\n\n[Files mentioned:"));
  assert.match(prompt, /photo\.png/);
  assert.match(prompt, /application\/octet-stream/);
  assert.match(prompt, new RegExp(staged[0].sha256));
  // The root contains spaces, so PI-Desktop formatFileInsert convention quotes it.
  assert.ok(prompt.includes(formatSendFileReference(staged[0].path)));
  assert.ok(prompt.includes(`@"${staged[0].path}"`));
  assert.equal(prompt.includes(bytes.toString("base64")), false);
  assert.equal(prompt.includes("attachment-bytes-not-in-prompt"), false);
  assert.equal(prompt.startsWith("[Files mentioned:"), false, "user text comes first when present");

  const onlyFilesPrompt = messageWithSendFiles("", staged);
  assert.ok(onlyFilesPrompt.startsWith("[Files mentioned:"));
  assert.equal(sendFilesPromptBlock([]), "");
  assert.equal(messageWithSendFiles("plain", []), "plain");
  assert.deepEqual(sendFilesPublicMetadata(staged), [{
    name: "photo.png",
    mimeType: "application/octet-stream",
    size: bytes.byteLength,
    sha256: sha256(bytes)
  }]);
  assert.equal("path" in sendFilesPublicMetadata(staged)[0], false);

  assert.equal(formatSendFileReference("C:/no-space/file.pdf"), "@C:/no-space/file.pdf");
  assert.equal(formatSendFileReference("C:/with space/file.pdf"), '@"C:/with space/file.pdf"');
});

test("sendFilesFingerprint changes with file identity and canonicalizes raw inputs", () => {
  const bytes = Buffer.from("fingerprint bytes", "utf8");
  const raw = [attach("a.pdf", bytes, "application/pdf")];
  const normalized = normalizeSendFiles(raw);
  const base = sendFilesFingerprint(raw);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(base, sendFilesFingerprint(normalized));
  assert.equal(base, sendFilesFingerprint([{
    name: "a.pdf",
    mimeType: "APPLICATION/PDF",
    data: `data:application/pdf;base64,${bytes.toString("base64")}`
  }]));
  assert.equal(sendFilesFingerprint([]), sendFilesFingerprint([]));
  assert.equal(sendFilesFingerprint(null), "");

  assert.notEqual(base, sendFilesFingerprint([attach("a.pdf", Buffer.concat([bytes, Buffer.from("!")]), "application/pdf")]));
  assert.notEqual(base, sendFilesFingerprint([attach("b.pdf", bytes, "application/pdf")]));
  assert.notEqual(base, sendFilesFingerprint([attach("a.pdf", bytes, "application/zip")]));
  assert.notEqual(base, sendFilesFingerprint([
    attach("a.pdf", bytes, "application/pdf"),
    attach("b.pdf", bytes, "application/pdf")
  ]));
  assert.notEqual(
    sendFilesFingerprint([attach("a.txt", "one"), attach("b.txt", "two")]),
    sendFilesFingerprint([attach("b.txt", "two"), attach("a.txt", "one")])
  );
  assert.notEqual(base, sendFilesFingerprint([{ ...raw[0], data: "bad base64*" }]));
  assert.equal(base.includes(bytes.toString("base64")), false);
  assert.equal(base.includes("a.pdf"), false);

  // Stage only after the idempotency gate in the caller: pure fingerprinting
  // and normalization must never create directories.
  assert.equal(assertNormalizedSendFiles(normalized), normalized);
  assert.throws(() => assertNormalizedSendFiles(raw), (error) => error.name === "SendFileError");
  assert.throws(
    () => assertNormalizedSendFiles([{ ...normalized[0], sha256: "0".repeat(64) }]),
    (error) => error.name === "SendFileError"
  );
  assert.throws(
    () => assertNormalizedSendFiles([{ ...normalized[0], size: normalized[0].size + 1 }]),
    (error) => error.name === "SendFileError"
  );
});

test("stageSendFiles rejects arbitrary roots, traversal keys and forged staged paths", async (t) => {
  const dataRoot = tempDataRoot(t);
  const normalized = normalizeSendFiles([attach("safe.txt", "hello")]);
  await expectSendFileError(
    stageSendFiles(normalized, { dataRoot: "relative-root", sessionKey: "thread" }),
    "SEND_FILE_STAGING_FAILED",
    500
  );
  await expectSendFileError(
    stageSendFiles(normalized, { dataRoot: path.join(dataRoot, 'bad"root'), sessionKey: "thread" }),
    "SEND_FILE_STAGING_FAILED",
    500
  );
  await expectSendFileError(
    stageSendFiles(normalizeSendFiles([attach("safe.txt", "not normalized")]).map(({ data }) => ({ data })), {
      dataRoot,
      sessionKey: "thread"
    }),
    "INVALID_SEND_FILE",
    400
  );

  const traversalStaged = await stageSendFiles(normalized, {
    dataRoot,
    sessionKey: "../../escape me"
  });
  assert.equal(traversalStaged.length, 1);
  assert.match(path.basename(path.dirname(traversalStaged[0].path)), /^turnloom-request-[0-9a-f]{16}$/);
  assert.equal(path.relative(path.resolve(dataRoot, "scratch"), traversalStaged[0].path).startsWith(".."), false);
  assert.equal(readdirSync(dataRoot).some((name) => name === "escape me"), false);

  const pretendPath = path.join(dataRoot, "scratch", "thread", "turnloom-file-0000000000000000.txt");
  const forgedPath = path.join(os.tmpdir(), "turnloom-attacker-file.pdf");
  for (const bad of [
    [{ ...traversalStaged[0], staged: undefined }],
    [{ ...traversalStaged[0], path: forgedPath }],
    [{ ...traversalStaged[0], path: pretendPath.replace(/\.txt$/, ".txt\r\nInjected") }],
    [{ ...traversalStaged[0], path: path.join(dataRoot, 'bad"path', path.basename(traversalStaged[0].path)) }],
    [{ ...traversalStaged[0], sha256: "not-a-digest" }]
  ]) {
    assert.throws(() => validateStagedSendFiles(bad), (error) => error.name === "SendFileError");
    assert.throws(() => sendFilesPromptBlock(bad), (error) => error.name === "SendFileError");
    assert.throws(() => sendFilesPublicMetadata(bad), (error) => error.name === "SendFileError");
  }
  assert.deepEqual(validateStagedSendFiles(), []);
});

test("stageSendFiles refuses a scratch symlink outside the App-owned root", async (t) => {
  const dataRoot = tempDataRoot(t, "symlink guard");
  const outside = path.join(dataRoot, "outside");
  const scratch = path.join(dataRoot, "scratch");
  const sessionDir = path.join(scratch, "thread-symlink");
  mkdirSync(outside, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  try {
    symlinkSync(outside, sessionDir, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory symlink unavailable: ${error.code || error.message}`);
    return;
  }
  const normalized = normalizeSendFiles([attach("safe.txt", "must not escape")]);
  await expectSendFileError(
    stageSendFiles(normalized, { dataRoot, sessionKey: "thread-symlink" }),
    "SEND_FILE_STAGING_FAILED",
    500
  );
  assert.deepEqual(readdirSync(outside), []);
});

test("stageSendFiles rolls back every byte written when a later write fails", async (t) => {
  const dataRoot = tempDataRoot(t, "rollback");
  const normalized = normalizeSendFiles([
    attach("first.bin", "first bytes"),
    attach("second.bin", "second bytes"),
    attach("third.bin", "third bytes")
  ]);
  const sessionRoot = path.resolve(dataRoot, "scratch", "thread-rollback");
  const originalWriteFile = fsPromises.writeFile;
  let calls = 0;
  fsPromises.writeFile = async (...args) => {
    const target = String(args[0] || "");
    if (target.startsWith(sessionRoot) && ++calls === 2) {
      throw Object.assign(new Error("simulated disk failure"), { code: "EACCES" });
    }
    return originalWriteFile.apply(fsPromises, args);
  };
  t.after(() => {
    fsPromises.writeFile = originalWriteFile;
  });
  await expectSendFileError(
    stageSendFiles(normalized, { dataRoot, sessionKey: "thread-rollback" }),
    "SEND_FILE_STAGING_FAILED",
    500
  );
  assert.equal(calls, 2);
  assert.deepEqual(readdirSync(sessionRoot), []);
});
