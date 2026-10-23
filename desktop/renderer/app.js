"use strict";

(() => {
  const HAS_BRIDGE = Boolean(window.turnloom && typeof window.turnloom.bootstrap === "function");
  const api = HAS_BRIDGE ? window.turnloom : createDemoApi();
  if (!HAS_BRIDGE) window.turnloom = api;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const TASK_STATUS = {
    running: { label: "运行中", tone: "ok", pulse: "" },
    waiting: { label: "等待处理", tone: "warn", pulse: "amber" },
    ended: { label: "已结束", tone: "muted", pulse: "gray" },
    unknown: { label: "状态未知", tone: "muted", pulse: "gray" }
  };
  const SERVICE_SOURCES = new Set(["service", "config", "health", "ipc", "http", "log", "supervisor", "server"]);
  const VIEWS = new Set(["overview", "pairing", "logs", "settings", "about"]);
  const MAX_DOM_LOGS = 500;
  const MAX_STATE_LOGS = 2000;

  const state = {
    runtime: null,
    config: null,
    app: null,
    tasks: [],
    tasksSignature: "",
    logs: [],
    logBuffer: [],
    logFilter: "all",
    logSearch: "",
    logSearchTimer: 0,
    paused: false,
    activityTab: "tasks",
    pairing: null,
    pairingLoading: false,
    pairingError: "",
    view: "overview",
    pendingView: "",
    initialReady: false,
    settings: {
      baseline: null,
      dirty: false,
      saving: false,
      accessOriginal: "",
      autoStartBusy: false
    },
    themePreview: false,
    refreshing: false,
    pollTimer: 0,
    modalResolve: null,
    modalReturnFocus: null,
    subscriptions: []
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    if (!HAS_BRIDGE) {
      document.body.classList.add("demo-mode");
      const chip = $("#demo-chip");
      if (chip) chip.hidden = false;
    }
    bindWindowChrome();
    bindNavigation();
    bindOverview();
    bindActivity();
    bindPairing();
    bindLogs();
    bindSettings();
    bindAbout();
    bindModal();
    bindVisibility();
    bindThemeMedia();
    setActivityTab("tasks");
    setPlatformLabels();

    subscribeEvents();

    let boot = null;
    try {
      boot = await api.bootstrap();
      hydrateBoot(boot || {});
    } catch (error) {
      setBodyError(error);
      showToast(`控制台初始化失败：${error && error.message ? error.message : error}`, "error", 7000);
    }

    try {
      const initialLogs = await api.getLogs({ limit: 2000 });
      if (Array.isArray(initialLogs) && initialLogs.length) resetLogs(initialLogs);
    } catch {
      /* Bootstrap already carries a log snapshot; live entries arrive via onLogs. */
    }


    startPolling();

    try {
      const latestTasks = await api.getTasks();
      if (latestTasks) updateTasks(latestTasks);
    } catch {
      /* The task API is optional until the service has started. */
    }

    const hashView = String(location.hash || "").replace(/^#/, "");
    state.initialReady = true;
    showView(state.pendingView || (VIEWS.has(hashView) ? hashView : "overview"), { initial: true });
    if (!state.runtime) await refreshState({ quiet: true });
  }

  /* ------------------------------------------------------------------ */
  /* Boot / app info                                                     */
  /* ------------------------------------------------------------------ */

  function hydrateBoot(boot) {
    state.app = boot.app || {};
    state.config = boot.config || null;
    updateAppInfo();
    if (boot.runtime) updateRuntime(boot.runtime);
    if (boot.config) {
      updateConnectionInfo();
      renderSettings(boot.config, true);
      applyTheme(boot.config.console?.theme || "system");
    }
    updateTasks({ tasks: boot.tasks || [], at: Date.now() });
    resetLogs(boot.logs || []);
    if (boot.needsSetup) {
      showToast("尚未完成初始设置，请从托盘菜单打开初始设置向导。", "warn", 7000);
    }
  }

  function setPlatformLabels() {
    const label = platformLabel(api.platform);
    setText($("#side-platform"), label);
    setText($("#overview-platform"), label);
    setText($("#about-platform"), label);
    setText($("#about-platform-tag"), label);
  }

  function updateAppInfo() {
    const app = state.app || {};
    const versions = api.versions || {};
    const version = app.version || "1.0.0";
    setText($("#side-version"), `版本 ${version}`);
    setText($("#about-version"), version);
    setText($("#about-version-tag"), `版本 ${version}`);
    setText($("#about-electron"), versions.electron || app.electron || "—");
    setText($("#about-node"), versions.node || "—");
    setText($("#about-chrome"), versions.chrome || "—");
    setText($("#about-platform"), platformLabel(app.platform || api.platform));
    setText($("#about-config-path"), app.configPath || "—");
    setText($("#about-app-path"), app.appPath || "—");
    setText($("#about-log-dir"), state.config?.logDir || "—");
    setText($("#overview-machine"), state.config?.machineName || "本机");
    setText($("#hero-machine"), state.config?.machineName || "本机");
  }

  function platformLabel(platform) {
    return ({ win32: "Windows", darwin: "macOS", linux: "Linux" })[platform] || platform || "Windows";
  }

  function setBodyError(error) {
    setText($("#status-chip-text"), "连接失败");
    const chip = $("#status-chip");
    if (chip) chip.className = "status-chip err";
    setText($("#hero-title"), "控制台未连接");
    setText($("#hero-detail"), error && error.message ? error.message : "无法与主进程通信");
  }

  /* ------------------------------------------------------------------ */
  /* Events / polling / theme                                            */
  /* ------------------------------------------------------------------ */

  function subscribeEvents() {
    const subscribe = (register, handler) => {
      if (typeof register !== "function") return;
      try {
        const unsubscribe = register(handler);
        if (typeof unsubscribe === "function") state.subscriptions.push(unsubscribe);
      } catch {
        /* A missing subscription should not stop the console. */
      }
    };

    subscribe(api.onState, (payload) => {
      if (!payload) return;
      if (payload.runtime) updateRuntime(payload.runtime);
      if (payload.config) updateConfig(payload.config);
    });
    subscribe(api.onTasks, (payload) => updateTasks(payload));
    subscribe(api.onLogs, (payload) => appendLogs(payload));
    subscribe(api.onNavigate, (payload) => {
      const view = typeof payload === "string" ? payload : payload?.view;
      if (!VIEWS.has(view)) return;
      if (!state.initialReady) state.pendingView = view;
      else showView(view);
    });
    subscribe(api.onToast, (payload) => {
      if (!payload) return;
      if (typeof payload === "string") showToast(payload, "info");
      else showToast(payload.message || "操作完成", payload.type || "info");
    });
    subscribe(api.onTheme, (payload) => {
      const theme = state.config?.console?.theme || "system";
      if (theme === "system" && !state.themePreview) {
        document.body.classList.toggle("dark", Boolean(payload && payload.dark));
      }
    });
    subscribe(api.onOpenPairing, () => {
      if (!state.initialReady) state.pendingView = "pairing";
      else showView("pairing");
    });
    window.addEventListener("beforeunload", () => {
      state.subscriptions.forEach((unsubscribe) => {
        try { unsubscribe(); } catch { /* ignore */ }
      });
      state.subscriptions = [];
    });
  }

  function startPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = window.setInterval(() => {
      if (document.hidden) return;
      refreshState({ quiet: true });
    }, 2000);
  }

  async function refreshState({ quiet = true } = {}) {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      const result = await api.getState();
      if (result?.runtime) updateRuntime(result.runtime);
      if (result?.config) updateConfig(result.config);
    } catch (error) {
      if (!quiet) showToast(`刷新状态失败：${error?.message || error}`, "error");
    } finally {
      state.refreshing = false;
    }
  }

  function updateConfig(config, { forceSettings = false } = {}) {
    if (!config) return;
    const previous = state.config;
    const pairingChanged = configPairingKey(previous) !== configPairingKey(config);
    const uiChanged = configUiKey(previous) !== configUiKey(config);
    state.config = config;
    updateConnectionInfo();
    updateAppInfo();

    if (!state.themePreview) applyTheme(config.console?.theme || "system");

    if ((!state.settings.dirty || forceSettings) && (uiChanged || forceSettings || !previous)) {
      renderSettings(config, true);
    }
    if (pairingChanged) {
      invalidatePairing({ reload: state.view === "pairing" });
    }
  }

  function configPairingKey(config) {
    if (!config) return "";
    return [config.machineName, config.port, config.publicUrl, config.accessCodeMasked, config.hasAccessCode].join("|");
  }

  function configUiKey(config) {
    if (!config) return "";
    return JSON.stringify({
      port: config.port,
      host: config.host,
      codexHome: config.codexHome,
      publicUrl: config.publicUrl,
      logDir: config.logDir,
      readonly: config.readonly,
      accessCodeMasked: config.accessCodeMasked,
      tunnel: config.tunnel,
      console: config.console
    });
  }

  function bindThemeMedia() {
    const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (!media) return;
    const onChange = () => {
      const theme = state.config?.console?.theme || "system";
      if (theme === "system" && !state.themePreview) applyTheme("system");
    };
    if (typeof media.addEventListener === "function") media.addEventListener("change", onChange);
    else if (typeof media.addListener === "function") media.addListener(onChange);
  }

  function applyTheme(choice, { preview = false } = {}) {
    if (preview) {
      state.themePreview = true;
    } else {
      state.themePreview = false;
    }
    const dark = choice === "dark" || (choice !== "light" && Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches));
    document.body.classList.toggle("light", choice === "light");
    document.body.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }

  function bindVisibility() {
    const syncVisibility = () => {
      document.body.classList.toggle("app-hidden", document.hidden);
      if (!document.hidden) refreshState({ quiet: true });
    };
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  function bindNavigation() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-view]");
      if (nav) {
        event.preventDefault();
        if (VIEWS.has(nav.dataset.view)) showView(nav.dataset.view);
        return;
      }
      const external = event.target.closest("[data-external]");
      if (external) {
        event.preventDefault();
        openExternalSafe(external.dataset.external);
      }
    });
    window.addEventListener("hashchange", () => {
      const view = String(location.hash || "").replace(/^#/, "");
      if (VIEWS.has(view) && view !== state.view) showView(view);
    });
  }

  function showView(name, { initial = false } = {}) {
    if (!VIEWS.has(name)) name = "overview";
    state.view = name;
    document.body.dataset.view = name;
    $$("[data-page]").forEach((page) => {
      const active = page.dataset.page === name;
      page.hidden = !active;
      page.classList.toggle("active", active);
    });
    $$(".nav-item[data-view]").forEach((item) => {
      const active = item.dataset.view === name;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    try {
      history.replaceState(null, "", `#${name}`);
    } catch {
      /* file:// history is allowed in Electron, but this is a harmless fallback. */
    }

    if (name === "pairing") {
      if (!state.pairing) loadPairing();
      else renderPairing();
    }
    if (name === "logs") {
      renderLogs();
      if (!state.paused) scrollLogsToBottom();
    }
    if (name === "settings") {
      if (state.config && !state.settings.dirty) renderSettings(state.config, true);
      setText($("#about-log-dir"), state.config?.logDir || "—");
    }
    if (name === "about") updateAppInfo();
    if (!initial && name === "overview") {
      updateRuntime(state.runtime);
      if (state.activityTab === "tasks") renderTaskList();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Window chrome                                                       */
  /* ------------------------------------------------------------------ */

  function bindWindowChrome() {
    $("#win-min")?.addEventListener("click", () => Promise.resolve(api.minimize()).catch(() => {}));
    $("#win-max")?.addEventListener("click", () => Promise.resolve(api.maximize()).catch(() => {}));
    $("#win-close")?.addEventListener("click", () => Promise.resolve(api.close()).catch(() => {}));
    $("#titlebar")?.addEventListener("dblclick", (event) => {
      if (event.target.closest(".winbtn")) return;
      Promise.resolve(api.maximize()).catch(() => {});
    });
  }

  /* ------------------------------------------------------------------ */
  /* Overview / runtime                                                  */
  /* ------------------------------------------------------------------ */

  function bindOverview() {
    $("#btn-refresh")?.addEventListener("click", async () => {
      const button = $("#btn-refresh");
      button?.classList.add("loading");
      await refreshState({ quiet: false });
      try {
        const result = await api.getTasks();
        if (result) updateTasks(result);
      } catch { /* ignore */ }
      button?.classList.remove("loading");
    });
    $("#btn-restart")?.addEventListener("click", restartService);
    $("#btn-power")?.addEventListener("click", () => {
      const running = ["running", "degraded"].includes(state.runtime?.state);
      if (running) stopServiceWithConfirm();
      else startService();
    });
    $("#btn-open-pairing")?.addEventListener("click", () => showView("pairing"));
    $("#btn-card-pairing")?.addEventListener("click", () => showView("pairing"));
    $("#btn-preview")?.addEventListener("click", openPreview);
    $("#activity-preview")?.addEventListener("click", openPreview);
    $("#btn-copy-url")?.addEventListener("click", () => {
      const url = state.runtime?.urls?.browser || state.runtime?.urls?.publicUrl || state.runtime?.urls?.lan;
      copyText(url, "访问地址已复制");
    });
    $("#btn-copy-lan")?.addEventListener("click", () => copyText(state.runtime?.urls?.lan, "局域网地址已复制"));
    $("#btn-open-public")?.addEventListener("click", () => {
      const url = state.runtime?.urls?.publicUrl || state.config?.publicUrl;
      if (url) openExternalSafe(url);
    });
    $("#btn-show-code")?.addEventListener("click", () => showView("pairing"));
    $("#btn-open-codex")?.addEventListener("click", () => openPathSafe("codex", "Codex 数据目录"));
    $("#btn-card-code-settings")?.addEventListener("click", () => {
      showView("settings");
      const input = $("#set-access-code");
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function updateRuntime(runtime) {
    state.runtime = runtime || null;
    const snap = runtime || {
      state: "stopped",
      label: "已停止",
      detail: "服务未启动",
      service: { pid: null, startedAt: null, uptimeMs: 0, memoryBytes: 0, restartCount: 0 },
      health: { ipcConnected: false },
      tunnel: { enabled: false, state: "disabled" },
      urls: {}
    };
    const serviceState = snap.state || "stopped";
    const chip = $("#status-chip");
    const chipClass = {
      running: "",
      degraded: "warn",
      starting: "warn",
      restarting: "warn",
      stopping: "warn",
      error: "err",
      stopped: "off"
    }[serviceState] ?? "off";
    if (chip) chip.className = `status-chip ${chipClass}`.trim();
    setText($("#status-chip-text"), snap.label || "已停止");

    const pulseClass = {
      running: "",
      degraded: "amber",
      starting: "amber",
      restarting: "amber",
      stopping: "amber",
      error: "red",
      stopped: "gray"
    }[serviceState] ?? "gray";
    const pulse = $("#hero-pulse");
    if (pulse) pulse.className = `pulse ${pulseClass}`.trim();

    const tagMap = {
      running: ["手机可访问", "ok"],
      degraded: ["部分可用", "warn"],
      starting: ["正在启动", "warn"],
      restarting: ["正在重启", "warn"],
      stopping: ["正在停止", "warn"],
      stopped: ["已停止", "muted"],
      error: ["需要处理", "err"]
    };
    const [tagText, tagTone] = tagMap[serviceState] || ["状态未知", "muted"];
    const tag = $("#hero-tag");
    if (tag) {
      tag.className = `tag ${tagTone}`;
      tag.textContent = tagText;
    }

    setText($("#hero-title"), snap.label || "已停止");
    setText($("#hero-detail"), snap.detail || "服务未启动");
    const urls = snap.urls || {};
    setText($("#hero-lan"), urls.lan || "—");
    const publicEnabled = Boolean(snap.tunnel?.enabled);
    setText($("#hero-public"), urls.publicUrl || (publicEnabled ? "未连接" : "未启用"));
    setText($("#overview-machine"), state.config?.machineName || "本机");
    setText($("#hero-machine"), state.config?.machineName || "本机");

    const service = snap.service || {};
    setText($("#metric-uptime"), service.uptimeMs ? formatUptime(service.uptimeMs) : "—");
    setText($("#metric-memory"), service.memoryBytes ? formatMemory(service.memoryBytes) : "—");
    setText($("#metric-pid"), service.pid ? String(service.pid) : "—");

    setText($("#overview-started"), startedText(service, serviceState));
    setText($("#stat-uptime"), service.uptimeMs ? formatUptime(service.uptimeMs) : "—");
    setText($("#stat-restarts"), String(Number(service.restartCount) || 0));

    const ipc = snap.health?.ipcConnected;
    const ipcTag = $("#conn-ipc");
    if (ipcTag) {
      ipcTag.className = `tag ${ipc ? "ok" : "muted"}`;
      ipcTag.textContent = ipc ? "Codex 已连接" : "Codex 未连接";
      ipcTag.title = snap.health?.latencyMs ? `健康检查 ${snap.health.latencyMs} ms` : "";
    }

    updateRuntimeButtons(snap);
    updateConnectionInfo();
    renderTaskList();
  }

  function updateRuntimeButtons(snap) {
    const serviceState = snap?.state || "stopped";
    const running = serviceState === "running" || serviceState === "degraded";
    const busy = ["starting", "restarting", "stopping"].includes(serviceState);
    const power = $("#btn-power");
    const powerLabel = power?.querySelector("span");
    if (power) {
      power.classList.remove("primary", "danger");
      if (running) {
        power.classList.add("danger");
        setButtonIcon(power, "square");
        if (powerLabel) setText(powerLabel, "停止服务");
        power.disabled = false;
      } else if (busy) {
        power.classList.add("btn");
        setButtonIcon(power, "loader");
        if (powerLabel) setText(powerLabel, serviceState === "stopping" ? "停止中…" : serviceState === "starting" ? "启动中…" : "重启中…");
        power.disabled = true;
      } else {
        power.classList.add("primary");
        setButtonIcon(power, "play");
        if (powerLabel) setText(powerLabel, "启动服务");
        power.disabled = false;
      }
    }
    const restart = $("#btn-restart");
    if (restart) {
      restart.disabled = !running;
      const label = restart.querySelector("span");
      if (label) setText(label, serviceState === "restarting" ? "重启中…" : "重启服务");
      setButtonIcon(restart, serviceState === "restarting" ? "loader" : "refresh");
    }
    const preview = $("#btn-preview");
    if (preview) preview.disabled = !running;
    const copyUrl = $("#btn-copy-url");
    if (copyUrl) copyUrl.disabled = !(snap?.urls?.browser || snap?.urls?.lan);
    updateLogStats();
  }

  function startedText(service, serviceState) {
    if (service?.startedAt) return `服务启动于 ${formatStartedAt(service.startedAt)}`;
    if (serviceState === "error") return "服务启动失败，请查看日志";
    if (serviceState === "starting") return "服务正在启动";
    if (serviceState === "restarting") return "服务正在重启";
    return "服务尚未启动";
  }

  function updateConnectionInfo() {
    const config = state.config || {};
    const urls = state.runtime?.urls || {};
    const lan = urls.lan || (config.port ? `http://127.0.0.1:${config.port}` : "");
    const publicUrl = urls.publicUrl || config.publicUrl || "";
    const codexHome = config.codexHome || "";
    setTextWithTitle($("#conn-lan"), lan || "—", lan);
    setTextWithTitle($("#conn-public"), publicUrl || "未配置", publicUrl);
    setText($("#conn-code"), config.accessCodeMasked || "••••••");
    setTextWithTitle($("#conn-codex"), codexHome || "—", codexHome);
    setText($("#overview-code"), config.accessCodeMasked || "••••••");
    setText($("#hero-lan"), lan || "—");
    setText($("#about-log-dir"), config.logDir || "—");
    setText($("#log-path"), `日志目录：${config.logDir || "—"}`);
    const copyLan = $("#btn-copy-lan");
    if (copyLan) copyLan.disabled = !lan;
    const openPublic = $("#btn-open-public");
    if (openPublic) openPublic.disabled = !publicUrl;
    const openCodex = $("#btn-open-codex");
    if (openCodex) openCodex.disabled = !codexHome;
  }

  async function startService() {
    await runServiceAction(() => api.startService(), "正在启动服务…");
  }

  async function restartService() {
    await runServiceAction(() => api.restartService(), "正在重启服务…");
  }

  async function stopServiceWithConfirm() {
    const confirmed = await openModal({
      title: "停止本机服务",
      message: "停止后，手机端将立即无法访问这台电脑。Codex Desktop 和正在执行的任务不受影响。",
      confirmLabel: "停止服务",
      cancelLabel: "取消",
      tone: "danger",
      icon: "square"
    });
    if (!confirmed) return;
    await runServiceAction(() => api.stopService(), "正在停止服务…");
  }

  async function runServiceAction(action, pendingMessage) {
    const power = $("#btn-power");
    const restart = $("#btn-restart");
    if (power) power.disabled = true;
    if (restart) restart.disabled = true;
    showToast(pendingMessage, "info", 1800);
    try {
      const result = await action();
      if (result?.runtime) updateRuntime(result.runtime);
      else await refreshState({ quiet: true });
      if (result?.config) updateConfig(result.config);
      if (result?.runtime?.state === "error" && result.runtime.lastError) {
        showToast(result.runtime.lastError, "error", 6000);
      } else if (!result || result.ok !== false) {
        showToast(result?.runtime?.label ? `服务${result.runtime.label}` : "服务状态已更新", "success", 2500);
      }
    } catch (error) {
      showToast(`操作失败：${error?.message || error}`, "error");
    } finally {
      updateRuntimeButtons(state.runtime);
    }
  }

  function openPreview() {
    const running = ["running", "degraded"].includes(state.runtime?.state);
    if (!running) {
      showToast("服务未运行，先启动服务后再预览。", "warn");
      return;
    }
    Promise.resolve()
      .then(() => api.openPreview())
      .then((result) => {
        if (result && result.ok === false) throw new Error(result.error || "无法打开浏览器");
        showToast("已在本机浏览器中打开手机网页预览", "success");
      })
      .catch((error) => showToast(`无法打开预览：${error?.message || error}`, "error"));
  }

  /* ------------------------------------------------------------------ */
  /* Tasks / activity                                                    */
  /* ------------------------------------------------------------------ */

  function bindActivity() {
    $$("[data-activity]").forEach((button) => {
      button.addEventListener("click", () => setActivityTab(button.dataset.activity));
    });
    $("#activity-refresh")?.addEventListener("click", async () => {
      if (state.activityTab === "logs") {
        showView("logs");
        return;
      }
      const button = $("#activity-refresh");
      if (button) button.disabled = true;
      try {
        const result = await api.refreshTasks();
        if (Array.isArray(result)) updateTasks({ tasks: result, at: Date.now() });
        else if (result) updateTasks(result);
      } catch (error) {
        showToast(`刷新任务失败：${error?.message || error}`, "error");
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  function setActivityTab(tab) {
    state.activityTab = tab === "logs" ? "logs" : "tasks";
    $$("[data-activity]").forEach((button) => {
      const active = button.dataset.activity === state.activityTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const taskList = $("#task-list");
    const logPreview = $("#log-preview");
    if (taskList) taskList.hidden = state.activityTab !== "tasks";
    if (logPreview) logPreview.hidden = state.activityTab !== "logs";
    const link = $("#activity-refresh");
    if (link) {
      const label = link.querySelector("span");
      setText(label, state.activityTab === "tasks" ? "刷新任务" : "查看全部");
      setButtonIcon(link, state.activityTab === "tasks" ? "refresh" : "external");
    }
    if (state.activityTab === "tasks") renderTaskList();
    else renderLogPreview();
  }

  function updateTasks(payload) {
    const tasks = Array.isArray(payload) ? payload : (payload?.tasks || []);
    const signature = JSON.stringify(tasks.map((task) => [
      task.id,
      task.title,
      task.status,
      Boolean(task.interactionRequired),
      task.updatedAtMs,
      task.project
    ]));
    if (signature === state.tasksSignature) return;
    state.tasksSignature = signature;
    state.tasks = tasks;
    if (state.activityTab === "tasks") renderTaskList();
  }

  function renderTaskList() {
    const list = $("#task-list");
    if (!list) return;
    list.replaceChildren();
    if (!state.tasks.length) {
      const empty = document.createElement("div");
      empty.className = "task-empty";
      empty.innerHTML = `${icon("info")}<span>${state.runtime && ["running", "degraded"].includes(state.runtime.state) ? "暂无最近任务，稍后会自动刷新" : "服务未启动，暂无最近任务"}</span>`;
      list.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    state.tasks.slice(0, 5).forEach((task) => {
      const status = TASK_STATUS[task.status] || TASK_STATUS.unknown;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "task";
      row.title = task.id ? `点击复制任务 ID · ${task.id}` : "点击复制任务 ID";
      row.dataset.taskId = task.id || "";

      const pulse = document.createElement("span");
      pulse.className = `pulse ${status.pulse}`.trim();
      row.appendChild(pulse);

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = task.title || "未命名任务";
      row.appendChild(name);

      const tag = document.createElement("span");
      tag.className = `state tag ${status.tone}`;
      tag.textContent = status.label;
      row.appendChild(tag);

      const meta = document.createElement("span");
      meta.className = "meta";
      const bits = [];
      if (task.project) bits.push(task.project);
      if (task.interactionRequired) bits.push("需要你的确认");
      meta.textContent = bits.join(" · ");

      const time = document.createElement("span");
      time.className = "time";
      time.textContent = task.updatedAtMs ? timeAgo(task.updatedAtMs) : "";
      time.title = task.updatedAtMs ? fullDate(task.updatedAtMs) : "";
      row.appendChild(time);

      const chev = document.createElement("span");
      chev.className = "chev";
      chev.innerHTML = icon("chevron");
      row.appendChild(chev);

      row.addEventListener("click", () => {
        if (task.id) copyText(task.id, "任务 ID 已复制，可在浏览器预览中查找该任务");
        else showToast("该任务没有可复制的 ID。", "warn");
      });
      fragment.appendChild(row);
    });
    list.appendChild(fragment);
  }

  function renderLogPreview() {
    const preview = $("#log-preview");
    if (!preview) return;
    preview.replaceChildren();
    const recent = state.logs.slice(-6);
    if (!recent.length) {
      const empty = document.createElement("div");
      empty.className = "preview-empty";
      empty.innerHTML = `${icon("terminal")}<span>暂无日志</span>`;
      preview.appendChild(empty);
      return;
    }
    recent.forEach((entry) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "preview-line";
      row.title = fullLogText(entry);
      const time = document.createElement("span");
      time.className = "t";
      time.textContent = entry.time || "";
      row.appendChild(time);
      const level = document.createElement("span");
      level.className = `lv ${normalizedLevel(entry.level)}`;
      level.textContent = displayLevel(entry.level);
      row.appendChild(level);
      const source = document.createElement("span");
      source.className = "src";
      source.textContent = `[${entry.source || "app"}]`;
      row.appendChild(source);
      const message = document.createElement("span");
      message.className = "msg";
      message.textContent = entry.message || "";
      row.appendChild(message);
      row.addEventListener("click", () => showView("logs"));
      preview.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Pairing                                                             */
  /* ------------------------------------------------------------------ */

  function bindPairing() {
    $("#btn-pairing-back")?.addEventListener("click", () => showView("overview"));
    $("#btn-retry-pairing")?.addEventListener("click", () => loadPairing({ force: true }));
    $("#btn-refresh-pairing")?.addEventListener("click", () => loadPairing({ force: true }));
    $("#btn-copy-code")?.addEventListener("click", () => {
      copyText(state.pairing?.accessCode, "访问码已复制");
    });
    $("#btn-copy-payload")?.addEventListener("click", () => {
      copyText(state.pairing?.payload, "配对信息已复制");
    });
    $("#btn-save-pairing")?.addEventListener("click", savePairing);
    $("#btn-pairing-settings")?.addEventListener("click", () => {
      showView("settings");
      const input = $("#set-access-code");
      if (input) {
        input.focus();
        input.select();
      }
    });
    $("#pairing-qr-btn")?.addEventListener("click", () => {
      if (!state.pairing?.dataUrl) return;
      openModal({
        title: "配对二维码",
        message: "二维码包含访问码，请勿截图分享。可以点击下方按钮保存为 PNG 文件。",
        imageSrc: state.pairing.dataUrl,
        confirmLabel: "关闭",
        singleAction: true,
        icon: "qr"
      });
    });
  }

  async function loadPairing({ force = false } = {}) {
    if (state.pairingLoading) return;
    if (state.pairing && !force) {
      renderPairing();
      return;
    }
    state.pairingLoading = true;
    state.pairingError = "";
    renderPairing();
    try {
      const result = await api.getPairing();
      if (result && result.ok !== false && result.dataUrl) {
        state.pairing = result;
        state.pairingError = "";
      } else {
        state.pairing = null;
        state.pairingError = result?.error || "无法生成二维码，请稍后重试。";
      }
    } catch (error) {
      state.pairing = null;
      state.pairingError = error?.message || String(error);
    } finally {
      state.pairingLoading = false;
      renderPairing();
    }
  }

  function renderPairing() {
    const data = state.pairing;
    const loading = state.pairingLoading;
    const error = state.pairingError;
    const loadingEl = $("#pairing-loading");
    const errorEl = $("#pairing-error");
    const content = $("#pairing-content");
    if (loadingEl) loadingEl.hidden = !loading;
    if (errorEl) errorEl.hidden = loading || !error;
    if (content) content.hidden = loading || Boolean(error) || !data;
    setText($("#pairing-error-text"), error || "请稍后重试。");
    const card = $("#pairing-card");
    if (card) card.setAttribute("aria-busy", String(loading));
    const stateTag = $("#pairing-state-tag");
    if (stateTag) {
      stateTag.className = `tag ${loading ? "muted" : error ? "err" : data ? "ok" : "muted"}`;
      stateTag.textContent = loading ? "生成中" : error ? "生成失败" : data ? "已生成" : "按需加载";
    }
    if (!data) {
      resetOverviewPairing(loading ? "生成中" : error ? "生成失败" : "按需加载");
      return;
    }
    const image = $("#pairing-image");
    if (image) image.src = data.dataUrl;
    setText($("#pairing-machine"), data.machineName || state.config?.machineName || "这台电脑");
    setTextWithTitle($("#pairing-url"), data.url || "—", data.url || "");
    setTextWithTitle($("#pairing-lan"), data.lanUrl || "—", data.lanUrl || "");
    setTextWithTitle($("#pairing-public"), data.publicUrl || "未配置", data.publicUrl || "");
    setText($("#pairing-code"), data.accessCode || "—");
    renderOverviewPairing(data);
  }

  function renderOverviewPairing(data) {
    const box = $("#overview-qr-box");
    const tag = $("#pairing-card-state");
    if (!box) return;
    box.replaceChildren();
    if (data?.dataUrl) {
      const image = document.createElement("img");
      image.src = data.dataUrl;
      image.alt = "手机配对二维码缩略图";
      box.appendChild(image);
      if (tag) {
        tag.className = "tag ok";
        tag.textContent = "已生成";
      }
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "qr-placeholder";
      placeholder.innerHTML = icon("qr");
      box.appendChild(placeholder);
      if (tag) {
        tag.className = "tag muted";
        tag.textContent = "按需加载";
      }
    }
  }

  function resetOverviewPairing(label) {
    const box = $("#overview-qr-box");
    if (box) {
      box.replaceChildren();
      const placeholder = document.createElement("div");
      placeholder.className = "qr-placeholder";
      placeholder.innerHTML = icon("qr");
      box.appendChild(placeholder);
    }
    const tag = $("#pairing-card-state");
    if (tag) {
      tag.className = `tag ${label === "生成失败" ? "err" : "muted"}`;
      tag.textContent = label;
    }
  }

  function invalidatePairing({ reload = false } = {}) {
    state.pairing = null;
    state.pairingError = "";
    if (state.view === "pairing") {
      renderPairing();
      if (reload) loadPairing({ force: true });
    } else {
      resetOverviewPairing("按需加载");
    }
  }

  async function savePairing() {
    const button = $("#btn-save-pairing");
    if (button) button.disabled = true;
    try {
      const result = await api.savePairing();
      if (result?.ok) {
        showToast(result.filePath ? `二维码已保存到 ${result.filePath}` : "二维码已保存", "success", 5000);
      } else if (!result?.canceled) {
        showToast(result?.error || "保存二维码失败", "error");
      }
    } catch (error) {
      showToast(`保存二维码失败：${error?.message || error}`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Logs                                                                */
  /* ------------------------------------------------------------------ */

  function bindLogs() {
    $("#btn-pause-logs")?.addEventListener("click", () => setLogPaused(!state.paused));
    $("#btn-open-logs")?.addEventListener("click", () => openPathSafe("logs", "日志目录"));
    $("#btn-export-logs")?.addEventListener("click", exportLogs);
    $$("[data-log-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.logFilter = button.dataset.logFilter || "all";
        $$("[data-log-filter]").forEach((item) => {
          const active = item.dataset.logFilter === state.logFilter;
          item.classList.toggle("on", active);
          item.setAttribute("aria-pressed", String(active));
        });
        renderLogs();
      });
    });
    const search = $("#log-search");
    search?.addEventListener("input", () => {
      clearTimeout(state.logSearchTimer);
      state.logSearchTimer = window.setTimeout(() => {
        state.logSearch = search.value.trim();
        updateSearchClear();
        renderLogs();
      }, 140);
    });
    search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(state.logSearchTimer);
        state.logSearch = search.value.trim();
        updateSearchClear();
        renderLogs();
      } else if (event.key === "Escape" && search.value) {
        event.preventDefault();
        search.value = "";
        state.logSearch = "";
        updateSearchClear();
        renderLogs();
      }
    });
    $("#log-search-clear")?.addEventListener("click", () => {
      if (search) search.value = "";
      state.logSearch = "";
      updateSearchClear();
      renderLogs();
      search?.focus();
    });
  }

  function resetLogs(entries) {
    state.logs = normalizeLogs(entries).slice(-MAX_DOM_LOGS);
    state.logs = normalizeLogs(entries).slice(-MAX_STATE_LOGS);
    renderLogs();
    updateLogStats();
    updateLogBadge();
    if (state.activityTab === "logs") renderLogPreview();
  }

  function appendLogs(payload) {
    const entries = normalizeLogs(payload);
    if (!entries.length) return;
    if (state.paused) {
      state.logBuffer.push(...entries);
      if (state.logBuffer.length > MAX_LOG_BUFFER) {
        state.logBuffer = state.logBuffer.slice(-MAX_LOG_BUFFER);
      }
      updatePauseUi();
      updateLogBadge();
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      state.logs.push(entry);
      if (state.logs.length > MAX_STATE_LOGS) state.logs.shift();
      if (logMatches(entry)) fragment.appendChild(buildLogLine(entry));
    }
    if (state.logs.length > MAX_STATE_LOGS) state.logs = state.logs.slice(-MAX_STATE_LOGS);
    const body = $("#log-body");
    if (body) {
      body.appendChild(fragment);
      while (body.children.length > MAX_DOM_LOGS) body.removeChild(body.firstElementChild);
    }
    updateLogStats();
    updateLogBadge();
    if (state.activityTab === "logs") renderLogPreview();
    updateLogCount();
    updateLogEmptyState();
    if (state.view === "logs" && !state.paused) scrollLogsToBottom();
  }

  function renderLogs() {
    const body = $("#log-body");
    if (!body) return;
    body.replaceChildren();
    const matched = state.logs.filter(logMatches).slice(-MAX_DOM_LOGS);
    const fragment = document.createDocumentFragment();
    const searching = Boolean(state.logSearch);
    for (const entry of matched) {
      const line = buildLogLine(entry);
      if (searching) line.classList.add("hl");
      fragment.appendChild(line);
    }
    body.appendChild(fragment);
    updateLogEmptyState();
    updateLogCount();
    updatePauseUi();
    if (state.view === "logs" && !state.paused) scrollLogsToBottom();
  }

  function updateLogCount() {
    const count = $("#log-count");
    const body = $("#log-body");
    if (!count || !body) return;
    const shown = body.children.length;
    count.textContent = state.logSearch || state.logFilter !== "all"
      ? `显示 ${shown} / ${state.logs.length} 行`
      : `${shown} 行`;
  }

  function buildLogLine(entry) {
    const line = document.createElement("div");
    const level = normalizedLevel(entry.level);
    line.className = `logline${level === "error" ? " errline" : ""}`;
    line.title = fullLogText(entry);

    const time = document.createElement("span");
    time.className = "t";
    time.textContent = entry.time || "";
    line.appendChild(time);

    const levelEl = document.createElement("span");
    levelEl.className = `lv ${level}`;
    levelEl.textContent = displayLevel(entry.level);
    line.appendChild(levelEl);

    const source = document.createElement("span");
    source.className = "src";
    source.textContent = `[${entry.source || "app"}]`;
    line.appendChild(source);

    const message = document.createElement("span");
    message.className = "msg";
    message.textContent = entry.message || "";
    line.appendChild(message);
    return line;
  }

  function logMatches(entry) {
    const source = String(entry.source || "app").toLowerCase();
    if (state.logFilter === "service" && !SERVICE_SOURCES.has(source)) return false;
    if (state.logFilter === "tunnel" && source !== "tunnel") return false;
    if (state.logFilter === "app" && (SERVICE_SOURCES.has(source) || source === "tunnel")) return false;
    const needle = state.logSearch.trim().toLowerCase();
    if (!needle) return true;
    const haystack = `${entry.message || ""} ${entry.source || ""} ${entry.level || ""} ${entry.date || ""} ${entry.time || ""}`.toLowerCase();
    return haystack.includes(needle);
  }

  function updateLogEmptyState() {
    const empty = $("#log-empty");
    const text = $("#log-empty-text");
    if (!empty) return;
    const body = $("#log-body");
    const shown = body ? body.children.length : 0;
    const hasFilter = state.logSearch || state.logFilter !== "all";
    empty.hidden = shown > 0;
    if (text) {
      text.textContent = state.logs.length && hasFilter
        ? "没有匹配的日志，试试其他过滤条件"
        : state.logs.length
          ? "暂无日志"
          : "暂无日志，等待服务输出…";
    }
  }

  function updateLogStats() {
    const service = state.runtime?.service || {};
    setText($("#stat-restarts"), String(Number(service.restartCount) || 0));
    setText($("#stat-uptime"), service.uptimeMs ? formatUptime(service.uptimeMs) : "—");
    const now = Date.now();
    const all = state.logs.concat(state.logBuffer);
    let errors = 0;
    let warns = 0;
    for (const entry of all) {
      const timestamp = Number(entry.ts) || 0;
      if (!timestamp || now - timestamp > 24 * 60 * 60 * 1000) continue;
      const level = normalizedLevel(entry.level);
      if (level === "error") errors += 1;
      else if (level === "warn") warns += 1;
    }
    setText($("#stat-errors"), String(errors));
    setText($("#stat-warns"), String(warns));
  }

  function updateLogBadge() {
    const now = Date.now();
    const badge = $("#log-badge");
    if (!badge) return;
    let count = 0;
    for (const entry of state.logs.concat(state.logBuffer)) {
      const timestamp = Number(entry.ts) || 0;
      if (!timestamp || now - timestamp > 24 * 60 * 60 * 1000) continue;
      if (["error", "warn"].includes(normalizedLevel(entry.level))) count += 1;
    }
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    badge.title = count ? `${count} 条警告或错误` : "";
  }

  function setLogPaused(paused) {
    state.paused = Boolean(paused);
    if (!state.paused && state.logBuffer.length) {
      const buffered = state.logBuffer.splice(0, state.logBuffer.length);
      appendLogs(buffered);
      showToast(`已恢复实时滚动，补入 ${buffered.length} 条日志`, "success");
    } else if (state.paused) {
      showToast("已暂停滚动，新日志会暂存在内存中（最多 2000 条）", "info", 3200);
    }
    updatePauseUi();
    renderLogs();
  }

  function updatePauseUi() {
    const button = $("#btn-pause-logs");
    if (button) {
      button.classList.toggle("active", state.paused);
      button.setAttribute("aria-pressed", String(state.paused));
      const label = button.querySelector("span");
      setText(label, state.paused ? "继续滚动" : "暂停滚动");
      setButtonIcon(button, state.paused ? "play" : "pause");
    }
    const live = $("#console-live");
    if (live) {
      live.classList.toggle("paused", state.paused);
      live.innerHTML = `<span class="dot"></span>${state.paused ? "已暂停" : "实时"}`;
    }
    setText($("#log-live-text"), state.paused ? "已暂停" : "自动滚动");
    const dot = $("#log-live-dot");
    if (dot) dot.classList.toggle("off", state.paused);
    const note = $("#log-buffer-note");
    if (note) {
      note.hidden = !state.paused || state.logBuffer.length === 0;
      note.textContent = state.logBuffer.length ? `缓冲 ${state.logBuffer.length} / ${MAX_LOG_BUFFER} 条` : "";
    }
  }

  function scrollLogsToBottom() {
    const body = $("#log-body");
    if (!body) return;
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  }

  function updateSearchClear() {
    const button = $("#log-search-clear");
    const input = $("#log-search");
    if (button) button.hidden = !(input && input.value);
  }

  function normalizeLogs(payload) {
    if (!payload) return [];
    const items = Array.isArray(payload) ? payload : (Array.isArray(payload.entries) ? payload.entries : [payload]);
    return items.filter((entry) => entry && typeof entry === "object");
  }

  function normalizedLevel(level) {
    const value = String(level || "info").toLowerCase();
    if (value === "warning") return "warn";
    if (["info", "warn", "error", "ok", "debug", "trace"].includes(value)) return value;
    return "info";
  }

  function displayLevel(level) {
    const value = normalizedLevel(level);
    if (value === "ok") return "OK";
    return value.toUpperCase();
  }

  function fullLogText(entry) {
    return `${entry.date || ""} [${String(entry.level || "info").toUpperCase()}] [${entry.source || "app"}] ${entry.message || ""}`.trim();
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  function bindSettings() {
    $("#settings-form")?.addEventListener("submit", saveSettings);
    $("#btn-discard")?.addEventListener("click", discardSettings);
    $("#btn-open-config")?.addEventListener("click", () => openPathSafe("config", "配置目录"));
    $("#btn-settings-open-logs")?.addEventListener("click", () => openPathSafe("logs", "日志目录"));
    $("#btn-settings-export-logs")?.addEventListener("click", exportLogs);

    $$("#settings-form [data-setting]").forEach((control) => {
      control.addEventListener("input", () => onSettingChanged(control));
      control.addEventListener("change", () => onSettingChanged(control));
    });

    $("#set-auto-start")?.addEventListener("click", () => {
      requestAutoStart(!isToggleOn($("#set-auto-start")), $("#set-auto-start"));
    });
    $("#side-auto-start")?.addEventListener("click", () => {
      requestAutoStart(!isToggleOn($("#side-auto-start")), $("#side-auto-start"));
    });

    ["#set-start-minimized", "#set-readonly", "#set-tunnel-enabled"].forEach((selector) => {
      const button = $(selector);
      button?.addEventListener("click", () => {
        setToggle(button, !isToggleOn(button));
        if (selector === "#set-tunnel-enabled") updateTunnelTag();
        clearFieldError(button.dataset.setting);
        updateSettingsDirty();
      });
    });

    $("#btn-toggle-code")?.addEventListener("click", () => {
      const input = $("#set-access-code");
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      setButtonIcon($("#btn-toggle-code"), input.type === "password" ? "eye" : "eye-off");
      input.focus();
    });
    $("#btn-generate-code")?.addEventListener("click", () => {
      const input = $("#set-access-code");
      if (!input) return;
      input.type = "text";
      input.value = generateAccessCode();
      setButtonIcon($("#btn-toggle-code"), "eye-off");
      clearFieldError("accessCode");
      updateSettingsDirty();
      input.focus();
      input.select();
      showToast("已生成新的访问码，保存后生效。", "info", 2800);
    });

    $$("[data-choose]").forEach((button) => {
      button.addEventListener("click", () => choosePathForField(button));
    });
  }

  function onSettingChanged(control) {
    const field = control.dataset.setting;
    if (!field) return;
    if (field === "theme") applyTheme(control.value, { preview: true });
    clearFieldError(field);
    updateSettingsDirty();
    if (field === "tunnel.enabled") updateTunnelTag();
  }

  function updateTunnelTag() {
    const tag = $("#tunnel-state-tag");
    if (!tag) return;
    const enabled = isToggleOn($("#set-tunnel-enabled"));
    tag.className = `tag ${enabled ? "ok" : "muted"}`;
    tag.textContent = enabled ? "已启用" : "未启用";
  }

  function requestAutoStart(enabled, sourceButton) {
    if (state.settings.autoStartBusy) return;
    state.settings.autoStartBusy = true;
    const previous = Boolean(state.config?.console?.autoStart);
    setToggle($("#side-auto-start"), enabled);
    setToggle($("#set-auto-start"), enabled);
    Promise.resolve()
      .then(() => api.setAutoStart(Boolean(enabled)))
      .then((result) => {
        if (result && result.ok === false) throw new Error(result.error || "设置失败");
        if (result?.config) {
          state.config = result.config;
          updateAppInfo();
        } else if (state.config) {
          state.config = {
            ...state.config,
            console: { ...(state.config.console || {}), autoStart: Boolean(enabled) }
          };
        }
        if (state.settings.baseline) state.settings.baseline.autoStart = Boolean(enabled);
        setToggle($("#side-auto-start"), enabled);
        setToggle($("#set-auto-start"), enabled);
        updateSettingsDirty();
        showToast(enabled ? "已开启开机自动启动" : "已关闭开机自动启动", "success", 2400);
      })
      .catch((error) => {
        setToggle($("#side-auto-start"), previous);
        setToggle($("#set-auto-start"), previous);
        showToast(`设置开机启动失败：${error?.message || error}`, "error");
      })
      .finally(() => {
        state.settings.autoStartBusy = false;
        if (sourceButton) sourceButton.focus();
      });
  }

  function renderSettings(config, force = false) {
    if (!config) return;
    if (state.settings.saving && !force) return;
    if (state.settings.dirty && !force) return;
    const values = configToSettingsValues(config);
    setToggle($("#set-auto-start"), values.autoStart);
    setToggle($("#side-auto-start"), values.autoStart);
    setToggle($("#set-start-minimized"), values.startMinimized);
    setToggle($("#set-readonly"), values.readonly);
    setToggle($("#set-tunnel-enabled"), values.tunnel.enabled);
    updateTunnelTag();
    setInputValue("#set-close-behavior", values.closeBehavior);
    setInputValue("#set-theme", values.theme);
    setInputValue("#set-port", values.port);
    setInputValue("#set-host", values.host);
    setInputValue("#set-codex-home", values.codexHome);
    setInputValue("#set-public-url", values.publicUrl);
    setInputValue("#set-tunnel-host", values.tunnel.host);
    setInputValue("#set-tunnel-user", values.tunnel.user);
    setInputValue("#set-tunnel-port", values.tunnel.remotePort);
    setInputValue("#set-key-path", values.tunnel.keyPath);
    setInputValue("#set-known-hosts", values.tunnel.knownHostsPath);
    setInputValue("#set-log-level", values.logLevel);
    setInputValue("#set-retention", values.logRetentionDays);
    setInputValue("#set-log-dir", values.logDir);
    const codeInput = $("#set-access-code");
    if (codeInput) {
      state.settings.accessOriginal = config.accessCodeMasked || "";
      codeInput.value = state.settings.accessOriginal;
      codeInput.type = "password";
      setButtonIcon($("#btn-toggle-code"), "eye");
    }
    state.settings.baseline = values;
    state.settings.dirty = false;
    state.themePreview = false;
    clearFieldErrors();
    updateSettingsDirty();
  }

  function setInputValue(selector, value) {
    const element = $(selector);
    if (!element) return;
    const stringValue = value == null ? "" : String(value);
    if (element.tagName === "SELECT" && !Array.from(element.options).some((option) => option.value === stringValue)) return;
    element.value = stringValue;
  }

  function configToSettingsValues(config) {
    const consoleConfig = config.console || {};
    return {
      autoStart: Boolean(consoleConfig.autoStart),
      startMinimized: Boolean(consoleConfig.startMinimized),
      closeBehavior: consoleConfig.closeBehavior || "tray",
      theme: consoleConfig.theme || "system",
      port: String(config.port ?? ""),
      host: config.host || "",
      codexHome: config.codexHome || "",
      readonly: Boolean(config.readonly),
      publicUrl: config.publicUrl || "",
      tunnel: {
        enabled: Boolean(config.tunnel?.enabled),
        host: config.tunnel?.host || "",
        user: config.tunnel?.user || "",
        remotePort: String(config.tunnel?.remotePort || ""),
        keyPath: config.tunnel?.keyPath || "",
        knownHostsPath: config.tunnel?.knownHostsPath || ""
      },
      logLevel: consoleConfig.logLevel || "info",
      logRetentionDays: String(consoleConfig.logRetentionDays ?? 7),
      logDir: config.logDir || ""
    };
  }

  function readSettingsForm() {
    const value = (id) => {
      const element = document.getElementById(id);
      return element ? element.value.trim() : "";
    };
    return {
      autoStart: isToggleOn($("#set-auto-start")),
      startMinimized: isToggleOn($("#set-start-minimized")),
      closeBehavior: $("#set-close-behavior")?.value || "tray",
      theme: $("#set-theme")?.value || "system",
      port: value("set-port"),
      host: value("set-host"),
      codexHome: value("set-codex-home"),
      readonly: isToggleOn($("#set-readonly")),
      publicUrl: value("set-public-url"),
      tunnel: {
        enabled: isToggleOn($("#set-tunnel-enabled")),
        host: value("set-tunnel-host"),
        user: value("set-tunnel-user"),
        remotePort: value("set-tunnel-port"),
        keyPath: value("set-key-path"),
        knownHostsPath: value("set-known-hosts")
      },
      logLevel: $("#set-log-level")?.value || "info",
      logRetentionDays: value("set-retention"),
      logDir: value("set-log-dir")
    };
  }

  function flattenSettings(values) {
    return {
      autoStart: String(values.autoStart),
      startMinimized: String(values.startMinimized),
      closeBehavior: values.closeBehavior,
      theme: values.theme,
      port: values.port,
      host: values.host,
      codexHome: values.codexHome,
      readonly: String(values.readonly),
      publicUrl: values.publicUrl,
      "tunnel.enabled": String(values.tunnel.enabled),
      "tunnel.host": values.tunnel.host,
      "tunnel.user": values.tunnel.user,
      "tunnel.remotePort": values.tunnel.remotePort,
      "tunnel.keyPath": values.tunnel.keyPath,
      "tunnel.knownHostsPath": values.tunnel.knownHostsPath,
      logLevel: values.logLevel,
      logRetentionDays: values.logRetentionDays,
      logDir: values.logDir
    };
  }

  function settingsDirtyFields() {
    if (!state.settings.baseline) return [];
    const current = flattenSettings(readSettingsForm());
    const baseline = flattenSettings(state.settings.baseline);
    const fields = [];
    for (const key of Object.keys(current)) {
      if (String(current[key]) !== String(baseline[key])) fields.push(key);
    }
    if (accessCodeChanged()) fields.push("accessCode");
    return fields;
  }

  function accessCodeChanged() {
    const input = $("#set-access-code");
    if (!input) return false;
    const value = input.value.trim();
    return Boolean(value) && !/^•+$/.test(value) && value !== state.settings.accessOriginal;
  }

  function updateSettingsDirty() {
    const fields = settingsDirtyFields();
    state.settings.dirty = fields.length > 0;
    const bar = $("#settings-savebar");
    if (bar) bar.classList.toggle("dirty", state.settings.dirty);
    const save = $("#btn-save");
    const discard = $("#btn-discard");
    if (save) save.disabled = !state.settings.dirty || state.settings.saving;
    if (discard) discard.disabled = !state.settings.dirty || state.settings.saving;
    setText($("#save-status-text"), state.settings.saving
      ? "正在保存…"
      : state.settings.dirty
        ? `有 ${fields.length} 项未保存的更改`
        : "所有更改已保存");
    if (!state.settings.dirty && !state.settings.saving && !accessCodeChanged()) {
      state.themePreview = false;
      applyTheme(state.config?.console?.theme || "system");
    }
  }

  function validateSettings(values) {
    const errors = [];
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({ field: "port", message: "端口需为 1–65535 之间的整数。" });
    }
    if (!values.host) errors.push({ field: "host", message: "监听地址不能为空。" });
    if (!values.codexHome) errors.push({ field: "codexHome", message: "请选择 Codex 数据目录。" });
    if (values.publicUrl && !/^https?:\/\/\S+$/i.test(values.publicUrl)) {
      errors.push({ field: "publicUrl", message: "公网地址需以 http:// 或 https:// 开头。" });
    }
    if (values.tunnel.enabled) {
      if (!values.tunnel.host) errors.push({ field: "tunnel.host", message: "启用隧道时必须填写服务器地址。" });
      if (!values.tunnel.user) errors.push({ field: "tunnel.user", message: "启用隧道时必须填写 SSH 用户名。" });
      const remotePort = Number(values.tunnel.remotePort);
      if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
        errors.push({ field: "tunnel.remotePort", message: "远端端口需为 1–65535 之间的整数。" });
      }
      if (!values.tunnel.keyPath) errors.push({ field: "tunnel.keyPath", message: "请选择 SSH 密钥文件。" });
      if (!values.tunnel.knownHostsPath) errors.push({ field: "tunnel.knownHostsPath", message: "请选择 known_hosts 文件。" });
    }
    const retention = Number(values.logRetentionDays);
    if (!Number.isInteger(retention) || retention < 1 || retention > 365) {
      errors.push({ field: "logRetentionDays", message: "日志保留天数需为 1–365。" });
    }
    if (!values.logDir) errors.push({ field: "logDir", message: "日志目录不能为空。" });
    if (accessCodeChanged()) {
      const input = $("#set-access-code");
      if (input && !input.value.trim()) errors.push({ field: "accessCode", message: "访问码不能为空。" });
    }
    return errors;
  }

  function buildSavePatch(values) {
    const patch = {
      host: values.host,
      port: Number(values.port),
      codexHome: values.codexHome,
      readonly: values.readonly,
      publicUrl: values.publicUrl,
      logDir: values.logDir,
      tunnel: {
        enabled: values.tunnel.enabled,
        host: values.tunnel.host,
        user: values.tunnel.user,
        remotePort: Number(values.tunnel.remotePort) || 0,
        keyPath: values.tunnel.keyPath,
        knownHostsPath: values.tunnel.knownHostsPath
      },
      console: {
        autoStart: values.autoStart,
        startMinimized: values.startMinimized,
        closeBehavior: values.closeBehavior,
        theme: values.theme,
        logLevel: values.logLevel,
        logRetentionDays: Number(values.logRetentionDays) || 7
      }
    };
    if (accessCodeChanged()) {
      const input = $("#set-access-code");
      patch.accessCode = input.value.trim();
    }
    return patch;
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (state.settings.saving || !state.config) return;
    if (!state.settings.dirty) {
      showToast("没有需要保存的更改。", "info", 2200);
      return;
    }
    clearFieldErrors();
    const values = readSettingsForm();
    const errors = validateSettings(values);
    if (errors.length) {
      showFieldErrors(errors);
      showToast("请检查标记的设置项。", "error");
      return;
    }
    const patch = buildSavePatch(values);
    const wasActive = ["running", "starting", "restarting", "degraded"].includes(state.runtime?.state);

    state.settings.saving = true;
    updateSettingsDirty();
    const saveButton = $("#btn-save");
    const saveLabel = saveButton?.querySelector("span");
    saveButton?.classList.add("loading");
    setText(saveLabel, "保存中…");
    try {
      const result = await api.saveConfig(patch);
      if (!result || result.ok === false) {
        const list = Array.isArray(result?.errors) && result.errors.length
          ? result.errors
          : [{ field: "config", message: result?.error || "保存配置失败。" }];
        showFieldErrors(list);
        showToast("保存失败，请检查标记的设置项。", "error", 5000);
        return;
      }
      state.settings.saving = false;
      state.settings.dirty = false;
      state.themePreview = false;
      if (result.config) {
        state.config = result.config;
        updateAppInfo();
        updateConnectionInfo();
        renderSettings(result.config, true);
        applyTheme(result.config.console?.theme || "system");
      }
      if (result.runtime) updateRuntime(result.runtime);
      invalidatePairing({ reload: false });
      await refreshState({ quiet: true });
      showToast(wasActive ? "设置已保存，服务正在重启。" : "设置已保存。", "success", 4000);
    } catch (error) {
      showToast(`保存配置失败：${error?.message || error}`, "error");
    } finally {
      state.settings.saving = false;
      saveButton?.classList.remove("loading");
      setText(saveLabel || saveButton?.querySelector("span"), "保存并重启服务");
      updateSettingsDirty();
    }
  }

  function discardSettings() {
    if (!state.config) return;
    state.themePreview = false;
    renderSettings(state.config, true);
    applyTheme(state.config.console?.theme || "system");
    showToast("已放弃未保存的更改。", "info", 2200);
  }

  function showFieldErrors(errors) {
    let firstControl = null;
    for (const error of errors || []) {
      const field = String(error.field || "config");
      const target = $$("[data-error-for]").find((element) => element.dataset.errorFor === field);
      const control = $$("[data-setting]").find((element) => element.dataset.setting === field);
      if (target) {
        target.hidden = false;
        target.textContent = error.message || "该项无效。";
      } else {
        const global = $("#save-error");
        if (global) {
          global.hidden = false;
          global.textContent = error.message || "保存失败。";
        }
      }
      if (control) {
        control.classList.add("invalid");
        control.setAttribute("aria-invalid", "true");
        if (!firstControl) firstControl = control;
      }
    }
    if (firstControl) firstControl.focus();
  }

  function clearFieldError(field) {
    if (!field) return;
    const target = $$("[data-error-for]").find((element) => element.dataset.errorFor === field);
    if (target) {
      target.hidden = true;
      target.textContent = "";
    }
    const control = $$("[data-setting]").find((element) => element.dataset.setting === field);
    if (control) {
      control.classList.remove("invalid");
      control.removeAttribute("aria-invalid");
    }
    refreshSaveErrorVisibility();
  }

  function clearFieldErrors() {
    $$("[data-error-for]").forEach((element) => {
      element.hidden = true;
      element.textContent = "";
    });
    $$("[data-setting].invalid").forEach((element) => {
      element.classList.remove("invalid");
      element.removeAttribute("aria-invalid");
    });
    const global = $("#save-error");
    if (global) {
      global.hidden = true;
      global.textContent = "";
    }
  }

  function refreshSaveErrorVisibility() {
    const target = $("#save-error");
    if (!target) return;
    const hasFieldError = $$("[data-error-for]").some((element) => !element.hidden);
    if (!hasFieldError) {
      target.hidden = true;
      target.textContent = "";
    }
  }

  async function choosePathForField(button) {
    const kind = button.dataset.choose;
    const inputMap = {
      codexHome: "#set-codex-home",
      key: "#set-key-path",
      known_hosts: "#set-known-hosts",
      logDir: "#set-log-dir"
    };
    try {
      const result = await api.choosePath(kind);
      if (result?.ok && result.path) {
        const input = $(inputMap[kind]);
        if (input) {
          input.value = result.path;
          clearFieldError(input.dataset.setting);
          updateSettingsDirty();
        }
      }
    } catch (error) {
      showToast(`选择路径失败：${error?.message || error}`, "error");
    }
  }

  function generateAccessCode() {
    if (window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return String(100000 + (values[0] % 900000));
    }
    return String(100000 + Math.floor(Math.random() * 900000));
  }

  /* ------------------------------------------------------------------ */
  /* About                                                               */
  /* ------------------------------------------------------------------ */

  function bindAbout() {
    $("#btn-about-open-config")?.addEventListener("click", () => openPathSafe("config", "配置目录"));
    $("#btn-about-open-logs")?.addEventListener("click", () => openPathSafe("logs", "日志目录"));
    $("#btn-about-copy-config")?.addEventListener("click", () => {
      copyText(state.app?.configPath, "配置路径已复制");
    });
    $("#btn-about-quit")?.addEventListener("click", async () => {
      const confirmed = await openModal({
        title: "退出 Codex-Turnloom 控制台",
        message: "退出后将停止本机服务和 SSH 隧道，手机端会立即断开。Codex Desktop 和正在执行的任务不受影响。",
        confirmLabel: "退出并停止服务",
        cancelLabel: "取消",
        tone: "danger",
        icon: "power"
      });
      if (!confirmed) return;
      try {
        await api.quit();
      } catch (error) {
        showToast(`退出失败：${error?.message || error}`, "error");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard / external / paths / logs export                          */
  /* ------------------------------------------------------------------ */

  async function copyText(text, successMessage) {
    if (!text) {
      showToast("没有可复制的内容。", "warn");
      return false;
    }
    try {
      const result = await api.copy(String(text));
      if (result && result.ok === false) throw new Error("剪贴板不可用");
      showToast(successMessage || "已复制到剪贴板", "success", 2600);
      return true;
    } catch (error) {
      showToast(`复制失败：${error?.message || error}`, "error");
      return false;
    }
  }

  function openExternalSafe(url) {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return;
      Promise.resolve(api.openExternal(parsed.toString())).then((result) => {
        if (result && result.ok === false) showToast("无法打开链接。", "error");
      }).catch((error) => showToast(`无法打开链接：${error?.message || error}`, "error"));
    } catch {
      showToast("链接地址无效。", "error");
    }
  }

  async function openPathSafe(kind, label) {
    try {
      const result = await api.openPath(kind);
      if (result && result.ok === false) throw new Error(result.error || "无法打开目录");
      showToast(`${label || "目录"}已打开`, "success", 2200);
    } catch (error) {
      showToast(`无法打开${label || "目录"}：${error?.message || error}`, "error");
    }
  }

  async function exportLogs() {
    try {
      const result = await api.exportLogs();
      if (result?.ok) {
        showToast(result.filePath ? `日志已导出到 ${result.filePath}` : "日志已导出", "success", 5000);
      } else if (!result?.canceled) {
        showToast(result?.error || "导出日志失败", "error");
      }
    } catch (error) {
      showToast(`导出日志失败：${error?.message || error}`, "error");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Toasts / modal                                                      */
  /* ------------------------------------------------------------------ */

  function showToast(message, type = "info", duration = 4200) {
    const stack = $("#toast-stack");
    if (!stack) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const iconWrap = document.createElement("span");
    iconWrap.className = "toast-ic";
    iconWrap.innerHTML = icon(type === "success" ? "check" : type === "error" || type === "warn" ? "alert" : "info");
    toast.appendChild(iconWrap);
    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = message;
    toast.appendChild(body);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-x";
    close.setAttribute("aria-label", "关闭通知");
    close.innerHTML = icon("x");
    close.addEventListener("click", () => removeToast(toast));
    toast.appendChild(close);
    stack.appendChild(toast);
    while (stack.children.length > 4) stack.removeChild(stack.firstElementChild);
    const timer = window.setTimeout(() => removeToast(toast), duration);
    toast.addEventListener("mouseenter", () => clearTimeout(timer), { once: true });
  }

  function removeToast(toast) {
    if (!toast || !toast.isConnected) return;
    toast.remove();
  }

  function bindModal() {
    $("#modal-confirm")?.addEventListener("click", () => closeModal(true));
    $("#modal-cancel")?.addEventListener("click", () => closeModal(false));
    $("#modal-x")?.addEventListener("click", () => closeModal(false));
    $("#modal")?.addEventListener("mousedown", (event) => {
      if (event.target === $("#modal")) closeModal(false);
    });
    document.addEventListener("keydown", (event) => {
      const modal = $("#modal");
      if (!modal || modal.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal(false);
        return;
      }
      if (event.key === "Tab") {
        const focusables = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
          .filter((element) => element.offsetParent !== null && !element.hidden);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  function openModal(options = {}) {
    const modal = $("#modal");
    const dialog = modal?.querySelector(".modal");
    if (!modal || !dialog) return Promise.resolve(false);
    if (state.modalResolve) closeModal(false);
    state.modalReturnFocus = document.activeElement;
    const title = $("#modal-title");
    const desc = $("#modal-desc");
    const body = $("#modal-body");
    const confirm = $("#modal-confirm");
    const cancel = $("#modal-cancel");
    const close = $("#modal-x");
    setText(title, options.title || "确认操作");
    setText(desc, options.message || "");
    dialog.className = `modal${options.tone === "danger" ? " danger" : ""}`;
    const iconUse = $("#modal-icon use");
    if (iconUse) iconUse.setAttribute("href", `#i-${options.icon || "alert"}`);
    if (body) {
      body.replaceChildren();
      body.hidden = !options.imageSrc;
      if (options.imageSrc) {
        const image = document.createElement("img");
        image.src = options.imageSrc;
        image.alt = options.title || "二维码";
        body.appendChild(image);
      }
    }
    if (confirm) {
      confirm.hidden = Boolean(options.hideConfirm);
      confirm.textContent = options.confirmLabel || "确认";
      confirm.className = options.tone === "danger" ? "btn danger" : "btn primary";
    }
    if (cancel) {
      cancel.hidden = Boolean(options.singleAction);
      cancel.textContent = options.cancelLabel || "取消";
    }
    if (close) close.hidden = false;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    return new Promise((resolve) => {
      state.modalResolve = resolve;
      requestAnimationFrame(() => {
        const focusTarget = options.tone === "danger" ? cancel : confirm || dialog;
        (focusTarget || dialog).focus();
      });
    });
  }

  function closeModal(result) {
    const modal = $("#modal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    const resolve = state.modalResolve;
    state.modalResolve = null;
    if (state.modalReturnFocus && typeof state.modalReturnFocus.focus === "function") {
      try { state.modalReturnFocus.focus(); } catch { /* ignore */ }
    }
    state.modalReturnFocus = null;
    if (typeof resolve === "function") resolve(Boolean(result));
  }

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                     */
  /* ------------------------------------------------------------------ */

  function setText(element, value) {
    if (!element) return;
    const text = value == null ? "" : String(value);
    if (element.textContent !== text) element.textContent = text;
  }

  function setTextWithTitle(element, text, title) {
    if (!element) return;
    setText(element, text);
    if (element.getAttribute("title") !== (title || "")) element.setAttribute("title", title || "");
  }

  function setButtonIcon(button, name) {
    if (!button) return;
    const use = button.querySelector("use");
    if (use) use.setAttribute("href", `#i-${name}`);
  }

  function icon(name) {
    return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function isToggleOn(button) {
    return Boolean(button && button.getAttribute("aria-checked") === "true");
  }

  function setToggle(button, on) {
    if (!button) return;
    button.classList.toggle("on", Boolean(on));
    button.setAttribute("aria-checked", String(Boolean(on)));
  }

  function formatUptime(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours} 时 ${minutes} 分`;
    if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
    return `${seconds} 秒`;
  }

  function formatMemory(bytes) {
    const value = Number(bytes) || 0;
    if (!value) return "—";
    const mb = value / (1024 * 1024);
    const rounded = mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10;
    return `${rounded} MB`;
  }

  function formatStartedAt(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return "—";
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (sameDay) return `今天 ${time}`;
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`;
  }

  function timeAgo(timestamp) {
    const value = Number(timestamp);
    if (!value) return "";
    const diff = Math.max(0, Date.now() - value);
    if (diff < 60 * 1000) return "刚刚";
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
    const date = new Date(value);
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fullDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  /* ------------------------------------------------------------------ */
  /* Browser demo fallback                                               */
  /* ------------------------------------------------------------------ */

  function createDemoApi() {
    const now = Date.now();
    const demo = {
      runtimeState: "running",
      startedAt: now - (2 * 60 + 14) * 60 * 1000,
      pid: 21844,
      accessCode: "284917",
      config: {
        machineName: "办公室电脑",
        repoRoot: "C:\\Codex-Turnloom",
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        codexHome: "C:\\Users\\Lin\\.codex",
        host: "0.0.0.0",
        port: 8787,
        readonly: false,
        publicUrl: "https://office.example.com",
        logDir: "C:\\Users\\Lin\\AppData\\Local\\CodexPocket\\logs",
        tunnel: {
          enabled: true,
          host: "office.example.com",
          user: "codextunnel",
          remotePort: 29002,
          keyPath: "C:\\Users\\Lin\\.ssh\\codex_turnloom_office_ed25519",
          knownHostsPath: "C:\\Users\\Lin\\.ssh\\known_hosts"
        },
        console: {
          autoStart: true,
          startMinimized: true,
          closeBehavior: "tray",
          theme: "system",
          logLevel: "info",
          logRetentionDays: 7
        }
      },
      tasks: [
        { id: "thr_8f3a91", title: "修复登录超时问题", status: "running", interactionRequired: false, updatedAtMs: now - 120000, project: "turnloom-web" },
        { id: "thr_2c17be", title: "重构导出模块", status: "waiting", interactionRequired: true, updatedAtMs: now - 360000, project: "turnloom-web" },
        { id: "thr_91d04a", title: "整理本周工作周报", status: "ended", interactionRequired: false, updatedAtMs: now - 2 * 3600000, project: "运营" },
        { id: "thr_5a7e20", title: "检查 Android 构建", status: "ended", interactionRequired: false, updatedAtMs: now - 20 * 3600000, project: "android" },
        { id: "thr_0b4c62", title: "同步发布说明", status: "unknown", interactionRequired: false, updatedAtMs: now - 30 * 3600000, project: "" }
      ],
      logs: [],
      logListeners: new Set(),
      stateListeners: new Set(),
      taskListeners: new Set(),
      toastListeners: new Set()
    };

    const seed = [
      ["service", "info", "正在启动 Codex-Turnloom v1.0.0"],
      ["config", "info", "配置加载完成：C:\\Users\\Lin\\AppData\\Local\\CodexPocket\\config.json"],
      ["service", "info", "监听 0.0.0.0:8787（访问模式：读写）"],
      ["ipc", "ok", "已连接 Codex Desktop（clientId: desktop-7f3a…）"],
      ["health", "info", "健康检查通过；Codex 数据目录：C:\\Users\\Lin\\.codex"],
      ["tunnel", "ok", "SSH 反向隧道已建立：office.example.com:29002 → 127.0.0.1:8787"],
      ["http", "info", "GET /api/threads 200 · 84 ms"],
      ["http", "warn", "GET /api/threads 200 · 842 ms（慢请求）"],
      ["ipc", "info", "收到 turn.completed 事件，任务状态已更新"],
      ["tunnel", "error", "SSH 连接中断（exit code 255），5 秒后重试"],
      ["tunnel", "ok", "隧道已恢复，远端端口 29002"],
      ["http", "info", "手机端建立连接：192.168.1.56（GET /）"],
      ["health", "warn", "/api/health 响应 2.1 s，已自动重试"],
      ["health", "ok", "健康检查通过"],
      ["http", "info", "POST /api/send 200 · 36 ms"],
      ["log", "info", "已加载最近 500 行；自动滚动已开启"]
    ];
    let seq = 0;
    seed.forEach((item, index) => {
      const date = new Date(now - (seed.length - index) * 52 * 1000);
      demo.logs.push({
        id: ++seq,
        ts: date.getTime(),
        time: demoClock(date),
        date: demoDate(date),
        source: item[0],
        level: item[1],
        message: item[2]
      });
    });

    const snapshot = () => {
      const running = demo.runtimeState === "running";
      const starting = demo.runtimeState === "starting" || demo.runtimeState === "restarting";
      const stopped = demo.runtimeState === "stopped";
      const serviceStartedAt = running || demo.runtimeState === "degraded" ? demo.startedAt : 0;
      const label = {
        stopped: "已停止",
        starting: "启动中",
        running: "运行中",
        degraded: "部分可用",
        stopping: "停止中",
        restarting: "重启中",
        error: "启动失败"
      }[demo.runtimeState] || "已停止";
      return {
        state: demo.runtimeState,
        label,
        detail: running
          ? (demo.config.tunnel.enabled ? "本机服务与 SSH 隧道均正常" : "本机服务正常，手机端可以访问")
          : stopped
            ? "服务未启动"
            : starting
              ? "正在切换服务状态…"
              : demo.runtimeState === "error"
                ? "端口 8787 被其他程序占用（PID 19012）"
                : "正在停止服务…",
        service: {
          pid: running ? demo.pid : null,
          startedAt: serviceStartedAt || null,
          uptimeMs: serviceStartedAt ? Math.max(0, Date.now() - serviceStartedAt) : 0,
          memoryBytes: running ? 86 * 1024 * 1024 : 0,
          restartCount: 1,
          restartAttempt: 0
        },
        health: {
          ok: running,
          lastCheckAt: running ? Date.now() - 3000 : null,
          latencyMs: running ? 32 : 0,
          ipcConnected: running,
          ipcCheckAt: running ? Date.now() - 3000 : null,
          info: { version: "1.0.0" }
        },
        tunnel: {
          enabled: Boolean(demo.config.tunnel.enabled),
          state: demo.config.tunnel.enabled ? (running ? "connected" : "disabled") : "disabled",
          pid: running && demo.config.tunnel.enabled ? 31240 : null,
          attempts: 1,
          nextRetryAt: null,
          error: null
        },
        urls: {
          lan: "http://192.168.1.23:8787",
          publicUrl: demo.config.publicUrl || "",
          browser: demo.config.publicUrl || "http://192.168.1.23:8787",
          preview: "http://192.168.1.23:8787"
        },
        lastError: demo.runtimeState === "error" ? "端口 8787 已被其他程序占用。" : null
      };
    };

    const configPublic = () => ({
      ...dent(demo.config),
      tunnel: { ...demo.config.tunnel },
      console: { ...demo.config.console },
      hasAccessCode: Boolean(demo.accessCode),
      accessCodeMasked: "•".repeat(6)
    });

    const emitState = () => {
      const payload = { runtime: snapshot(), config: configPublic() };
      demo.stateListeners.forEach((callback) => {
        try { callback(payload); } catch { /* ignore */ }
      });
      return payload;
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const appendDemoLog = () => {
      if (demo.runtimeState !== "running") return;
      const date = new Date();
      const messages = [
        ["http", "info", "GET /api/health 200 · 21 ms"],
        ["http", "info", "GET /api/threads 200 · 63 ms"],
        ["ipc", "ok", "Codex IPC 心跳正常"],
        ["service", "info", "内存占用 86 MB，运行状态正常"],
        ["http", "warn", "GET /api/threads 200 · 780 ms（慢请求）"]
      ];
      const picked = messages[Math.floor(Math.random() * messages.length)];
      const entry = {
        id: ++seq,
        ts: date.getTime(),
        time: demoClock(date),
        date: demoDate(date),
        source: picked[0],
        level: picked[1],
        message: picked[2]
      };
      demo.logs.push(entry);
      if (demo.logs.length > 2000) demo.logs.shift();
      demo.logListeners.forEach((callback) => {
        try { callback([entry]); } catch { /* ignore */ }
      });
    };

    if (typeof window !== "undefined") {
      window.setInterval(() => {
        if (!document.hidden) appendDemoLog();
      }, 9000);
    }

    const saveConfigDemo = (patch = {}) => {
      const next = dent(demo.config);
      if (patch.tunnel) next.tunnel = { ...next.tunnel, ...patch.tunnel };
      if (patch.console) next.console = { ...next.console, ...patch.console };
      for (const key of ["machineName", "repoRoot", "nodePath", "codexHome", "host", "port", "readonly", "publicUrl", "logDir"]) {
        if (patch[key] !== undefined) next[key] = patch[key];
      }
      const errors = [];
      if (!Number.isInteger(Number(next.port)) || Number(next.port) < 1 || Number(next.port) > 65535) {
        errors.push({ field: "port", message: "端口需在 1–65535 之间。" });
      }
      if (!next.codexHome) errors.push({ field: "codexHome", message: "Codex 数据目录不存在。" });
      if (next.tunnel.enabled) {
        if (!next.tunnel.host) errors.push({ field: "tunnel.host", message: "启用隧道时必须填写服务器地址。" });
        if (!next.tunnel.user) errors.push({ field: "tunnel.user", message: "启用隧道时必须填写 SSH 用户名。" });
        if (!Number(next.tunnel.remotePort)) errors.push({ field: "tunnel.remotePort", message: "启用隧道时必须填写有效的远端端口。" });
        if (!next.tunnel.keyPath) errors.push({ field: "tunnel.keyPath", message: "SSH 密钥文件不存在。" });
        if (!next.tunnel.knownHostsPath) errors.push({ field: "tunnel.knownHostsPath", message: "known_hosts 文件不存在。" });
      }
      if (errors.length) return { ok: false, errors };
      next.port = Number(next.port);
      next.tunnel.remotePort = Number(next.tunnel.remotePort) || 0;
      demo.config = next;
      if (patch.accessCode) demo.accessCode = String(patch.accessCode);
      if (demo.runtimeState === "running") {
        demo.startedAt = Date.now();
      }
      return { ok: true, config: configPublic(), runtime: snapshot() };
    };

    const generatePairing = () => {
      const url = demo.config.publicUrl || "http://192.168.1.23:8787";
      const payload = `codexpocket://add?name=${encodeURIComponent(demo.config.machineName)}&url=${encodeURIComponent(url)}&token=${encodeURIComponent(demo.accessCode)}`;
      return {
        ok: true,
        payload,
        dataUrl: demoQrDataUrl(),
        machineName: demo.config.machineName,
        url,
        lanUrl: "http://192.168.1.23:8787",
        publicUrl: demo.config.publicUrl,
        accessCode: demo.accessCode,
        accessCodeMasked: "•".repeat(6)
      };
    };

    return {
      bootstrap: async () => ({
        needsSetup: false,
        config: configPublic(),
        runtime: snapshot(),
        tasks: dent(demo.tasks),
        logs: demo.logs.slice(-400),
        app: {
          version: "1.0.0",
          electron: "35.0.0-demo",
          platform: "win32",
          configPath: "C:\\Users\\Lin\\AppData\\Local\\CodexPocket\\config.json",
          appPath: "C:\\Codex-Turnloom"
        }
      }),
      getState: async () => ({ runtime: snapshot(), config: configPublic() }),
      getTasks: async () => ({ tasks: dent(demo.tasks), at: Date.now() }),
      refreshTasks: async () => ({ tasks: dent(demo.tasks), at: Date.now() }),
      getLogs: async ({ limit } = {}) => demo.logs.slice(-(Number(limit) || 400)),
      startService: async () => {
        demo.runtimeState = "starting";
        emitState();
        await sleep(650);
        demo.runtimeState = "running";
        demo.startedAt = Date.now();
        return { ok: true, ...emitState() };
      },
      stopService: async () => {
        demo.runtimeState = "stopping";
        emitState();
        await sleep(450);
        demo.runtimeState = "stopped";
        return { ok: true, ...emitState() };
      },
      restartService: async () => {
        demo.runtimeState = "restarting";
        emitState();
        await sleep(700);
        demo.runtimeState = "running";
        demo.startedAt = Date.now();
        return { ok: true, ...emitState() };
      },
      saveConfig: async (patch) => saveConfigDemo(patch),
      setAutoStart: async (enabled) => {
        demo.config.console.autoStart = Boolean(enabled);
        return { ok: true, config: configPublic() };
      },
      getPairing: async () => generatePairing(),
      savePairing: async () => {
        await downloadDemoImage(demoQrDataUrl(), "Codex-Turnloom-demo.png");
        return { ok: true, filePath: "Codex-Turnloom-demo.png" };
      },
      exportLogs: async () => {
        const text = demo.logs.map((line) => `[${line.date}] [${line.level.toUpperCase()}] [${line.source}] ${line.message}`).join("\r\n");
        downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), "Codex-Turnloom-logs-demo.txt");
        return { ok: true, filePath: "Codex-Turnloom-logs-demo.txt" };
      },
      openPath: async () => ({ ok: true }),
      openExternal: async (url) => {
        window.open(url, "_blank", "noopener");
        return { ok: true };
      },
      openPreview: async () => {
        window.open("http://192.168.1.23:8787", "_blank", "noopener");
        return { ok: true };
      },
      copy: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          return { ok: true };
        } catch {
          try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand("copy");
            textarea.remove();
            return { ok: copied };
          } catch {
            return { ok: false };
          }
        }
      },
      choosePath: async (kind) => ({
        ok: true,
        path: {
          codexHome: "C:\\Users\\Lin\\.codex",
          key: "C:\\Users\\Lin\\.ssh\\codex_turnloom_office_ed25519",
          known_hosts: "C:\\Users\\Lin\\.ssh\\known_hosts",
          logDir: "C:\\Users\\Lin\\AppData\\Local\\CodexPocket\\logs"
        }[kind] || "C:\\Users\\Lin"
      }),
      quit: async () => ({ ok: true }),
      minimize: async () => ({ ok: true }),
      maximize: async () => ({ ok: true }),
      close: async () => ({ ok: true }),
      onState: (callback) => { demo.stateListeners.add(callback); return () => demo.stateListeners.delete(callback); },
      onTasks: (callback) => { demo.taskListeners.add(callback); return () => demo.taskListeners.delete(callback); },
      onLogs: (callback) => { demo.logListeners.add(callback); return () => demo.logListeners.delete(callback); },
      onNavigate: () => () => {},
      onToast: (callback) => { demo.toastListeners.add(callback); return () => demo.toastListeners.delete(callback); },
      onTheme: () => () => {},
      onOpenPairing: () => () => {},
      platform: "win32",
      versions: {
        electron: "35.0.0-demo",
        chrome: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || "124.0.0.0",
        node: "22.0.0-demo"
      }
    };
  }

  function dent(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function demoClock(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function demoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${demoClock(date)}`;
  }

  function demoQrDataUrl() {
    const n = 25;
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    const reserved = Array.from({ length: n }, () => Array(n).fill(false));
    const finder = (x, y) => {
      for (let row = -1; row <= 7; row += 1) {
        for (let col = -1; col <= 7; col += 1) {
          const xx = x + col;
          const yy = y + row;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          reserved[yy][xx] = true;
          if (row < 0 || col < 0 || row > 6 || col > 6) {
            matrix[yy][xx] = 0;
            continue;
          }
          const edge = row === 0 || row === 6 || col === 0 || col === 6;
          const core = row >= 2 && row <= 4 && col >= 2 && col <= 4;
          matrix[yy][xx] = edge || core ? 1 : 0;
        }
      }
    };
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);
    for (let index = 8; index < n - 8; index += 1) {
      reserved[6][index] = true;
      reserved[index][6] = true;
      matrix[6][index] = index % 2 === 0 ? 1 : 0;
      matrix[index][6] = index % 2 === 0 ? 1 : 0;
    }
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (!reserved[y][x]) matrix[y][x] = random() > 0.52 ? 1 : 0;
      }
    }
    let rects = "";
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (matrix[y][x]) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><g fill="#0f172a">${rects}</g></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function downloadDemoImage(dataUrl, filename) {
    try {
      const image = new Image();
      image.decoding = "async";
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      image.src = dataUrl;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 512, 512);
      context.drawImage(image, 0, 0, 512, 512);
      const anchor = document.createElement("a");
      anchor.href = canvas.toDataURL("image/png");
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = filename.replace(/\.png$/i, ".svg");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  }
})();
