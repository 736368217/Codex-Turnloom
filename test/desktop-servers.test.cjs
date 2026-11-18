"use strict";

/**
 * 服务端（公网入口）表：一台电脑保存多个中转服务器，桌面端选一个再连接。
 * 这里锁住派生规则——publicUrl / tunnel 必须来自活动服务端条目，
 * 否则配对二维码会和隧道实际指向的服务器漂移。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const configModule = require(path.join(__dirname, "..", "desktop", "service", "config.cjs"));

const KEY = { keyPath: "C:\\Users\\demo\\.ssh\\codex_pocket_ed25519", knownHostsPath: "C:\\Users\\demo\\.ssh\\known_hosts" };

function baseConfig() {
  return configModule.normalizeConfig({
    machineName: "demo",
    accessCode: "123456",
    publicUrl: "https://a.example.com",
    tunnel: { enabled: true, host: "1.1.1.1", user: "codextunnel", remotePort: 18786, ...KEY },
  });
}

test("旧配置迁移成一个服务端条目，并保持原有公网地址", () => {
  const config = baseConfig();
  assert.equal(config.servers.length, 1);
  assert.equal(config.servers[0].publicUrl, "https://a.example.com");
  assert.equal(config.servers[0].tunnel.host, "1.1.1.1");
  assert.equal(config.activeServerId, config.servers[0].id);
});

test("新增服务端不会改动当前活动项与派生地址", () => {
  const config = baseConfig();
  const rows = [...config.servers, {
    id: "srv-b", name: "备用", publicUrl: "https://b.example.com",
    tunnel: { enabled: true, host: "2.2.2.2", user: "codextunnel", remotePort: 19000, ...KEY },
  }];
  const next = configModule.normalizeConfig({ ...config, servers: rows });
  assert.equal(next.servers.length, 2);
  assert.equal(next.publicUrl, "https://a.example.com");
  assert.equal(next.tunnel.host, "1.1.1.1");
});

test("切换活动服务端后 publicUrl 与 tunnel 一起切换", () => {
  const config = baseConfig();
  const rows = [...config.servers, {
    id: "srv-b", name: "备用", publicUrl: "https://b.example.com/",
    tunnel: { enabled: true, host: "2.2.2.2", user: "tunnel", remotePort: 19000, ...KEY },
  }];
  const switched = configModule.normalizeConfig({ ...config, servers: rows, activeServerId: "srv-b" });
  assert.equal(switched.activeServerId, "srv-b");
  assert.equal(switched.publicUrl, "https://b.example.com", "尾部斜杠必须被去掉");
  assert.equal(switched.tunnel.host, "2.2.2.2");
  assert.equal(switched.tunnel.remotePort, 19000);
  assert.equal(switched.tunnel.user, "tunnel");
});

test("活动服务端指向不存在的 id 时回落到第一个条目", () => {
  const config = configModule.normalizeConfig({ ...baseConfig(), activeServerId: "srv-missing" });
  assert.equal(config.activeServerId, config.servers[0].id);
  assert.equal(config.publicUrl, config.servers[0].publicUrl);
});

test("表单改动经 syncActiveServer 回填活动条目后不会被旧值覆盖", () => {
  const config = baseConfig();
  const edited = configModule.syncActiveServer({
    ...config,
    publicUrl: "https://c.example.com",
    tunnel: { ...config.tunnel, host: "3.3.3.3", remotePort: 21000 },
  });
  const next = configModule.normalizeConfig(edited);
  assert.equal(next.publicUrl, "https://c.example.com");
  const active = next.servers.find((item) => item.id === next.activeServerId);
  assert.equal(active.publicUrl, "https://c.example.com");
  assert.equal(active.tunnel.host, "3.3.3.3");
  assert.equal(active.tunnel.remotePort, 21000);
});

test("publicConfig 只暴露服务端的公开字段", () => {
  const view = configModule.publicConfig(baseConfig());
  assert.equal(view.servers.length, 1);
  const server = view.servers[0];
  assert.deepEqual(Object.keys(server).sort(), [
    "active", "id", "keyPath", "name", "publicUrl", "remotePort", "sshHost", "sshUser",
  ]);
  assert.equal(server.publicUrl, "https://a.example.com");
  assert.equal(Object.prototype.hasOwnProperty.call(view, "machineToken"), false);
});

test("直连模式不被服务端条目重新填回公网地址", () => {
  const config = configModule.normalizeConfig({
    ...baseConfig(),
    network: { mode: "direct" },
    publicUrl: "",
    tunnel: { ...baseConfig().tunnel, enabled: false },
  });
  assert.equal(config.publicUrl, "");
  assert.equal(config.tunnel.enabled, false);
  assert.equal(config.servers.length, 1, "服务端列表仍然保留，方便切回 SSH 模式");
});
