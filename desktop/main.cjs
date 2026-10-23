"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard, dialog, Notification, powerMonitor, nativeTheme } = require("electron");

const {
  configPath,
  loadConfig,
  saveConfig,
  publicConfig,
  defaultConfig,
  mergeConfig,
  validateConfig,
  detectCodexHomes,
  generateAccessCode,
  findNodePath,
  logDirFor,
  urlsFor,
  maskAccessCode,
  normalizeExtraDevices,
  slugifyDeviceId,
  lanAddress,
  APP_DIR
} = require("./service/config.cjs");
const { LogBuffer } = require("./service/logger.cjs");
const { RuntimeManager } = require("./service/runtime.cjs");
const { generatePairing, savePairingPng, listPairingTargets } = require("./service/pairing.cjs");
const { checkDebugEvents, checkThreads, requestJson } = require("./service/health.cjs");
const { stopLegacySupervisor } = require("./service/legacy.cjs");

const APP_ID = "com.codex.turnloom.console";
const APP_NAME = "Codex-Turnloom 控制台";
const APP_VERSION = require("../package.json").version;
const isDev = !app.isPackaged;
const cliArgs = process.argv.slice(app.isPackaged ? 1 : 2);
const cli = new Set(cliArgs);
const startHidden = cli.has("--hidden") || cli.has("--start-minimized");
const smokeTest = cli.has("--smoke-test");

let mainWindow = null;
let setupWindow = null;
let tray = null;
let runtime = null;
let logger = null;
let configState = null;
let tasks = [];
let taskTimer = null;
let logFlushTimer = null;
let pendingLogs = [];
let idleDestroyTimer = null;
let isQuitting = false;
let quitPromise = null;
let lastRightClickAt = 0;
let lastState = null;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow("overview");
  });
  registerIpc();
  app.whenReady().then(bootstrap).catch((error) => {
    console.error("[app] bootstrap failed", error);
    app.quit();
  });
}

function currentConfig() {
  return configState?.config || null;
}

function runtimeSnapshot() {
  if (runtime) return runtime.snapshot();
  return {
    state: "stopped",
    label: "已停止",
    detail: "服务未启动",
    service: { pid: null, startedAt: null, uptimeMs: 0, memoryBytes: 0, restartCount: 0, restartAttempt: 0 },
    health: { ok: false, lastCheckAt: null, latencyMs: 0, ipcConnected: false, ipcCheckedAt: null, info: null },
    tunnel: { enabled: false, state: "disabled", pid: null, attempts: 0, nextRetryAt: null, error: null },
    urls: { lan: "", publicUrl: "", browser: "", preview: "" },
    lastError: null
  };
}

