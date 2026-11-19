"use strict";

/**
 * 上传腿的三个出口（task:6cc144c0，2.2.5）：缺凭据、R2 拒收、成功。
 *
 * 判据是「失败时不会变成别的东西」：缺凭据必须是 200 + 可读 error（控制台据此
 * 显示提示），绝不能先去打 R2；R2 非 2xx 与网络异常都必须是 502，不能漏成 500
 * 或静默成功；成功时 key 的形状与计数要与实测过的对象一致。
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { uploadLogBundle, logUploadKey, HINT } = require("../server/log-upload.cjs");

function fakeBundle() {
  return {
    name: "logs-box-2026-11-19_11-48-35-764.zip",
    buffer: Buffer.from("zip-bytes"),
    files: [{ path: "a" }, { path: "b" }],
    omitted: [{ path: "server/server-20261116.log", bytes: 1 }],
    droppedLines: 3,
  };
}

test("缺凭据：200 + upload-token-missing，且一次请求都不发", async () => {
  let called = 0;
  const result = await uploadLogBundle({
    token: "",
    bundle: fakeBundle(),
    machine: "736-WIN",
    fetchImpl: () => {
      called += 1;
      throw new Error("must not reach R2 without a token");
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: false, error: "upload-token-missing", hint: HINT });
  assert.equal(called, 0);
  assert.match(HINT, /r2-upload-token\.txt/);
});

test("R2 拒收：502 + 可读原因，不冒充成功", async () => {
  const result = await uploadLogBundle({
    token: "tok",
    bundle: fakeBundle(),
    machine: "736-WIN",
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "upload-failed");
  assert.equal(result.body.reason, "R2 returned 401");
});

test("网络异常同样是 502，原因原样带出", async () => {
  const result = await uploadLogBundle({
    token: "tok",
    bundle: fakeBundle(),
    machine: "736-WIN",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:443");
    },
  });
  assert.equal(result.status, 502);
  assert.match(result.body.reason, /ECONNREFUSED/);
});

test("成功：key 形状、PUT 头与计数都按实测过的形状", async () => {
  let seen = null;
  const result = await uploadLogBundle({
    token: "tok",
    bundle: fakeBundle(),
    machine: "736 WIN",
    suffix: "abcd1234",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.key, "turnloom/logs/736-WIN/logs-box-2026-11-19_11-48-35-764-abcd1234.zip");
  assert.equal(result.body.bytes, 9);
  assert.equal(result.body.files, 2);
  assert.equal(result.body.omitted, 1, "omitted 必须透传，否则回执又会把「少了的」藏起来");
  assert.equal(result.body.droppedLines, 3);
  assert.equal(seen.init.method, "PUT");
  assert.equal(seen.init.headers["X-Upload-Token"], "tok");
  assert.equal(seen.init.headers["content-type"], "application/zip");
  assert.equal(seen.url, `https://dl.736.de5.net/${result.body.key}`);
});

test("key 后缀默认 8 位十六进制（32 bit 随机）", () => {
  assert.match(logUploadKey({ machine: "736-WIN", name: "logs-x.zip" }), /^turnloom\/logs\/736-WIN\/logs-x-[0-9a-f]{8}\.zip$/);
});
