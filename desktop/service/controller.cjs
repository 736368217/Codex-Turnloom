"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
function healthSummary(data) {
  if (!data) return null;
  return {
    ok: Boolean(data.ok),
    codexHome: data.codexHome || "",
    ipcSocket: data.codexIpcSocket || "",
    allowWrite: Boolean(data.allowWrite),
    authRequired: Boolean(data.authRequired),
    sqliteDriver: data.sqliteDriver || null,
    appVersionName: data.appVersionName || ""
  };
}
const { splitLines } = require("./logger.cjs");
const { checkHealth, checkPortAvailable, findPortOwner, getProcessMetrics, execFileAsync } = require("./health.cjs");

const MAX_RESTARTS = 5;

function backoffDelay(attempt) {
  return [1000, 2000, 4000, 8000, 16000, 30000][Math.min(attempt - 1, 5)] || 30000;
}

class ServiceController extends EventEmitter {
  constructor({ config, logger }) {
    super();
    this.config = config;
    this.logger = logger;
    this.state = "stopped";
    this.detail = "服务未启动";
    this.child = null;
    this.pid = 0;
    this.startedAt = 0;
    this.health = { ok: false, lastCheckAt: 0, latencyMs: 0, ipcConnected: false, ipcCheckedAt: 0, info: null };
    this.lastError = null;
    this.restartAttempt = 0;
    this.restartCount = 0;
    this.healthFailures = 0;
    this.healthTimer = null;
    this.metricsTimer = null;
    this.restartTimer = null;
    this.intendedStop = false;
    this.starting = false;
    this.stopping = false;
    this.memoryBytes = 0;
    this._stdoutBuffer = "";
    this._stderrBuffer = "";
  }

  setConfig(config) {
    this.config = config;
  }

  setState(state, detail, extra = {}) {
    this.state = state;
    if (detail) this.detail = detail;
    if (extra.lastError !== undefined) this.lastError = extra.lastError;
    this.emit("changed", this.snapshot());
  }

  setIpcStatus(connected) {
    this.health.ipcConnected = Boolean(connected);
    this.health.ipcCheckedAt = Date.now();
    this.emit("changed", this.snapshot());
  }

  snapshot() {
    const now = Date.now();
    return {
      state: this.state,
      detail: this.detail,
      service: {
        pid: this.pid || null,
        startedAt: this.startedAt || null,
        uptimeMs: this.startedAt ? Math.max(0, now - this.startedAt) : 0,
        memoryBytes: this.memoryBytes || 0,
        restartCount: this.restartCount,
        restartAttempt: this.restartAttempt
      },
      health: {
        ok: Boolean(this.health.ok),
        lastCheckAt: this.health.lastCheckAt || null,
        latencyMs: this.health.latencyMs || 0,
        ipcConnected: Boolean(this.health.ipcConnected),
        ipcCheckedAt: this.health.ipcCheckedAt || null,
        info: this.health.info || null
      },
      lastError: this.lastError
    };
  }

