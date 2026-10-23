"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  getState: () => ipcRenderer.invoke("runtime:state"),
  getTasks: () => ipcRenderer.invoke("runtime:tasks"),
  refreshTasks: () => ipcRenderer.invoke("tasks:refresh"),
  getLogs: (opts) => ipcRenderer.invoke("logs:get", opts),
  startService: () => ipcRenderer.invoke("service:start"),
  stopService: () => ipcRenderer.invoke("service:stop"),
  restartService: () => ipcRenderer.invoke("service:restart"),
  saveConfig: (patch) => ipcRenderer.invoke("config:save", patch),
  setAutoStart: (enabled) => ipcRenderer.invoke("config:autoStart", enabled),
  getPairing: () => ipcRenderer.invoke("pairing:get"),
  savePairing: () => ipcRenderer.invoke("pairing:save"),
  exportLogs: () => ipcRenderer.invoke("logs:export"),
  openPath: (kind) => ipcRenderer.invoke("shell:openPath", kind),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  openPreview: () => ipcRenderer.invoke("shell:openPreview"),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  choosePath: (kind) => ipcRenderer.invoke("dialog:choosePath", kind),
  quit: () => ipcRenderer.invoke("app:quit"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  detectSetup: () => ipcRenderer.invoke("setup:detect"),
  createSetup: (input) => ipcRenderer.invoke("setup:create", input),
  openConsole: () => ipcRenderer.invoke("setup:openConsole"),
  onState: (callback) => on("state:changed", callback),
  onTasks: (callback) => on("tasks:changed", callback),
  onLogs: (callback) => on("logs:appended", callback),
  onNavigate: (callback) => on("app:navigate", callback),
  onToast: (callback) => on("app:toast", callback),
  onTheme: (callback) => on("app:theme", callback),
  onOpenPairing: (callback) => on("app:open-pairing", callback),
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
};

contextBridge.exposeInMainWorld("turnloom", api);