function statePayload() {
  return {
    runtime: runtimeSnapshot(),
    config: publicConfig(currentConfig())
  };
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function sendState() {
  const payload = statePayload();
  sendToRenderer("state:changed", payload);
  updateTray(payload.runtime);
}

async function bootstrap() {
  configState = loadConfig();
  if (!configState.config) {
    createTray();
    createSetupWindow();
    if (smokeTest) finishSmokeTest("needs-setup");
    return;
  }

  initLogger();
  if (runtime) await runtime.dispose();
  runtime = new RuntimeManager({ config: configState.config, logger });
  runtime.on("changed", (snapshot) => {
    const previousState = lastState?.state;
    lastState = snapshot;
    sendState();
    if (["running", "degraded"].includes(snapshot.state) && previousState !== snapshot.state) {
      refreshTasks(true).catch(() => {});
    }
    if (snapshot.state === "error" && snapshot.lastError) {
      notify("服务启动失败", snapshot.lastError);
    }
  });
  runtime.on("alert", (alert) => notify(alert.title || "服务异常", alert.message || ""));

  const migration = await stopLegacySupervisor(configState.config, logger).catch((error) => {
    logger.warn("migration", `旧版迁移检查失败：${error.message}`);
    return { migrated: false };
  });
  if (migration.migrated) {
    try {
      configState.config = saveConfig(configState.config);
    } catch {}
  }

  createTray();
  applyTheme(configState.config.console?.theme || "system");
  applyLoginItem(configState.config);

  if (configState.config.console?.autoStart) {
    runtime.start().catch((error) => logger.error("service", `自动启动失败：${error.message}`));
  }

  if (!startHidden || smokeTest) {
    createMainWindow();
    showWindow("overview");
  }

  if (smokeTest) {
    setTimeout(() => finishSmokeTest("ready"), 1200);
  }
}

function initLogger() {
  if (logger) logger.close();
  logger = new LogBuffer({
    logDir: logDirFor(configState.config),
    secrets: [configState.config.accessCode]
  });
  logger.on("line", (entry) => {
    pendingLogs.push(entry);
    if (pendingLogs.length > 200) pendingLogs = pendingLogs.slice(-200);
  });
  clearInterval(logFlushTimer);
  logFlushTimer = setInterval(() => {
    if (!pendingLogs.length) return;
    if (mainWindow && mainWindow.isVisible()) {
      const batch = pendingLogs.splice(0, pendingLogs.length);
      sendToRenderer("logs:appended", batch);
    } else {
      pendingLogs = pendingLogs.slice(-200);
    }
  }, 350);
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#F4F7FB",
    title: APP_NAME,
    icon: iconPath("app"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (!startHidden || smokeTest) mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    const behavior = currentConfig()?.console?.closeBehavior || "tray";
    if (behavior === "tray") {
      event.preventDefault();
      hideWindow();
    } else {
      event.preventDefault();
      quitApp();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });
  return mainWindow;
}

function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
    return setupWindow;
  }
  setupWindow = new BrowserWindow({
    width: 880,
    height: 604,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: "#EDF2F9",
    title: `${APP_NAME} · 初始设置`,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  setupWindow.loadFile(path.join(__dirname, "renderer", "setup.html"));
  setupWindow.once("ready-to-show", () => setupWindow.show());
  setupWindow.on("closed", () => {
    setupWindow = null;
    if (isQuitting) return;
    if (mainWindow) return;
    if (currentConfig()) {
      createMainWindow();
      showWindow("overview");
    } else {
      quitApp();
    }
  });
  return setupWindow;
}

function showWindow(view = "overview") {
  clearTimeout(idleDestroyTimer);
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.setSkipTaskbar(false);
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("app:navigate", { view });
    });
  } else {
    win.webContents.send("app:navigate", { view });
  }
  refreshTasks(true);
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
  stopTaskLoop();
  clearTimeout(idleDestroyTimer);
  idleDestroyTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible() && !isQuitting) {
      mainWindow.destroy();
      mainWindow = null;
    }
  }, 10 * 60 * 1000);
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible()) hideWindow();
  else showWindow("overview");
}

function trayIconName(state) {
  if (state === "running") return "tray-running";
  if (state === "starting" || state === "restarting" || state === "stopping" || state === "degraded") return "tray-starting";
  if (state === "error") return "tray-error";
  return "tray-stopped";
}

function iconPath(name) {
  const ext = process.platform === "win32" && name === "app" ? "ico" : "png";
  return path.join(__dirname, "assets", `${name}.${ext}`);
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(iconPath("tray-stopped"));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip(`${APP_NAME} · 已停止`);
  tray.on("click", (event) => {
    if (event && event.button === "right") return;
    if (Date.now() - lastRightClickAt < 350) return;
    toggleWindow();
  });
  tray.on("double-click", () => showWindow("overview"));
  tray.on("right-click", () => {
    lastRightClickAt = Date.now();
    tray.popUpContextMenu(buildTrayMenu());
  });
  updateTray(runtimeSnapshot());
}

