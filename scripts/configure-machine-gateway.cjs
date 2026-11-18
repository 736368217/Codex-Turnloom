#!/usr/bin/env node
"use strict";

/**
 * Reversible, bounded one-machine pairing migration helper.
 *
 *   node scripts/configure-machine-gateway.cjs --dry-run [options]
 *   node scripts/configure-machine-gateway.cjs --apply [options]
 *
 * DEFAULT IS DRY-RUN: nothing is written, no process is started/stopped, no
 * scheduled task is touched, and no sibling repository is modified. --apply
 * writes ONLY the per-user console config.json and machine.json (with a
 * timestamped backup of each file it replaces). It never restarts a service:
 * the operator explicitly restarts the console/gateway after reviewing.
 *
 * Import is explicit: --import-config <path> may point at a legacy sibling
 * dual/config.json. That file is READ ONLY. Its real harness ports/entry/codex
 * homes/tokens are copied into the per-user machine.json; nothing is invented.
 * Tokens are never printed. Paths inside the source repository are refused for
 * writes so credentials cannot accidentally be committed.
 *
 * --disable (with --apply) is the runtime switch OFF; --restore <backup> is a
 * full config rollback. Neither deletes machine.json or stops any service.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const APP_DIR = path.resolve(__dirname, "..");
const pairing = require(path.join(APP_DIR, "shared", "machine-pairing.cjs"));
const desktopGateway = require(path.join(APP_DIR, "desktop", "service", "machine-gateway.cjs"));
const { normalizeConfig } = require(path.join(APP_DIR, "desktop", "service", "config.cjs"));

const DEFAULT_CONFIG = desktopGateway.DEFAULT_CONSOLE_CONFIG_PATH;
const DEFAULT_MACHINE = desktopGateway.DEFAULT_MACHINE_CONFIG_PATH;

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index]);
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || String(next).startsWith("--")) flags[key] = true;
    else {
      flags[key] = String(next);
      index += 1;
    }
  }
  return flags;
}

function resolveInput(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return raw ? path.resolve(raw) : "";
}

function isInsideRepo(file) {
  const relative = path.relative(APP_DIR, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function readOptionalJson(file) {
  if (!file || !fs.existsSync(file)) return { exists: false, value: null };
  return { exists: true, value: desktopGateway.readJson(file) };
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

function backupFile(file) {
  if (!fs.existsSync(file)) return "";
  const backup = `${file}.bak-${stamp()}-${crypto.randomBytes(3).toString("hex")}`;
  fs.copyFileSync(file, backup);
  try { fs.chmodSync(backup, 0o600); } catch {}
  return backup;
}

function readOptionalJson(file) {
  if (!file || !fs.existsSync(file)) return { exists: false, value: null };
  try {
    return { exists: true, value: desktopGateway.readJson(file) };
  } catch (error) {
    // Rollback/validation must still work with a corrupt machine.json.
    return { exists: true, value: null, error: error.message };
  }
}

/** Read-only plan; no writes, no network, no process control. */
function buildPlan(flags = {}) {
  const configPath = resolveInput(flags.config, process.env.TURNLOOM_CONFIG_PATH || DEFAULT_CONFIG);
  const machineConfigPath = resolveInput(flags["machine-config"], process.env.TURNLOOM_MACHINE_CONFIG_PATH || DEFAULT_MACHINE);
  const importPath = resolveInput(flags["import-config"], "");
  const mode = flags.apply === true || flags.apply === "true" ? "apply" : "dry-run";
  const disable = Boolean(flags.disable);
  const restore = resolveInput(flags.restore, "");
  const rotate = Boolean(flags["rotate-machine-token"]);
  const spawnBackends = Boolean(flags["spawn-backends"]);
  const allowRepoPaths = Boolean(flags["allow-repo-paths"]);

  if (!configPath) throw new Error("缺少控制台配置路径（--config / TURNLOOM_CONFIG_PATH）。");
  if (!machineConfigPath) throw new Error("缺少 machine.json 路径（--machine-config / TURNLOOM_MACHINE_CONFIG_PATH）。");
  if (flags["dry-run"] && flags.apply) throw new Error("--dry-run 与 --apply 不能同时使用。");
  if (disable && importPath) throw new Error("--disable 不需要 --import-config。");
  if (restore && (disable || importPath)) throw new Error("--restore 不能与 --disable / --import-config 同时使用。");

  const consoleFile = readOptionalJson(configPath);
  const consoleConfig = consoleFile.exists && consoleFile.value ? normalizeConfig(consoleFile.value) : null;
  const machineFile = readOptionalJson(machineConfigPath);
  let existingMachine = null;
  let machineConfigError = "";
  if (machineFile.exists) {
    try {
      existingMachine = desktopGateway.normalizeMachineConfig(machineFile.value, { configPath: machineConfigPath });
    } catch (error) {
      // A broken runtime machine.json must produce a readable FAILED plan,
      // never a stack trace that might echo credential-shaped values.
      machineConfigError = error.message;
    }
  }
  const requestedOrigin = String(flags.origin || "").trim();
  if (requestedOrigin && !pairing.normalizeBaseUrl(requestedOrigin)) {
    throw new Error("--origin 必须是 http(s) 根地址，不能包含路径、查询或片段。");
  }
  const origin = pairing.firstValidUrl({
    url: requestedOrigin,
    publicUrl: existingMachine?.publicUrl || consoleConfig?.publicUrl,
    lanUrl: "",
  }) || `http://127.0.0.1:${Number(consoleConfig?.port) || 8787}`;

  let machineRaw = machineFile.value;
  let importSource = "";
  let machine = null;
  let consistency = { ok: false, code: "invalid-machine-config", error: machineConfigError || "machine.json 无效" };
  let distinct = false;
  try {
    if (importPath) {
      const source = readOptionalJson(importPath);
      if (!source.exists) throw new Error(`找不到要导入的旧版配置：${importPath}`);
      machineRaw = desktopGateway.deriveMachineConfig({
        legacy: source.value,
        consoleConfig: consoleConfig || {},
        existingMachine,
        machineId: flags["machine-id"] || "",
        machineName: flags["machine-name"] || "",
        origin,
        spawnBackends,
        rotateMachineToken: rotate,
      });
      importSource = importPath;
    } else if (!machineFile.exists) {
      throw new Error("machine.json 不存在；请用 --import-config <旧版 config.json> 明确指定导入源。");
    } else if (rotate) {
      machineRaw = { ...machineFile.value, machineToken: desktopGateway.randomToken() };
    }
    machine = desktopGateway.normalizeMachineConfig(machineRaw, { configPath: machineConfigPath });
    // Pure, offline proof that the QR and /api/harnesses discovery agree.
    consistency = desktopGateway.validatePairingConsistency(machine, origin);
    distinct = machine.harnesses.every((item) => item.token !== machine.machineToken)
      && new Set(machine.harnesses.map((item) => item.token)).size === machine.harnesses.length;
  } catch (error) {
    consistency = { ok: false, code: "invalid-machine-config", error: error.message };
  }
  const nextGateway = {
    ...(consoleConfig?.machineGateway || {}),
    enabled: !disable,
    machineConfigPath,
    origin,
    spawnBackends,
  };
  if (flags["entry-path"]) nextGateway.entryPath = String(flags["entry-path"]).trim();

  const nextConsole = consoleConfig ? { ...consoleConfig, machineGateway: nextGateway } : null;
  const willWriteConsole = Boolean(nextConsole) && !disable ? true : Boolean(nextConsole);
  const errors = [];
  const rollbackOnly = Boolean(disable || restore);
  if (consoleFile.exists && !consoleConfig && !restore) {
    errors.push(`控制台配置无法解析，拒绝用默认值覆盖：${consoleFile.error || configPath}`);
  }
  // Rollback must work even when a broken machine.json caused the failure.
  if (!machine && !rollbackOnly) errors.push(`machine.json 无法使用：${consistency.error || consistency.code}`);
  if (!machine && rollbackOnly) {
    // No QR/discovery claim is made for an invalid machine config.
  } else {
    if (!distinct) errors.push("machineToken 与 harness token 必须全部互不相同。");
    if (!consistency.ok) errors.push(`二维码与发现结果不一致：${consistency.error || consistency.code}`);
    if (machine && machine.harnesses.length > 1 && machine.harnesses.some((item) => item.token === machine.machineToken)) {
      errors.push("多 harness 模式下机器访问码不能作为 harness 访问码。");
    }
  }
  if (mode === "apply" && !allowRepoPaths && (isInsideRepo(configPath) || isInsideRepo(machineConfigPath))) {
    errors.push("拒绝把含凭据的配置写入源码仓库；请使用 %LOCALAPPDATA%\\CodexPocket 或显式 --allow-repo-paths。");
  }
  if (restore && !fs.existsSync(restore)) errors.push(`找不到备份文件：${restore}`);
  if (restore) {
    const restored = readOptionalJson(restore);
    if (!restored.value || typeof restored.value !== "object") errors.push("备份文件不是有效的 JSON 对象。");
  }
  if (importPath && isInsideRepo(importPath)) {
    // Importing a repo-local example is fine (it has no secrets), but never
    // write back to it. The plan only records the path for operator review.
  }

  return {
    mode,
    disable,
    restore,
    importSource,
    spawnBackends,
    rotate,
    allowRepoPaths,
    configPath,
    machineConfigPath,
    origin,
    consoleExists: consoleFile.exists,
    machineExists: machineFile.exists,
    consoleConfig,
    nextConsole,
    machine,
    machineRaw,
    consistency,
    distinct,
    willWriteConsole,
    errors,
    redacted: {
      planVersion: 1,
      mode,
      action: restore ? "restore" : disable ? "disable" : importSource ? "import" : "validate",
      configPath,
      machineConfigPath,
      importSource,
      origin,
      spawnBackends,
      rotateMachineToken: rotate,
      machineId: machine?.machineId || "",
      machineName: machine?.machineName || "",
      defaultHarness: machine?.defaultHarnessId || "",
      machineTokenDistinctFromHarnesses: distinct,
      qrMatchesDiscovery: consistency.ok,
      harnesses: machine ? desktopGateway.redactedPlan(machine).harnesses : [],
      gatewayEnabled: !disable,
      gatewayEntry: Boolean(flags["entry-path"]) ? String(flags["entry-path"]).trim() : "(repository default)",
      writeConsoleConfig: willWriteConsole,
      writeMachineConfig: Boolean(importSource || rotate) && !restore,
      serviceControl: "none (no start / stop / kill / scheduled task changes)",
      backups: "created for every file replaced by --apply",
    },
  };
}

