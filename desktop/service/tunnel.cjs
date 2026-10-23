"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { splitLines } = require("./logger.cjs");
const { execFileAsync } = require("./health.cjs");

const MAX_BACKOFF_MS = 300000;

function tunnelBackoff(attempt) {
  return Math.min(MAX_BACKOFF_MS, Math.pow(2, Math.min(7, attempt)));
}

class TunnelController extends EventEmitter {
  constructor({ config, logger }) {
    super();
    this.config = config;
    this.logger = logger;
    this.state = config?.tunnel?.enabled ? "stopped" : "disabled";
    this.child = null;
    this.pid = 0;
    this.attempts = 0;
    this.nextRetryAt = 0;
    this.lastError = null;
    this.stopping = false;
    this.retryTimer = null;
    this.connectedTimer = null;
    this._stdoutBuffer = "";
    this._stderrBuffer = "";
  }

  setConfig(config) {
    this.config = config;
    if (!config?.tunnel?.enabled && this.state !== "disabled") {
      this.state = "disabled";
    }
  }

  snapshot() {
    return {
      enabled: Boolean(this.config?.tunnel?.enabled),
      state: this.state,
      pid: this.pid || null,
      attempts: this.attempts,
      nextRetryAt: this.nextRetryAt || null,
      error: this.lastError
    };
  }

  setState(state, error) {
    this.state = state;
    if (error !== undefined) this.lastError = error;
    this.emit("changed", this.snapshot());
  }

  sshPath() {
    return path.join(process.env.WINDIR || "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
  }

  async start() {
    if (!this.config?.tunnel?.enabled) {
      this.setState("disabled", null);
      return { ok: true, disabled: true };
    }
    if (this.child) return { ok: this.state === "connected" };
    this.stopping = false;
    this.setState("connecting", null);
    try {
      const ssh = this.sshPath();
      if (!require("node:fs").existsSync(ssh)) {
        const message = "未找到 Windows OpenSSH 客户端（ssh.exe）。";
        this.lastError = message;
        this.setState("error", message);
        return { ok: false, error: message };
      }
      const tunnel = this.config.tunnel;
      const target = `${tunnel.user}@${tunnel.host}`;
      const forward = `127.0.0.1:${tunnel.remotePort}:127.0.0.1:${this.config.port}`;
      const args = [
        "-i", tunnel.keyPath,
        "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "StrictHostKeyChecking=yes",
        "-o", `UserKnownHostsFile=${tunnel.knownHostsPath}`,
        "-N", "-R", forward,
        target
      ];
      this.logger.info("tunnel", `连接 SSH 隧道：${target}，远端端口 ${tunnel.remotePort}`, "tunnel-out.log");
      this.child = spawn(ssh, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.pid = this.child.pid || 0;
      this._stdoutBuffer = "";
      this._stderrBuffer = "";
      this.child.stdout?.setEncoding("utf8");
      this.child.stderr?.setEncoding("utf8");
      this.child.stdout?.on("data", (chunk) => {
        this._stdoutBuffer = splitLines(this._stdoutBuffer, chunk, (line) => this.logger.info("tunnel", line, "tunnel-out.log"));
      });
      this.child.stderr?.on("data", (chunk) => {
        this._stderrBuffer = splitLines(this._stderrBuffer, chunk, (line) => this.logger.warn("tunnel", line, "tunnel-error.log"));
      });
      this.child.on("error", (error) => {
        this.lastError = `SSH 启动失败：${error.message}`;
        this.logger.error("tunnel", this.lastError);
      });
      this.child.on("exit", (code, signal) => {
        const expected = this.stopping;
        this.child = null;
        this.pid = 0;
        clearTimeout(this.connectedTimer);
        if (expected) return;
        this.lastError = `SSH 隧道断开（code ${code ?? signal ?? "?"}）`;
        this.logger.warn("tunnel", this.lastError);
        this.scheduleRetry();
      });
      this.connectedTimer = setTimeout(() => {
        if (this.child && !this.stopping) {
          this.attempts = 0;
          this.nextRetryAt = 0;
          this.setState("connected", null);
          this.logger.info("tunnel", `SSH 隧道已建立：${target}`);
        }
      }, 2000);
      return { ok: true };
    } catch (error) {
      this.lastError = error.message;
      this.setState("error", error.message);
      return { ok: false, error: error.message };
    }
  }

  scheduleRetry() {
    if (this.stopping || this.retryTimer) return;
    this.attempts += 1;
    const delay = tunnelBackoff(this.attempts);
    this.nextRetryAt = Date.now() + delay;
    this.setState("retrying", this.lastError);
    this.logger.warn("tunnel", `SSH 隧道 ${Math.round(delay / 1000)} 秒后重试（第 ${this.attempts} 次）。`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start().catch(() => {});
    }, delay);
  }

  async stop({ silent = false } = {}) {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectedTimer);
    this.retryTimer = null;
    this.connectedTimer = null;
    const child = this.child;
    const pid = this.pid;
    if (!child && !pid) {
      if (this.config?.tunnel?.enabled) this.setState("stopped", null);
      else this.setState("disabled", null);
      this.stopping = false;
      return;
    }
    try { child?.kill(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (pid) await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeout: 4000 });
    this.child = null;
    this.pid = 0;
    this.attempts = 0;
    this.nextRetryAt = 0;
    if (!silent) this.logger.info("tunnel", "SSH 隧道已停止。");
    this.setState(this.config?.tunnel?.enabled ? "stopped" : "disabled", null);
    this.stopping = false;
  }

  async restart() {
    await this.stop({ silent: true });
    return this.start();
  }

  async dispose() {
    await this.stop({ silent: true });
    this.removeAllListeners();
  }
}

module.exports = { TunnelController, tunnelBackoff, MAX_BACKOFF_MS };
