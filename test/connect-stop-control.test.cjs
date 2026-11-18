"use strict";

/**
 * 手机端「连接中可以主动停止」的门禁。
 *
 * 目标：连接旧地址或不可达地址时，用户不必等到超时，点一下就回到可操作状态。
 * 这里锁三件事：源码真的有停止入口、停止动作会取消在途请求并作废本次尝试、
 * 打包进 WebView 的成品 bundle 里也带着这段代码。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const screen = fs.readFileSync(path.join(ROOT, "app", "src", "screens", "ConnectScreen.tsx"), "utf8");
const store = fs.readFileSync(path.join(ROOT, "app", "src", "state", "sessionStore.ts"), "utf8");

test("连接页有停止入口，且只在连接过程中出现", () => {
  assert.match(screen, /停止连接/);
  assert.match(screen, /\{working && <button[^>]*onClick=\{stop\}/);
  assert.match(screen, /function stop\(\)/);
});

test("停止动作调用 stopConnecting 并给出可读提示", () => {
  assert.match(screen, /stopConnecting\(\)/);
  assert.match(screen, /已停止连接/);
});

test("stopConnecting 取消在途请求并作废本次尝试", () => {
  assert.match(store, /export function stopConnecting/);
  assert.match(store, /cancelAllNativeRequests\(\)/);
  assert.match(store, /transitionSeq \+= 1/);
  // 已配对回 error（可重试/换地址），未配对回 unpaired（可直接重填）。
  assert.match(store, /paired \? 'error' : 'unpaired'/);
});

test("打包进 WebView 的成品 bundle 含有停止逻辑", () => {
  const assets = path.join(ROOT, "native-shell", "app", "src", "main", "assets", "public", "assets");
  const bundles = fs.readdirSync(assets).filter((name) => name.endsWith(".js"));
  assert.ok(bundles.length > 0, "缺少打包后的 JS bundle");
  const text = bundles.map((name) => fs.readFileSync(path.join(assets, name), "utf8")).join("\n");
  assert.ok(text.includes("停止连接"), "成品 bundle 未包含停止按钮文案");
  assert.ok(text.includes("已停止连接"), "成品 bundle 未包含停止提示文案");
});