/** Apply the already-reviewed plan. Never starts/stops/restarts anything. */
function applyPlan(plan) {
  if (plan.errors.length) throw new Error(plan.errors[0]);
  if (plan.mode !== "apply") throw new Error("内部错误：非 --apply 计划不能写入。");
  const backups = [];
  if (plan.restore) {
    const restored = desktopGateway.readJson(plan.restore);
    const backup = backupFile(plan.configPath);
    if (backup) backups.push(backup);
    writePrivateJson(plan.configPath, restored);
    return { ok: true, action: "restore", configPath: plan.configPath, backups, restarted: false };
  }
  if (plan.willWriteConsole) {
    const backup = backupFile(plan.configPath);
    if (backup) backups.push(backup);
    writePrivateJson(plan.configPath, plan.nextConsole);
  }
  if (plan.redacted.writeMachineConfig) {
    const backup = backupFile(plan.machineConfigPath);
    if (backup) backups.push(backup);
    writePrivateJson(plan.machineConfigPath, plan.machineRaw);
  }
  return {
    ok: true,
    action: plan.disable ? "disable" : plan.importSource ? "import" : "enable",
    configPath: plan.configPath,
    machineConfigPath: plan.machineConfigPath,
    backups,
    restarted: false,
  };
}

/** Read-only HTTP validation: no tokens in URLs, stdout, or logs. */
async function probe(plan, flags = {}) {
  const fallback = `http://127.0.0.1:${Number(plan.consoleConfig?.port) || 8787}`;
  const target = pairing.firstValidUrl({ url: flags["probe-url"], publicUrl: "", lanUrl: fallback }) || fallback;
  if (!plan.machine) {
    return { target, ok: false, code: "invalid-machine-config", error: "machine.json 无效，无法验证发现接口", harnessCount: 0, defaultHarnessId: "", harnesses: [] };
  }
  const result = await desktopGateway.checkGatewayDiscovery({
    origin: target,
    machine: plan.machine,
    timeoutMs: 2500,
  });
  return {
    target,
    ok: result.ok,
    code: result.code || "",
    error: result.error || "",
    harnessCount: result.harnessCount || 0,
    defaultHarnessId: result.defaultHarnessId || "",
    harnesses: result.harnesses || [],
  };
}

