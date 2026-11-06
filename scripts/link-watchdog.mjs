#!/usr/bin/env node
/**
 * 链路守护（2026-11-05）。
 *
 * 控制台的 ServiceController 只监管自己 spawn 出来的 child，而分发器（8787）
 * 与两个后端（18788 / 8799）是开机时独立拉起的；控制台不认它们，于是「端口在
 * 但没人健康检查」，假死时不会重启。本守护按**带鉴权的真实 HTTP 健康探测**判活：
 *
 *   每 10 秒：分发器 → 各设备后端（经分发器 + 直连双路径）→ 公网入口
 *   分发器挂 → 重启 dual/server.js；后端真死（直连也失败）→ 按设备表重启；
 *   公网挂且 ssh 不在 → 重启反向隧道。全部写 watchdog.log。
 *
 *   node scripts/link-watchdog.mjs             # 前台跑一轮（诊断）
 *   node scripts/link-watchdog.mjs --loop      # 常驻
 *   node scripts/link-watchdog.mjs --install  # 注册登录自启（当前用户，不需管理员）
 *   node scripts/link-watchdog.mjs --uninstall
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const LOOP = argv.includes("--loop");
const INSTALL = argv.includes("--install");
const UNINSTALL = argv.includes("--uninstall");
const ONCE = !LOOP && !INSTALL && !UNINSTALL;

const localPath = (u) => u.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const SCRIPT = localPath(new URL(import.meta.url));
const REPO = path.resolve(path.dirname(SCRIPT), "..");
const DUAL_DIR = "项目目录\\11\\turnloom-pidesktop\\dual";
const DUAL_CONFIG = path.join(DUAL_DIR, "config.json");
const MAIN_CONFIG = path.join(process.env.LOCALAPPDATA || "", "CodexPocket", "config.json");
const LOG_DIR = path.join(process.env.LOCALAPPDATA || "", "CodexPocket", "logs");
const WATCHDOG_LOG = path.join(LOG_DIR, "watchdog.log");
const TASK_NAME = "Codex-Turnloom Link Watchdog";
const NODE = process.execPath;
// 登录自启绝不能直接 Exec node.exe：node.exe 是控制台程序，即便任务 Hidden，
// 它仍会创建可见控制台 + conhost。正解与 Turnloom PI Sidecar 一致：
// Task Scheduler -> wscript.exe //B //Nologo -> VBS -> shell.Run(cmd,0,False)。
const LAUNCHER = path.join(path.dirname(SCRIPT), "link-watchdog-launcher.vbs");
const WSCRIPT = path.join(process.env.WINDIR || "C:\\WINDOWS", "System32", "wscript.exe");

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(level, message) {
  const line = `${new Date().toISOString()} [watchdog:${level}] ${message}\n`;
  fs.appendFileSync(WATCHDOG_LOG, line);
  if (ONCE || process.env.DEBUG_WATCHDOG) process.stdout.write(line);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));

async function ping(base, token, { viaHeader = true, timeoutMs = 5000 } = {}) {
  try {
    const headers = { "content-type": "application/json" };
    if (viaHeader) headers["x-access-token"] = token;
    const auth = await fetch(`${base}/api/auth/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!auth.ok) return { ok: false, why: `auth ${auth.status}` };
    const cookie = (auth.headers.getSetCookie?.() || []).map((c) => String(c).split(";")[0]).join("; ");
    const health = await fetch(`${base}/api/health`, {
      headers: { cookie, "x-access-token": token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!health.ok) return { ok: false, why: `health ${health.status}` };
    const body = await health.json().catch(() => ({}));
    return { ok: true, home: String(body.codexHome || "") };
  } catch (error) {
    return { ok: false, why: error.name === "TimeoutError" ? "timeout" : error.message };
  }
}

function spawnHidden(command, cmd, stdoutFile, stderrFile) {
  const out = fs.openSync(stdoutFile, "a");
  const err = fs.openSync(stderrFile, "a");
  const child = spawn(command, cmd, {
    cwd: DUAL_DIR,
    windowsHide: true,
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();
  try {
    fs.closeSync(out);
    fs.closeSync(err);
  } catch {}
  return child.pid;
}

function tunnelAlive() {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq ssh.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" });
    return /ssh\.exe/i.test(out);
  } catch {
    return false;
  }
}

function startTunnel(main) {
  const t = main.tunnel || {};
  if (!t.enabled || tunnelAlive()) return false;
  const ssh = path.join(process.env.WINDIR || "C:\\WINDOWS", "System32", "OpenSSH", "ssh.exe");
  if (!fs.existsSync(ssh)) return false;
  const cmd = [
    "-i", String(t.keyPath),
    "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${t.knownHostsPath}`,
    "-N", "-R", `127.0.0.1:${t.remotePort}:127.0.0.1:${main.port}`,
    `${t.user}@${t.host}`,
  ];
  spawnHidden(ssh, cmd, path.join(LOG_DIR, "tunnel-out.log"), path.join(LOG_DIR, "tunnel-error.log"));
  log("action", `restarted ssh tunnel (${t.host}:${t.remotePort})`);
  return true;
}

function startBackend(device, main) {
  const entry = String(device.entry || "").replace(/\\\\/g, "\\") || path.join(REPO, "server.js");
  const cmd = [
    entry, "--host", "127.0.0.1", "--port", String(device.port),
    "--password", String(device.token), "--codex-home", String(device.codexHome || main.codexHome),
    "--public-url", String(main.publicUrl || ""),
    ...(device.extraArgs || []),
  ];
  const pid = spawnHidden(NODE, cmd, path.join(LOG_DIR, `backend-${device.key}.out.log`), path.join(LOG_DIR, `backend-${device.key}.err.log`));
  log("action", `restarted backend ${device.key} @${device.port} (pid ${pid})`);
}

function startDispatcher(main) {
  const cmd = [
    "server.js", "--host", "0.0.0.0", "--port", String(main.port),
    "--password", String(main.accessCode), "--codex-home", String(main.codexHome),
    "--public-url", String(main.publicUrl || ""),
  ];
  const pid = spawnHidden(NODE, cmd, path.join(LOG_DIR, "dispatcher-out.log"), path.join(LOG_DIR, "dispatcher-err.log"));
  log("action", `restarted dispatcher @${main.port} (pid ${pid})`);
}

function install() {
  // 用 Register-ScheduledTask（当前用户 Interactive/Limited），不需要管理员。
  // 动作只跑 wscript.exe：它 //B //Nologo 启动 VBS，VBS 再用
  // shell.Run(command, 0, False) 拉起 node，全链路都不会出现控制台窗口。
  if (!fs.existsSync(LAUNCHER)) {
    log("error", `launcher missing: ${LAUNCHER}`);
    process.exitCode = 1;
    return;
  }
  const q = (s) => String(s).replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `$wscript = '${q(WSCRIPT)}'`,
    `$launcher = '${q(LAUNCHER)}'`,
    // //B 批量模式不会弹 WScript 错误框；//Nologo 不显示脚本宿主横幅。
    `$action = New-ScheduledTaskAction -Execute $wscript -Argument ('//B //Nologo \"' + $launcher + '\"')`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User \"$env:USERDOMAIN\\\\$env:USERNAME\"`,
    "$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd",
    `$principal = New-ScheduledTaskPrincipal -UserId \"$env:USERDOMAIN\\\\$env:USERNAME\" -LogonType Interactive -RunLevel Limited`,
    // 先停旧任务，避免旧的 node.exe 窗口与新的 VBS 链同时常驻。
    `Stop-ScheduledTask -TaskName '${q(TASK_NAME)}' -ErrorAction SilentlyContinue`,
    `Register-ScheduledTask -TaskName '${q(TASK_NAME)}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null`,
    `Start-ScheduledTask -TaskName '${q(TASK_NAME)}'`,
    `Write-Output 'installed ${q(TASK_NAME)} (windowless wscript launcher)'`,
  ].join("; ");
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps], { encoding: "utf8" });
    log("action", `registered windowless scheduled task: ${TASK_NAME}`);
    process.stdout.write(out);
  } catch (error) {
    log("error", `install failed: ${error.message}`);
    process.exitCode = 1;
  }
}

function uninstall() {
  const q = (s) => String(s).replace(/'/g, "''");
  const ps = [
    `Stop-ScheduledTask -TaskName '${q(TASK_NAME)}' -ErrorAction SilentlyContinue`,
    `Unregister-ScheduledTask -TaskName '${q(TASK_NAME)}' -Confirm:$false`,
  ].join("; ");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps], { encoding: "utf8" });
    log("action", `removed windowless scheduled task: ${TASK_NAME}`);
  } catch (error) {
    log("error", `uninstall failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (INSTALL) {
  install();
  process.exit(process.exitCode || 0);
}
if (UNINSTALL) {
  uninstall();
  process.exit(process.exitCode || 0);
}

async function sweep() {
  let main;
  let dual;
  try {
    main = readJson(MAIN_CONFIG);
    dual = readJson(DUAL_CONFIG);
  } catch (error) {
    log("error", `config unavailable: ${error.message}`);
    return;
  }
  const devices = Array.isArray(dual.devices) ? dual.devices : [];
  const localBase = `http://127.0.0.1:${main.port}`;
  const publicBase = String(main.publicUrl || "").replace(/\/$/, "");

  const dispatcher = await ping(localBase, String(main.accessCode));
  if (dispatcher.ok) log("ok", `dispatcher ${localBase} healthy`);
  else {
    log("warn", `dispatcher ${localBase} unhealthy (${dispatcher.why})`);
    if (!ONCE) startDispatcher(main);
  }

  for (const device of devices) {
    const token = String(device.token || main.accessCode);
    const viaRouter = dispatcher.ok ? await ping(localBase, token, { viaHeader: true }) : { ok: false, why: "dispatcher down" };
    const direct = await ping(`http://127.0.0.1:${device.port}`, token, { viaHeader: false });
    if (viaRouter.ok && direct.ok) {
      log("ok", `${device.key} healthy (router + direct, ${direct.home.slice(-24)})`);
      continue;
    }
    log("warn", `${device.key} unhealthy: router=${viaRouter.ok ? "ok" : viaRouter.why} direct=${direct.ok ? "ok" : direct.why}`);
    // 只有直连也失败才说明进程真死了；仅 router 失败属于分发器/隧道问题。
    if (!direct.ok && !ONCE) startBackend(device, main);
  }

  if (publicBase) {
    const pub = await ping(publicBase, String(main.accessCode), { viaHeader: true, timeoutMs: 8000 });
    if (pub.ok) log("ok", `public ${publicBase} healthy`);
    else {
      log("warn", `public ${publicBase} unhealthy (${pub.why})`);
      if (!ONCE) startTunnel(main);
    }
  }
}

if (ONCE) {
  await sweep();
  process.exit(0);
}

const LOCK = path.join(os.tmpdir(), "codex-turnloom-watchdog.lock");
try {
  const existing = fs.readFileSync(LOCK, "utf8").trim();
  if (existing && existing !== String(process.pid)) {
    try {
      process.kill(Number(existing), 0);
      log("warn", `another watchdog is alive (pid ${existing}); exiting`);
      process.exit(0);
    } catch {}
  }
} catch {}
fs.writeFileSync(LOCK, String(process.pid));

log("info", `watchdog started (pid ${process.pid}, interval 10s)`);
await sweep();
const timer = setInterval(() => sweep().catch((e) => log("error", `sweep: ${e.message}`)), 10000);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    clearInterval(timer);
    try {
      fs.unlinkSync(LOCK);
    } catch {}
    process.exit(0);
  });
}
await new Promise(() => {});
