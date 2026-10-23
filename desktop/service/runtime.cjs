"use strict";

const { EventEmitter } = require("node:events");
const { ServiceController } = require("./controller.cjs");
const { TunnelController } = require("./tunnel.cjs");
const { urlsFor } = require("./config.cjs");

function overallState(service, tunnel) {
  if (!service) return "stopped";
  if (service.state === "error") return "error";
  if (service.state === "starting") return "starting";
  if (service.state === "restarting") return "restarting";
  if (service.state === "stopping") return "stopping";
  if (service.state === "stopped") return "stopped";
  if (service.state === "degraded") return "degraded";
  if (service.state === "running") {
    if (tunnel?.enabled && !["connected", "disabled"].includes(tunnel.state)) return "degraded";
    return "running";
  }
  return service.state || "stopped";
}

function stateLabel(state) {
  return {
    stopped: "已停止",
    starting: "启动中",
    running: "运行中",
    degraded: "部分可用",
    stopping: "停止中",
    restarting: "重启中",
    error: "启动失败"
  }[state] || state;
}

class RuntimeManager extends EventEmitter {
  constructor({ config, logger }) {
    super();
    this.config = config;
    this.logger = logger;
    this.service = new ServiceController({ config, logger });
    this.tunnel = new TunnelController({ config, logger });
    this._bind();
  }

  _bind() {
    this.service.on("changed", () => this.emit("changed", this.snapshot()));
    this.tunnel.on("changed", () => this.emit("changed", this.snapshot()));
    this.service.on("alert", (alert) => this.emit("alert", alert));
  }

  setConfig(config) {
    this.config = config;
    this.service.setConfig(config);
    this.tunnel.setConfig(config);
    this.emit("changed", this.snapshot());
  }

  get state() {
    return overallState(this.service.snapshot(), this.tunnel.snapshot());
  }

  snapshot() {
    const service = this.service.snapshot();
    const tunnel = this.tunnel.snapshot();
    const state = overallState(service, tunnel);
    let detail = service.detail;
    if (state === "running") {
      detail = tunnel.enabled ? "本机服务与 SSH 隧道均正常" : "本机服务正常，手机端可以访问";
    } else if (state === "degraded") {
      detail = tunnel.enabled && tunnel.state !== "connected"
        ? (tunnel.error || "SSH 隧道断开，局域网仍可访问")
        : "服务响应异常，正在重试";
    } else if (state === "stopped") {
      detail = "服务未启动";
    }
    return {
      state,
      label: stateLabel(state),
      detail,
      service: {
        ...service.service,
        state: service.state,
        detail: service.detail,
        lastError: service.lastError
      },
      tunnel,
      health: service.health,
      urls: urlsFor(this.config),
      lastError: service.lastError || tunnel.error || null
    };
  }

  async start() {
    const serviceResult = await this.service.start({ manual: true });
    if (serviceResult.ok && this.config?.tunnel?.enabled) {
      await this.tunnel.start();
    }
    return serviceResult;
  }

  async stop() {
    await this.tunnel.stop({ silent: true });
    return this.service.stop();
  }

  async restart() {
    await this.tunnel.stop({ silent: true });
    const result = await this.service.restart();
    if (result.ok && this.config?.tunnel?.enabled) await this.tunnel.start();
    return result;
  }

  async dispose() {
    await this.tunnel.dispose();
    await this.service.dispose();
  }
}

module.exports = { RuntimeManager, overallState, stateLabel };