function report(plan, applyResult = null, probeResult = null) {
  const lines = [];
  lines.push(`[configure-machine-gateway] mode=${plan.mode} action=${plan.redacted.action}`);
  lines.push(`  console config : ${plan.configPath}${plan.consoleExists ? "" : " (missing)"}`);
  lines.push(`  machine config : ${plan.machineConfigPath}${plan.machineExists ? "" : " (missing)"}`);
  if (plan.importSource) lines.push(`  import source  : ${plan.importSource} (read-only)`);
  const qrState = !plan.machine && (plan.disable || plan.restore)
    ? "not required for rollback"
    : plan.consistency.ok ? "consistent" : `INCONSISTENT (${plan.consistency.code})`;
  lines.push(`  QR / discovery : ${qrState}`);
  lines.push(`  machine token  : distinct=${plan.distinct}, value=<redacted>`);
  lines.push(`  machine        : id=${plan.machine?.machineId || "-"}, name=${plan.machine?.machineName || "-"}, default=${plan.machine?.defaultHarnessId || "-"}`);
  lines.push(`  origin         : ${plan.origin}`);
  for (const harness of plan.redacted.harnesses) {
    lines.push(`  harness        : ${harness.id} (${harness.name}) port=${harness.port} tokenPresent=${harness.tokenPresent} spawn=${harness.spawn}`);
  }
  lines.push(`  gateway spawn  : spawnBackends=${plan.spawnBackends} (${plan.spawnBackends ? "gateway supervises backends" : "--no-spawn; external backends untouched"})`);
  lines.push(`  service control: ${plan.redacted.serviceControl}`);
  if (plan.errors.length) {
    lines.push("  VALIDATION FAILED:");
    for (const error of plan.errors) lines.push(`    - ${error}`);
  } else {
    lines.push("  validation     : OK (config shape, distinct tokens, QR/discovery identity)");
  }
  if (probeResult) {
    lines.push(`  live probe     : ${probeResult.ok ? "verified" : `FAILED (${probeResult.code})`} ${probeResult.target}`);
    if (probeResult.ok) {
      lines.push(`    harnesses    : ${probeResult.harnessCount}, default=${probeResult.defaultHarnessId}`);
      for (const item of probeResult.harnesses) lines.push(`    - ${item.id} (${item.name}) kind=${item.kind} default=${item.defaultHarness}`);
    } else if (probeResult.error) {
      lines.push(`    reason       : ${probeResult.error}`);
    }
  }
  if (applyResult) {
    lines.push(`  apply result   : ${applyResult.action}, restarted=${applyResult.restarted}`);
    for (const backup of applyResult.backups) lines.push(`  backup         : ${backup}`);
    lines.push("  NEXT (operator): restart the console/gateway explicitly; no service was stopped or started.");
  } else if (plan.mode === "dry-run" && !plan.errors.length) {
    lines.push("  NEXT (operator): review, then re-run with --apply (or --apply --disable to roll back the switch).");
  }
  lines.push("  tokens never printed; backups contain credentials and live only in the per-user config directory.");
  return lines.join("\n");
}