function buildTrayMenu() {
  const config = currentConfig();
  if (!config) {
    return Menu.buildFromTemplate([
      { label: "Codex-Turnloom 控制台", enabled: false },
      { label: "尚未完成初始设置", enabled: false },
      { type: "separator" },
      { label: "打开设置…", click: () => createSetupWindow() },
      { type: "separator" },
      { label: "退出控制台…", click: () => confirmQuit() }
    ]);
  }
  const snap = runtimeSnapshot();
  const running = ["running", "degraded"].includes(snap.state);
  const busy = ["starting", "restarting", "stopping"].includes(snap.state);
  const machine = config?.machineName || os.hostname();
  const uptime = formatDuration(snap.service?.uptimeMs || 0);
  const statusLine = `${machine} · ${snap.label}${snap.service?.uptimeMs ? ` · ${uptime}` : ""}`;
  return Menu.buildFromTemplate([
    { label: "Codex-Turnloom 控制台", enabled: false },
    { label: statusLine, enabled: false },
    { type: "separator" },
    { label: "打开控制台", click: () => showWindow("overview") },
    { label: "在浏览器中预览手机端", enabled: running, click: () => openPreview() },
    { label: "显示配对二维码", enabled: running, click: () => showWindow("pairing") },
    { type: "separator" },
    running
      ? { label: "重启服务", enabled: !busy, click: () => guardServiceAction(() => runtime.restart()) }
      : { label: "启动服务", enabled: !busy, click: () => guardServiceAction(() => runtime.start()) },
    { label: "停止服务", enabled: running && !busy, click: () => confirmStop() },
    { type: "separator" },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: Boolean(config?.console?.autoStart),
      click: (item) => setAutoStart(item.checked)
    },
    { label: "设置…", click: () => showWindow("settings") },
    { type: "separator" },
    { label: "退出控制台…", click: () => confirmQuit() }
  ]);
}

function updateTray(snapshot) {
  if (!tray) return;
  const state = snapshot?.state || "stopped";
  try {
    const image = nativeImage.createFromPath(iconPath(trayIconName(state)));
    if (!image.isEmpty()) tray.setImage(image);
  } catch {}
  const config = currentConfig();
  const machine = config?.machineName || os.hostname();
  const uptime = formatDuration(snapshot?.service?.uptimeMs || 0);
  tray.setToolTip(`${APP_NAME} · ${snapshot?.label || "已停止"}${snapshot?.service?.uptimeMs ? ` · ${machine} · ${uptime}` : ` · ${machine}`}`);
  tray.setContextMenu(null);
}

async function guardServiceAction(action) {
  if (!runtime) return;
  try {
    const result = await action();
    if (result && result.ok === false && result.error) notify("操作失败", result.error);
    sendState();
  } catch (error) {
    notify("操作失败", error.message);
  }
}

async function confirmStop() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showMessageBox(win, {
    type: "warning",
    title: "停止本机服务",
    message: "停止后，手机端将立即无法访问这台电脑。",
    detail: "Codex Desktop 和正在执行的任务不受影响。",
    buttons: ["停止服务", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0) await guardServiceAction(() => runtime.stop());
}

async function confirmQuit() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showMessageBox(win, {
    type: "warning",
    title: "退出 Codex-Turnloom 控制台",
    message: "退出后将停止本机服务和 SSH 隧道，手机端会立即断开。",
    detail: "Codex Desktop 和正在执行的任务不受影响。",
    buttons: ["退出并停止服务", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0) await quitApp();
}

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: title || APP_NAME, body: body || "", icon: iconPath("app") });
    notification.on("click", () => showWindow("overview"));
    notification.show();
  } catch {}
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${total % 60} 秒`;
  return `${total} 秒`;
}

function applyTheme(theme) {
  try {
    nativeTheme.themeSource = theme === "dark" ? "dark" : theme === "light" ? "light" : "system";
  } catch {}
}

function consoleTaskExists() {
  try {
    execFileSync("schtasks.exe", ["/Query", "/TN", "Codex-Turnloom Console"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function applyLoginItem(config) {
  if (process.env.TURNLOOM_SKIP_LOGIN_ITEM === "1") return;
  if (consoleTaskExists()) {
    if (!config?.console?.autoStart) {
      try {
        execFileSync("schtasks.exe", ["/Delete", "/TN", "Codex-Turnloom Console", "/F"], { stdio: "ignore", windowsHide: true });
      } catch {}
    }
    return;
  }
  try {
    const enabled = Boolean(config?.console?.autoStart);
    const args = app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"];
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args });
  } catch (error) {
    logger?.warn("app", `设置开机启动失败：${error.message}`);
  }
}

async function setAutoStart(enabled) {
  if (!configState?.config) return { ok: false };
  configState.config = mergeConfig(configState.config, { console: { autoStart: Boolean(enabled) } });
  configState.config = saveConfig(configState.config);
  applyLoginItem(configState.config);
  sendState();
  return { ok: true, config: publicConfig(configState.config) };
}

function openExternalSafe(url) {
  try {
    const parsed = new URL(String(url));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function openPreview() {
  const config = currentConfig();
  if (!config) return false;
  const urls = urlsFor(config);
  const base = String(urls.preview || urls.lan).replace(/\/+$/, "");
  const preview = `${base}/#login=${encodeURIComponent(config.accessCode)}`;
  return openExternalSafe(preview);
}

