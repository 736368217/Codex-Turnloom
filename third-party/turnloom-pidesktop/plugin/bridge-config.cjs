"use strict";
/**
 * 桥的本地配置与访问码 —— 安装器与插件共用这一份实现。
 *
 * 为什么单独成文件：`install-plugin.cjs` 与 `plugin/main.js` 都要知道
 * "仓库根在哪" 和 "访问码是什么"。以前两处各写一遍（同一个字母表、同一个文件），
 * 迟早漂移成两个写者互相覆盖；现在只有这里一份。
 *
 * 约定：
 *   - 门面目录固定为 `~/.pidesktop-turnloom`（与 Codex 兼容门面同一个目录）。
 *   - `bridge.json` 存 `turnloomHome`（仓库根绝对路径），安装时写入；
 *     插件安装到 `<dataRoot>/plugins/installed/<id>` 后 `__dirname` 离仓库根还有四层，
 *     靠 `../../..` 猜必然猜错，所以只认文件里的绝对路径（环境变量可覆盖）。
 *   - `access-code.txt` 存手机配对用的访问码。插件托管 Turnloom 必须用固定码，
 *     否则 server.js 每次随机生成 24 字符、只在启动日志里出现一次，手机永远配不上。
 *     该文件是普通用户文件，靠用户目录 ACL 保护（Windows 上 chmod 只影响只读位，
 *     这里不假装它是 0600 的安全文件）。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const SHIM_HOME = path.join(os.homedir(), ".pidesktop-turnloom");
const BRIDGE_CONFIG_FILE = path.join(SHIM_HOME, "bridge.json");
const ACCESS_CODE_FILE = path.join(SHIM_HOME, "access-code.txt");
/** 去掉 0/O/1/I 等易混字符，手机上手输得进去。 */
const ACCESS_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ACCESS_CODE_LENGTH = 10;

function readBridgeConfig(file = BRIDGE_CONFIG_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeBridgeConfig(patch, file = BRIDGE_CONFIG_FILE) {
  const next = { ...readBridgeConfig(file), ...(patch || {}) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** 32 字符字母表 × 10 位；256 % 32 === 0，取模不引入偏差。 */
function generateAccessCode(length = ACCESS_CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += ACCESS_CODE_ALPHABET[bytes[index] % ACCESS_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * 访问码：环境变量 > 已保存的码 > 首次生成并落盘。
 * 返回 source 便于调用方决定要不要打印（安装器首次生成时打印一次给人看）。
 */
function ensureAccessCode({ env = process.env, file = ACCESS_CODE_FILE, length = ACCESS_CODE_LENGTH } = {}) {
  const fromEnv = String(env.TURNLOOM_ACCESS_CODE || "").trim();
  if (fromEnv) return { code: fromEnv, created: false, source: "env", file };
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved) return { code: saved, created: false, source: "file", file };
  } catch {
    /* 首次安装还没有码 */
  }
  const code = generateAccessCode(length);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${code}\n`, "utf8");
  } catch {
    // 落盘失败不能挡住 Turnloom 启动：本次用生成的码，下次会再生成——
    // 但至少这一轮手机能用日志里/安装器打印的那个码配对。
    return { code, created: true, source: "generated-unwritten", file };
  }
  return { code, created: true, source: "generated", file };
}

/** 三个候选按优先级排列：环境变量 > bridge.json > 就地运行的仓库布局。 */
function turnloomDirCandidates({ env = process.env, dirname, config } = {}) {
  const resolvedConfig = config === undefined ? readBridgeConfig() : config;
  return [
    { source: "env:TURNLOOM_HOME", dir: String(env.TURNLOOM_HOME || "").trim() },
    { source: "bridge.json", dir: String(resolvedConfig?.turnloomHome || "").trim() },
    { source: "layout:../../..", dir: dirname ? path.resolve(dirname, "..", "..", "..") : "" },
  ].filter((candidate) => candidate.dir);
}

/**
 * 找 Turnloom 仓库根：只认"目录下真的有 server.js"的候选。
 * 一个都没有时返回空串 + 全部候选，调用方负责把候选打进日志 ——
 * 只报一个路径的话，用户不知道是环境变量还是 bridge.json 陈旧了。
 */
function resolveTurnloomDir({
  env = process.env,
  dirname,
  config,
  exists = (dir) => fs.existsSync(path.join(dir, "server.js")),
} = {}) {
  const candidates = turnloomDirCandidates({ env, dirname, config });
  const hit = candidates.find((candidate) => exists(candidate.dir));
  return {
    dir: hit ? hit.dir : "",
    source: hit ? hit.source : "",
    candidates,
  };
}

module.exports = {
  SHIM_HOME,
  BRIDGE_CONFIG_FILE,
  ACCESS_CODE_FILE,
  ACCESS_CODE_ALPHABET,
  ACCESS_CODE_LENGTH,
  readBridgeConfig,
  writeBridgeConfig,
  generateAccessCode,
  ensureAccessCode,
  turnloomDirCandidates,
  resolveTurnloomDir,
};