function help() {
  return [
    "Codex-Turnloom one-machine pairing migration helper (default: --dry-run)",
    "",
    "  node scripts/configure-machine-gateway.cjs --dry-run [options]",
    "  node scripts/configure-machine-gateway.cjs --apply   [options]",
    "",
    "Options:",
    "  --config <path>            Console config.json (default %LOCALAPPDATA%\\CodexPocket\\config.json)",
    "  --machine-config <path>    Runtime machine.json (default %LOCALAPPDATA%\\CodexPocket\\machine.json)",
    "  --import-config <path>     READ-ONLY legacy dual/config.json to import real harnesses",
    "  --origin <url>             Stable QR/gateway origin (http(s) root only)",
    "  --machine-id <id>          Override stable machine id (otherwise kept from machine.json)",
    "  --machine-name <name>      Override displayed machine name",
    "  --spawn-backends           Let the gateway supervise backends (default: --no-spawn, external owners untouched)",
    "  --rotate-machine-token     Explicitly rotate the machine token (phones must re-scan)",
    "  --entry-path <path>        Override server/machine-gateway.cjs path",
    "  --disable                  Switch runtime back to legacy single-harness mode (keeps machine.json)",
    "  --restore <backup.json>    Restore a console config backup (keeps machine.json)",
    "  --probe                    Read-only live discovery check (no writes, no restarts)",
    "  --probe-url <url>          Probe URL (default http://127.0.0.1:<port>)",
    "  --allow-repo-paths         Permit writing configs inside the source repo (NOT recommended)",
    "  --json                     Machine-readable redacted plan on stdout",
    "",
    "Env: TURNLOOM_CONFIG_PATH, TURNLOOM_MACHINE_CONFIG_PATH",
    "Safety: no secrets on stdout, no git-tracked credentials, no process/task changes,",
    "        per-user config only, timestamped backups before every replaced file.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help || flags.h) {
    process.stdout.write(`${help()}\n`);
    return 0;
  }
  const plan = buildPlan(flags);
  let applyResult = null;
  let probeResult = null;
  if (flags.probe) probeResult = await probe(plan, flags);
  if (plan.mode === "apply" && !plan.errors.length) applyResult = applyPlan(plan);
  if (flags.json === true || flags.json === "true") {
    process.stdout.write(`${JSON.stringify({
      ...plan.redacted,
      errors: plan.errors,
      applied: applyResult,
      probe: probeResult,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${report(plan, applyResult, probeResult)}\n`);
  }
  if (plan.errors.length) return 2;
  if (probeResult && !probeResult.ok && !plan.disable) return 3;
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    // Error text must never contain a token; the shared config paths are fine.
    process.stderr.write(`[configure-machine-gateway] ${String(error.message || error).replace(/(token|accessCode|password)\s*[:=]\s*\S+/gi, "$1=<redacted>")}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, buildPlan, applyPlan, probe, report, help, isInsideRepo, stamp };