async function refreshTasks(force = false) {
  if (!runtime || !currentConfig()) return [];
  const snap = runtimeSnapshot();
  if (!["running", "degraded"].includes(snap.state)) {
    tasks = [];
    sendToRenderer("tasks:changed", { tasks, at: Date.now() });
    return tasks;
  }
  if (!force && (!mainWindow || !mainWindow.isVisible())) return tasks;
  const result = await checkThreads(currentConfig(), 5);
  if (!result.ok || !result.data) {
    if (result.status === 401) sendToRenderer("app:toast", { type: "error", message: "访问码不一致，请检查设置。" });
    return tasks;
  }
  tasks = (result.data.threads || []).slice(0, 5).map((thread) => ({
    id: thread.id,
    title: thread.title || "未命名任务",
    status: thread.status?.state || "unknown",
    interactionRequired: Boolean(thread.status?.interactionRequired),
    updatedAtMs: thread.updatedAtMs || null,
    project: thread.project?.name || ""
  }));
  sendToRenderer("tasks:changed", { tasks, at: Date.now() });
  return tasks;
}

function scheduleTaskLoop() {
  clearInterval(taskTimer);
  taskTimer = setInterval(() => {
    if (!mainWindow || !mainWindow.isVisible()) return;
    if (["running", "degraded"].includes(runtimeSnapshot().state)) refreshTasks(true).catch(() => {});
  }, 30000);
}

function stopTaskLoop() {
  clearInterval(taskTimer);
  taskTimer = null;
}

async function refreshIpcStatus() {
  if (!runtime || !currentConfig()) return;
  if (!mainWindow || !mainWindow.isVisible()) return;
  const result = await checkDebugEvents(currentConfig());
  if (result.ok && result.data) runtime.service.setIpcStatus(Boolean(result.data.ipcConnected));
}

async function quitApp() {
  if (quitPromise) return quitPromise;
  quitPromise = (async () => {
    isQuitting = true;
    clearTimeout(idleDestroyTimer);
    clearInterval(logFlushTimer);
    stopTaskLoop();
    try { tray?.destroy(); } catch {}
    tray = null;
    try { if (runtime) await runtime.dispose(); } catch {}
    try { logger?.close(); } catch {}
    try { if (setupWindow && !setupWindow.isDestroyed()) setupWindow.destroy(); } catch {}
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch {}
    app.exit(0);
  })();
  return quitPromise;
}

async function finishSmokeTest(label) {
  console.log(JSON.stringify({
    smoke: label,
    configPath: configPath(),
    hasConfig: Boolean(currentConfig()),
    state: runtimeSnapshot().state,
    platform: process.platform,
    electron: process.versions.electron
  }));
  setTimeout(() => quitApp(), 250);
}