  async start({ manual = true } = {}) {
    if (this.child || this.starting) return { ok: this.state === "running", state: this.state };
    this.starting = true;
    this.intendedStop = false;
    this.lastError = null;
    this.setState(manual ? "starting" : "restarting", manual ? "正在启动本机服务…" : "正在重新启动服务…");

    try {
      const validationError = this.validateRuntime();
      if (validationError) {
        this.starting = false;
        this.lastError = validationError;
        this.setState("error", validationError);
        return { ok: false, error: validationError };
      }

      const port = await checkPortAvailable(this.config.port, this.config.host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1");
      if (!port.available) {
        const owner = await findPortOwner(this.config.port);
        const message = owner
          ? `端口 ${this.config.port} 已被 ${owner.name || "其他程序"}（PID ${owner.pid}）占用。`
          : `端口 ${this.config.port} 已被其他程序占用。`;
        this.lastError = message;
        this.setState("error", message);
        this.starting = false;
        return { ok: false, error: message, portOwner: owner };
      }

      this.spawnChild();
      this.startedAt = Date.now();
      const healthy = await this.waitForHealthy(15000);
      if (!healthy.ok) {
        const message = this.lastError || healthy.error || "服务启动超时，未通过健康检查。";
        this.lastError = message;
        await this.killChild();
        this.startedAt = 0;
        this.setState("error", message);
        this.starting = false;
        return { ok: false, error: message };
      }

      this.health = {
        ok: true,
        lastCheckAt: Date.now(),
        latencyMs: healthy.latencyMs || 0,
        ipcConnected: this.health.ipcConnected || false,
        ipcCheckedAt: this.health.ipcCheckedAt || null,
        info: healthSummary(healthy.data)
      };
      this.restartAttempt = 0;
      this.healthFailures = 0;
      this.setState("running", "手机端可以访问");
      this.startHealthLoop();
      this.startMetricsLoop();
      this.starting = false;
      this.logger.info("service", `服务已启动，监听 ${this.config.host}:${this.config.port}`);
      return { ok: true };
    } catch (error) {
      this.starting = false;
      this.lastError = error.message;
      this.setState("error", `启动失败：${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  validateRuntime() {
    if (!this.config) return "配置文件不存在。";
    if (!this.config.nodePath) return "未配置 node.exe 路径。";
    if (!this.config.repoRoot || !require("node:fs").existsSync(path.join(this.config.repoRoot, "server.js"))) {
      return "找不到 server.js，请检查安装目录。";
    }
    if (!this.config.codexHome) return "未配置 Codex 数据目录。";
    return null;
  }

  spawnChild() {
    const serverPath = path.join(this.config.repoRoot, "server.js");
    const args = [
      serverPath,
      "--host", this.config.host,
      "--port", String(this.config.port),
      "--password", this.config.accessCode,
      "--codex-home", this.config.codexHome
    ];
    if (this.config.ipcSocket) args.push("--ipc-socket", this.config.ipcSocket);
    if (this.config.publicUrl) args.push("--public-url", this.config.publicUrl);
    if (this.config.readonly) args.push("--readonly");

    this.logger.info("service", `启动服务：${this.config.nodePath} ${serverPath}（端口 ${this.config.port}）`, "server-out.log");
    this.child = spawn(this.config.nodePath, args, {
      cwd: this.config.repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: this.config.codexHome }
    });
    this.pid = this.child.pid || 0;
    this._stdoutBuffer = "";
    this._stderrBuffer = "";
    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk) => {
      this._stdoutBuffer = splitLines(this._stdoutBuffer, chunk, (line) => {
        this.logger.info("service", line, "server-out.log");
      });
    });
    this.child.stderr?.on("data", (chunk) => {
      this._stderrBuffer = splitLines(this._stderrBuffer, chunk, (line) => {
        this.logger.error("service", line, "server-error.log");
      });
    });
    this.child.on("error", (error) => {
      this.lastError = `无法启动 node.exe：${error.message}`;
      this.logger.error("service", this.lastError);
    });
    this.child.on("exit", (code, signal) => {
      const wasExpected = this.intendedStop || this.stopping;
      const wasStarting = this.state === "starting" || this.state === "restarting";
      this.pid = 0;
      this.child = null;
      this.startedAt = 0;
      if (wasExpected) return;
      if (wasStarting) {
        this.starting = false;
        this.lastError = this.lastError || `服务进程退出（code ${code ?? "?"}）`;
        this.setState("error", this.lastError);
        return;
      }
      if (this.state === "running" || this.state === "degraded") {
        this.logger.warn("service", `服务进程意外退出（code ${code ?? "?"}），准备重启。`);
        this.scheduleRestart();
      }
    });
  }

  async waitForHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      if (!this.child) return { ok: false, error: this.lastError || "服务进程已退出。" };
      last = await checkHealth(this.config, { timeoutMs: 1500 });
      if (last.ok) return last;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return last || { ok: false, error: "等待服务响应超时。" };
  }

  startHealthLoop() {
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => { this.probeHealth().catch(() => {}); }, 5000);
  }

  async probeHealth() {
    if (!this.child || this.intendedStop) return;
    const result = await checkHealth(this.config, { timeoutMs: 2500 });
    this.health.lastCheckAt = Date.now();
    this.health.latencyMs = result.latencyMs || 0;
    this.health.info = healthSummary(result.data) || this.health.info;
    if (result.ok) {
      this.healthFailures = 0;
      this.health.ok = true;
      if (this.state === "degraded") this.setState("running", "手机端可以访问");
      return;
    }
    this.healthFailures += 1;
    this.health.ok = false;
    if (this.healthFailures === 3 && this.state === "running") {
      this.setState("degraded", "服务响应异常，正在重试…");
      this.logger.warn("service", `健康检查连续失败：${result.error || result.status}`);
    }
    if (this.healthFailures >= 6) {
      this.logger.error("service", "健康检查连续失败，重启服务。");
      this.restart();
    }
  }

  startMetricsLoop() {
    clearInterval(this.metricsTimer);
    const tick = async () => {
      if (!this.pid) return;
      const metrics = await getProcessMetrics(this.pid);
      if (metrics) {
        this.memoryBytes = metrics.memoryBytes;
        this.emit("changed", this.snapshot());
      }
    };
    tick().catch(() => {});
    this.metricsTimer = setInterval(() => { tick().catch(() => {}); }, 10000);
  }

  scheduleRestart() {
    if (this.restartTimer || this.intendedStop) return;
    this.restartAttempt += 1;
    this.restartCount += 1;
    if (this.restartAttempt > MAX_RESTARTS) {
      this.setState("error", "服务连续启动失败，请查看日志后手动重试。");
      this.logger.error("service", "达到最大重启次数，停止自动重启。");
      this.emit("alert", { type: "error", title: "服务启动失败", message: "自动重启已停止，请打开控制台查看日志。" });
      return;
    }
    const delay = backoffDelay(this.restartAttempt);
    this.setState("restarting", `服务异常退出，${Math.round(delay / 1000)} 秒后重试（第 ${this.restartAttempt} 次）`);
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      const result = await this.start({ manual: false });
      if (!result.ok) this.scheduleRestart();
    }, delay);
  }

  async restart() {
    await this.stop({ silent: true });
    this.restartAttempt = 0;
    return this.start({ manual: true });
  }

  async stop({ silent = false } = {}) {
    if (this.stopping) return;
    this.stopping = true;
    this.intendedStop = true;
    clearInterval(this.healthTimer);
    clearInterval(this.metricsTimer);
    clearTimeout(this.restartTimer);
    this.healthTimer = null;
    this.metricsTimer = null;
    this.restartTimer = null;
    if (!this.child && this.state !== "running" && this.state !== "degraded" && this.state !== "starting") {
      this.setState("stopped", "服务未启动", { lastError: null });
      this.stopping = false;
      return;
    }
    this.setState("stopping", "正在停止服务…");
    await this.killChild();
    this.pid = 0;
    this.startedAt = 0;
    this.memoryBytes = 0;
    this.health = { ok: false, lastCheckAt: 0, latencyMs: 0, ipcConnected: false, ipcCheckedAt: 0, info: null };
    this.healthFailures = 0;
    this.restartAttempt = 0;
    this.stopping = false;
    if (!silent) this.logger.info("service", "服务已停止。");
    this.setState("stopped", "服务未启动", { lastError: null });
  }

  async killChild() {
    const child = this.child;
    const pid = this.pid;
    if (!child && !pid) return;
    try { child?.kill(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (pid) {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeout: 4000 });
    }
    this.child = null;
    this.pid = 0;
  }

  async dispose() {
    await this.stop({ silent: true });
    this.removeAllListeners();
  }
}

module.exports = { ServiceController, backoffDelay, MAX_RESTARTS };
