"use strict";

const { execFileAsync } = require("./health.cjs");

const TASK_NAME = "Codex Pocket Supervisor";

async function taskExists() {
  const result = await execFileAsync("schtasks.exe", ["/Query", "/TN", TASK_NAME], { timeout: 5000 });
  return result.ok;
}

async function powershellJson(script) {
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8000 });
  if (!result.ok) return [];
  try { return JSON.parse(result.stdout.trim() || "[]"); } catch { return []; }
}

async function stopLegacySupervisor(config, logger) {
  if (!config) return { migrated: false };
  if (process.env.TURNLOOM_SKIP_LEGACY_MIGRATION === "1") return { migrated: false };
  const exists = await taskExists();
  if (!exists) return { migrated: false };

  logger.info("migration", "检测到旧版 Codex Pocket Supervisor 计划任务，开始迁移。");
  await execFileAsync("schtasks.exe", ["/End", "/TN", TASK_NAME], { timeout: 8000 });

  const repoPattern = String(config.repoRoot || "").replace(/'/g, "''");
  const port = Number(config.port) || 8787;
  const nodeScript = `$items = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${repoPattern}') -and $_.CommandLine.Contains('--port ${port}') } | Select-Object -ExpandProperty ProcessId; if ($items) { $items | ConvertTo-Json -Compress } else { '[]' }`;
  const nodePids = await powershellJson(nodeScript);
  for (const pid of nodePids) {
    if (!Number(pid)) continue;
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeout: 5000 });
    logger.info("migration", `已结束旧服务进程 PID ${pid}。`);
  }

  if (config.tunnel?.enabled && config.tunnel?.remotePort) {
    const marker = `127.0.0.1:${config.tunnel.remotePort}:127.0.0.1:${port}`;
    const sshScript = `$items = Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${marker}') } | Select-Object -ExpandProperty ProcessId; if ($items) { $items | ConvertTo-Json -Compress } else { '[]' }`;
    const sshPids = await powershellJson(sshScript);
    for (const pid of sshPids) {
      if (!Number(pid)) continue;
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeout: 5000 });
      logger.info("migration", `已结束旧隧道进程 PID ${pid}。`);
    }
  }

  await execFileAsync("schtasks.exe", ["/Delete", "/TN", TASK_NAME, "/F"], { timeout: 8000 });
  logger.info("migration", "旧版计划任务已停止并移除，控制台已接管服务管理。");
  return { migrated: true };
}

module.exports = { stopLegacySupervisor, TASK_NAME };