function registerIpc() {
  ipcMain.handle("app:bootstrap", async () => ({
    needsSetup: !currentConfig(),
    config: publicConfig(currentConfig()),
    runtime: runtimeSnapshot(),
    tasks,
    logs: logger ? logger.getLines(400) : [],
    app: {
      version: APP_VERSION,
      electron: process.versions.electron,
      platform: process.platform,
      configPath: configPath(),
      appPath: APP_DIR
    }
  }));

  ipcMain.handle("runtime:state", async () => statePayload());
  ipcMain.handle("runtime:tasks", async () => ({ tasks, at: Date.now() }));
  ipcMain.handle("tasks:refresh", async () => ({ tasks: await refreshTasks(true), at: Date.now() }));
  ipcMain.handle("logs:get", async (_event, opts = {}) => logger ? logger.getLines(opts.limit || 400) : []);

  ipcMain.handle("service:start", async () => { await guardServiceAction(() => runtime.start()); return statePayload(); });
  ipcMain.handle("service:stop", async () => { await guardServiceAction(() => runtime.stop()); return statePayload(); });
  ipcMain.handle("service:restart", async () => { await guardServiceAction(() => runtime.restart()); return statePayload(); });

  ipcMain.handle("config:save", async (_event, patch = {}) => {
    if (!currentConfig()) return { ok: false, errors: [{ field: "config", message: "尚未完成初始设置。" }] };
    const clean = JSON.parse(JSON.stringify(patch || {}));
    if (clean.accessCode && /^•+$/.test(String(clean.accessCode))) delete clean.accessCode;
    if (clean.accessCode !== undefined && !String(clean.accessCode).trim()) delete clean.accessCode;
    let next = mergeConfig(currentConfig(), clean);
    const errors = validateConfig(next);
    if (errors.length) return { ok: false, errors };
    try {
      next = saveConfig(next);
      configState.config = next;
      logger.setSecrets([next.accessCode, ...(next.extraDevices || []).map((device) => device.accessCode)]);
      runtime.setConfig(next);
      applyTheme(next.console?.theme || "system");
      applyLoginItem(next);
      const wasActive = ["running", "starting", "degraded", "restarting"].includes(runtimeSnapshot().state);
      if (wasActive) await runtime.restart();
      sendState();
      return { ok: true, config: publicConfig(next), runtime: runtimeSnapshot() };
    } catch (error) {
      return { ok: false, errors: [{ field: "config", message: error.message }] };
    }
  });

  ipcMain.handle("config:autoStart", async (_event, enabled) => setAutoStart(Boolean(enabled)));

  ipcMain.handle("pairing:get", async (_event, deviceId = "local") => {
    if (!currentConfig()) return { ok: false, error: "尚未完成初始设置。" };
    try {
      const config = currentConfig();
      const pairing = await generatePairing(config, deviceId);
      return { ok: true, ...pairing, accessCodeMasked: maskAccessCode(config.accessCode) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("pairing:save", async (_event, deviceId = "local") => {
    if (!currentConfig()) return { ok: false };
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const config = currentConfig();
    const target = listPairingTargets(config).find((item) => item.id === deviceId);
    const safeName = String(target?.name || config.machineName || "device").replace(/[\\/:*?"<>|]/g, "-");
    const result = await dialog.showSaveDialog(win, {
      title: "保存配对二维码",
      defaultPath: `Codex-Turnloom-${safeName}.png`,
      filters: [{ name: "PNG 图片", extensions: ["png"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await savePairingPng(config, result.filePath, deviceId);
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("devices:list", async () => {
    const config = currentConfig();
    return {
      ok: Boolean(config),
      devices: listPairingTargets(config || {}),
      extraDevices: publicConfig(config)?.extraDevices || []
    };
  });

  ipcMain.handle("devices:add", async (_event, input = {}) => {
    const config = currentConfig();
    if (!config) return { ok: false, error: "尚未完成初始设置。" };
    const name = String(input.name || "").trim();
    const url = String(input.url || "").trim().replace(/\/+$/, "");
    const accessCode = String(input.accessCode || "").trim();
    if (!name || !url || !accessCode) return { ok: false, error: "名称、地址和访问码都要填写。" };
    if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: "地址需以 http:// 或 https:// 开头。" };
    const next = mergeConfig(config, {
      extraDevices: [
        ...(config.extraDevices || []),
        {
          id: slugifyDeviceId(input.id || name, `device-${(config.extraDevices || []).length + 1}`),
          name,
          url,
          accessCode,
          kind: String(input.kind || "turnloom")
        }
      ]
    });
    const errors = validateConfig(next);
    if (errors.length) return { ok: false, errors, error: errors[0].message };
    try {
      const saved = saveConfig(next);
      configState.config = saved;
      logger?.setSecrets([saved.accessCode, ...(saved.extraDevices || []).map((device) => device.accessCode)]);
      sendState();
      return { ok: true, config: publicConfig(saved) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("devices:remove", async (_event, id) => {
    const config = currentConfig();
    if (!config) return { ok: false, error: "尚未完成初始设置。" };
    const targetId = String(id || "");
    const next = mergeConfig(config, {
      extraDevices: (config.extraDevices || []).filter((device) => device.id !== targetId)
    });
    try {
      const saved = saveConfig(next);
      configState.config = saved;
      sendState();
      return { ok: true, config: publicConfig(saved) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("devices:probe", async () => {
    const config = currentConfig();
    if (!config) return { ok: false, devices: [] };
    const targets = listPairingTargets(config);
    const results = await Promise.all(targets.map(async (target) => {
      const device = target.isLocal ? null : (config.extraDevices || []).find((item) => item.id === target.id);
      const token = target.isLocal ? config.accessCode : device?.accessCode || "";
      const base = target.isLocal ? `http://127.0.0.1:${Number(config.port) || 8787}` : target.url;
      const health = await requestJson(`${base}/api/health`, { token, timeoutMs: 2500 });
      let threadCount = null;
      if (health.ok) {
        const threads = await requestJson(`${base}/api/threads?limit=1`, { token, timeoutMs: 4000 });
        if (threads.ok && threads.data) {
          threadCount = Number.isFinite(Number(threads.data.total))
            ? Number(threads.data.total)
            : Array.isArray(threads.data.threads) ? threads.data.threads.length : null;
        }
      }
      return {
        id: target.id,
        name: target.name,
        isLocal: target.isLocal,
        online: Boolean(health.ok && health.data?.ok !== false),
        status: health.status || 0,
        latencyMs: health.latencyMs || 0,
        version: health.data?.appVersionName || "",
        threadCount,
        error: health.ok ? "" : health.error || `HTTP ${health.status || 0}`
      };
    }));
    return { ok: true, devices: results, at: Date.now() };
  });

  ipcMain.handle("devices:detect", async () => {
    const home = path.join(os.homedir(), ".pidesktop-turnloom");
    const stateDb = path.join(home, "state_5.sqlite");
    const pipePath = "\\\\.\\pipe\\pidesktop-codex-ipc";
    const facade = fs.existsSync(stateDb);
    const pipeReady = process.platform === "win32" ? fs.existsSync(pipePath) : false;
    const port = 8799;
    const probe = await requestJson(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 1500 });
    const listening = probe.status > 0;
    return {
      ok: true,
      name: "PI-Desktop",
      home,
      ipcSocket: pipePath,
      port,
      url: `http://${lanAddress()}:${port}`,
      facade,
      pipeReady,
      listening,
      ready: facade && listening && pipeReady
    };
  });

  ipcMain.handle("logs:export", async () => {
    if (!logger) return { ok: false };
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const result = await dialog.showSaveDialog(win, {
      title: "导出运行日志",
      defaultPath: `Codex-Turnloom-logs-${stamp}.txt`,
      filters: [{ name: "文本文件", extensions: ["txt"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, logger.exportText(2000), "utf8");
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("shell:openPath", async (_event, kind) => {
    const config = currentConfig();
    const target = kind === "logs" ? logDirFor(config) : kind === "config" ? path.dirname(configPath()) : kind === "codex" ? config?.codexHome : "";
    if (!target) return { ok: false };
    const error = await shell.openPath(target);
    return { ok: !error, error };
  });

  ipcMain.handle("shell:openExternal", async (_event, url) => ({ ok: openExternalSafe(url) }));
  ipcMain.handle("shell:openPreview", async () => ({ ok: openPreview() }));

  ipcMain.handle("clipboard:write", async (_event, text) => {
    const value = String(text || "");
    if (!value || value.length > 100000) return { ok: false };
    clipboard.writeText(value);
    return { ok: true };
  });

  ipcMain.handle("dialog:choosePath", async (_event, kind) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const fileKind = kind === "key" || kind === "known_hosts";
    const result = await dialog.showOpenDialog(win, {
      properties: fileKind ? ["openFile"] : ["openDirectory"]
    });
    return { ok: !result.canceled && result.filePaths.length > 0, path: result.filePaths[0] || "" };
  });

  ipcMain.handle("window:minimize", () => { (mainWindow || setupWindow)?.minimize(); });
  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle("window:close", () => { (mainWindow || setupWindow)?.close(); });

  ipcMain.handle("app:quit", async () => { await quitApp(); return { ok: true }; });
  ipcMain.handle("app:openPreview", async () => ({ ok: openPreview() }));

  ipcMain.handle("setup:detect", async () => {
    const homes = detectCodexHomes();
    return {
      homes,
      machineName: os.hostname(),
      defaultPort: 8787,
      accessCode: generateAccessCode(),
      nodePath: findNodePath(),
      repoRoot: APP_DIR,
      logDir: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodexPocket", "logs")
    };
  });

  ipcMain.handle("setup:create", async (_event, input = {}) => {
    try {
      const config = defaultConfig({
        machineName: input.machineName || os.hostname(),
        codexHome: input.codexHome,
        port: Number(input.port) || 8787,
        accessCode: input.accessCode || generateAccessCode(),
        publicUrl: input.publicUrl || "",
        extraDevices: Array.isArray(input.extraDevices) ? input.extraDevices : [],
        console: {
          autoStart: Boolean(input.autoStart),
          startMinimized: Boolean(input.startMinimized),
          closeBehavior: "tray",
          theme: "system",
          logLevel: "info",
          logRetentionDays: 7
        }
      });
      const errors = validateConfig(config);
      if (errors.length) return { ok: false, errors };
      configState = { exists: true, path: configPath(), config: saveConfig(config) };
      initLogger();
      runtime = new RuntimeManager({ config: configState.config, logger });
      runtime.on("changed", () => sendState());
      runtime.on("alert", (alert) => notify(alert.title || "服务异常", alert.message || ""));
      applyLoginItem(configState.config);
      createTray();
      const started = await runtime.start();
      if (!started.ok) {
        return { ok: false, errors: [{ field: "service", message: started.error || "服务启动失败，请查看日志。" }] };
      }
      return { ok: true, config: publicConfig(configState.config), runtime: runtimeSnapshot() };
    } catch (error) {
      return { ok: false, errors: [{ field: "config", message: error.message }] };
    }
  });

  ipcMain.handle("setup:openConsole", async () => {
    if (!mainWindow) createMainWindow();
    showWindow("overview");
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.destroy();
    return { ok: true };
  });
}

app.on("before-quit", (event) => {
  if (!isQuitting) {
    event.preventDefault();
    quitApp();
  }
});

app.on("window-all-closed", () => {
  // Tray apps stay alive when every BrowserWindow is hidden or destroyed.
});

app.on("activate", () => showWindow("overview"));

app.whenReady().then(() => {
  // IPC handlers are registered before bootstrap.
  powerMonitor.on("resume", () => {
    showWindowIfVisible();
    refreshIpcStatus().catch(() => {});
    refreshTasks(true).catch(() => {});
  });
  powerMonitor.on("unlock-screen", () => {
    refreshIpcStatus().catch(() => {});
    refreshTasks(true).catch(() => {});
  });
  nativeTheme.on("updated", () => {
    sendToRenderer("app:theme", { dark: nativeTheme.shouldUseDarkColors });
  });
});

function showWindowIfVisible() {
  if (mainWindow && mainWindow.isVisible()) showWindow("overview");
}

// Start the 30s task loop when the window becomes visible, and stop it when hidden.
const originalShowWindow = showWindow;
showWindow = function patchedShowWindow(view = "overview") {
  originalShowWindow(view);
  scheduleTaskLoop();
  setTimeout(() => { refreshIpcStatus().catch(() => {}); }, 300);
};
