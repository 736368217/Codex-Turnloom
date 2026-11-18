import test from "node:test";
import assert from "node:assert/strict";
import { runningTimeLabel } from "../public/runtime.js";

test("running time uses the real turn start across refreshes and minute boundaries", () => {
  const status = { thinking: true, startedAtMs: 1000 };
  assert.equal(runningTimeLabel(status, 1000), "已运行 0分0秒");
  assert.equal(runningTimeLabel(status, 60999), "已运行 0分59秒");
  assert.equal(runningTimeLabel(status, 62000), "已运行 1分1秒");
  assert.equal(runningTimeLabel(status, 3662000, "en"), "Running 61m 1s");
  assert.equal(runningTimeLabel(status, 0), "已运行 0分0秒");
  assert.equal(runningTimeLabel({ ...status, thinking: false }, 62000), "");
  assert.equal(runningTimeLabel({ thinking: true }, 62000), "");
});
