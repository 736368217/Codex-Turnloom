"use strict";

// Network transport is optional. Neither the client nor the session API owns it.
const MODES = new Set(["direct", "external", "ssh"]);
function transportMode(config = {}) {
  if (MODES.has(config.network?.mode)) return config.network.mode;
  return config.tunnel?.enabled ? "ssh" : (config.publicUrl || config.machineGateway?.origin) ? "external" : "direct";
}
function explicitTransport(config) { return MODES.has(config?.network?.mode); }
function sshEnabled(config) { return transportMode(config) === "ssh"; }
function configuredPublicUrl(config = {}) {
  if (explicitTransport(config) && transportMode(config) === "direct") return "";
  // Explicit mode makes the edited public URL authoritative, including clearing it.
  if (explicitTransport(config)) return String(config.publicUrl || "").replace(/\/+$/, "");
  return String(config.machineGateway?.origin || config.publicUrl || "").replace(/\/+$/, "");
}
function changeImpact(previous = {}, next = {}) {
  const changed = (keys) => keys.some(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
  const service = changed(["host", "port", "accessCode", "readonly", "codexHome", "ipcSocket", "repoRoot", "nodePath", "machineGateway"]);
  const relay = service || changed(["network", "tunnel"]);
  return { service, relay, client: changed(["publicUrl", "network", "machineName", "extraDevices"]) };
}
function topology(config, service, tunnel) {
  const mode = transportMode(config);
  return {
    client: { role: "client", state: "configured", address: configuredPublicUrl(config) || "lan" },
    server: { role: "server", state: service.state, healthy: Boolean(service.health?.ok) },
    relay: { role: "relay", mode, state: mode === "direct" ? "disabled" : mode === "external" ? "unverified" : tunnel.state,
      detail: mode === "direct" ? "局域网或 VPN 直连，不依赖公网服务器" : mode === "external" ? "由外部代理管理；填写地址不代表可达" : tunnel.error || "SSH 进程状态不代表公网 HTTP 可达" }
  };
}
module.exports = { transportMode, explicitTransport, sshEnabled, configuredPublicUrl, changeImpact, topology };
