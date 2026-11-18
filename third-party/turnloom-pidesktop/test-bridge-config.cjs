"use strict";
/**
 * 桥的配置/访问码/模型目录回归测试（2026-11-18 首次安装事故）。
 *
 * 事故：插件装到 `<dataRoot>/plugins/installed/<id>` 后，`TURNLOOM_DIR` 由
 * `../../..` 解析成 `~/.pi-desktop`，于是日志只写 "turnloom server.js not found"，
 * 8799 永远起不来；同时 server.js 因为 `--password ""` 每次随机生成访问码，
 * 手机端没有任何地方能看到它 —— 桥"装了但配不上"。
 *
 * 本测试钉住：
 *   A. 仓库根解析优先级 env > bridge.json > 布局，且只认目录下真有 server.js 的候选；
 *   B. 三个候选都不成立时返回空串 + 全部候选（供日志一次性打印，不再只报一个路径）；
 *   C. 访问码稳定：已有文件时绝不重新生成；首次生成 10 位、只用无歧义字母表；
 *   D. 模型目录取 models 表与 providers.config_json 的并集（表行优先、按 provider/model 去重）；
 *   E. 停用的供应商不进入可解析索引。
 *
 * 用法：node test-bridge-config.cjs
 * 安全：不碰真实 `~/.pidesktop-turnloom`（全部注入临时路径与临时库），不需要 PI-Desktop。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const bridgeConfig = require("./plugin/bridge-config.cjs");

const fails = [];
const check = (label, condition, detail) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${!condition && detail ? " :: " + detail : ""}`);
  if (!condition) fails.push(label);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-bridge-config-"));

// ── A. resolveTurnloomDir 优先级 ─────────────────────────────────────────
{
  const configFile = path.join(tmp, "bridge.json");
  const envDir = path.join(tmp, "env-repo");
  const cfgDir = path.join(tmp, "cfg-repo");
  const layoutDir = path.join(tmp, "a", "b", "c");
  fs.mkdirSync(envDir, { recursive: true });
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.mkdirSync(layoutDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ turnloomHome: cfgDir }), "utf8");

  const allExist = (dir) => [envDir, cfgDir, layoutDir].includes(dir);
  const both = bridgeConfig.resolveTurnloomDir({
    env: { TURNLOOM_HOME: envDir },
    dirname: path.join(layoutDir, "third-party", "turnloom-pidesktop", "plugin"),
    config: bridgeConfig.readBridgeConfig(configFile),
    exists: allExist,
  });
  check("env > bridge.json > 布局：三个都成立时选 env", both.dir === envDir, both.dir);
  check("命中时回传来源，便于日志解释", both.source === "env:TURNLOOM_HOME", both.source);

  const cfgWins = bridgeConfig.resolveTurnloomDir({
    env: {},
    dirname: path.join(layoutDir, "third-party", "turnloom-pidesktop", "plugin"),
    config: bridgeConfig.readBridgeConfig(configFile),
    exists: (dir) => dir === cfgDir,
  });
  check("env 落空时退到 bridge.json", cfgWins.dir === cfgDir, cfgWins.dir);

  const layoutWins = bridgeConfig.resolveTurnloomDir({
    env: {},
    dirname: path.join(layoutDir, "third-party", "turnloom-pidesktop", "plugin"),
    config: {},
    exists: (dir) => dir === layoutDir,
  });
  check("就地运行时退到仓库布局（plugin 目录往上三层）", layoutWins.dir === layoutDir, `${layoutWins.dir} vs ${layoutDir}`);

  // ── B. 全落空：空串 + 全部候选 ─────────────────────────────────────────
  const none = bridgeConfig.resolveTurnloomDir({
    env: { TURNLOOM_HOME: envDir },
    dirname: path.join(layoutDir, "third-party", "turnloom-pidesktop", "plugin"),
    config: { turnloomHome: cfgDir },
    exists: () => false,
  });
  check("三个候选都不成立时返回空串（交给上层报错，不猜路径）", none.dir === "", none.dir);
  check("落空时回传全部候选，供日志一次性打印", none.candidates.length === 3, JSON.stringify(none.candidates));
}

// ── C. 访问码稳定 ────────────────────────────────────────────────────────
{
  const codeFile = path.join(tmp, "access-code.txt");
  const first = bridgeConfig.ensureAccessCode({ env: {}, file: codeFile });
  check("首次调用生成访问码并落盘", first.created && first.source === "generated", JSON.stringify(first));
  check("生成的码为 10 位", first.code.length === 10, first.code);
  check(
    "生成的码只用无歧义字母表（无 0/O/1/I）",
    [...first.code].every((char) => bridgeConfig.ACCESS_CODE_ALPHABET.includes(char)),
    first.code,
  );
  const again = bridgeConfig.ensureAccessCode({ env: {}, file: codeFile });
  check("已存在码文件时不再生成新码", again.code === first.code && !again.created, `${again.code} vs ${first.code}`);
  check("落盘内容与返回值一致", fs.readFileSync(codeFile, "utf8").trim() === first.code, "mismatch");

  const fromEnv = bridgeConfig.ensureAccessCode({ env: { TURNLOOM_ACCESS_CODE: "ENV-CODE" }, file: codeFile });
  check("环境变量优先于已保存的码", fromEnv.code === "ENV-CODE" && fromEnv.source === "env", JSON.stringify(fromEnv));

  const brokenFile = path.join(tmp, "nested", "dir", "code.txt");
  const nested = bridgeConfig.ensureAccessCode({ env: {}, file: brokenFile });
  check("码文件所在目录不存在时会创建", fs.existsSync(brokenFile) && nested.code.length === 10, nested.source);
}

// ── D/E. 模型目录：表行 ∪ 配置行，停用供应商排除 ─────────────────────────
{
  const dbPath = path.join(tmp, "pi.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY, name TEXT, enabled INTEGER, default_model_id TEXT, config_json TEXT
    );
    CREATE TABLE models (
      provider_id TEXT, model_id TEXT, display_name TEXT, capabilities_json TEXT
    );
  `);
  db.prepare("INSERT INTO providers (id,name,enabled,default_model_id,config_json) VALUES (?,?,?,?,?)").run(
    "P1",
    "wbfd",
    1,
    "hy4flash-free",
    JSON.stringify({
      models: [
        { id: "hy4flash-free", displayName: "hy4flash", supportsImages: true, thinkingLevels: ["high"] },
        { id: "deepseek-v4.1-flash", supportsImages: true, thinkingLevels: ["max"] },
        { id: "table-owned", displayName: "配置里的同名模型" },
      ],
    }),
  );
  db.prepare("INSERT INTO providers (id,name,enabled,default_model_id,config_json) VALUES (?,?,?,?,?)").run(
    "P2",
    "disabled",
    0,
    "ghost",
    JSON.stringify({ models: [{ id: "ghost" }] }),
  );
  // models 表里只有一行（另一个供应商的模型），这就是"混合安装"的形态。
  db.prepare("INSERT INTO models (provider_id,model_id,display_name,capabilities_json) VALUES (?,?,?,?)")
    .run("P1", "table-owned", "表里的 table-owned", '["text"]');

  // 模拟 main.js 的用法：函数自身不建库，只吃调用方给的句柄。
  // 注意顺序：仓库 package.json 是 "type": "module"，直接从仓库里 require plugin/main.js
  // 会被当成 ESM（插件真正装在 PI 的插件目录里，那份 package.json 不适用）。所以和
  // test-model-routing.cjs 一样，把插件文件复制到临时目录再加载，并把 PI_DB 指向临时库。
  process.env.TURNLOOM_ACCESS_CODE = "TEST-CODE"; // 防止加载 main.js 时写真实门面目录
  const pluginDir = path.join(tmp, "installed", "cn.star.turnloom-bridge");
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(__dirname, "plugin"))) {
    if (name === "main.js") continue;
    fs.copyFileSync(path.join(__dirname, "plugin", name), path.join(pluginDir, name));
  }
  const source = fs.readFileSync(path.join(__dirname, "plugin", "main.js"), "utf8");
  if (!source.includes("const PI_DB = resolvePiDb();")) {
    throw new Error("could not redirect PI_DB — refusing to run against the live database");
  }
  fs.writeFileSync(
    path.join(pluginDir, "main.js"),
    source.replace("const PI_DB = resolvePiDb();", `const PI_DB = ${JSON.stringify(dbPath)};`),
    "utf8",
  );
  const plugin = require(path.join(pluginDir, "main.js"));
  const configRows = plugin.modelsFromProviderConfig(db);
  const ids = configRows.map((row) => `${row.provider_id}/${row.model_id}`).sort();
  check(
    "配置里声明的模型都读得出来（models 表为空也不再是空目录）",
    ids.join(",") === "P1/deepseek-v4.1-flash,P1/hy4flash-free,P1/table-owned,P2/ghost",
    ids.join(","),
  );

  const tableRows = db
    .prepare(
      `SELECT p.id AS provider_id, p.name AS provider_name, p.enabled AS provider_enabled,
              m.model_id AS model_id, m.display_name AS display_name, m.capabilities_json AS capabilities_json
         FROM models m JOIN providers p ON p.id = m.provider_id`,
    )
    .all();
  const merged = plugin.mergeModelRows(tableRows, configRows);
  const mergedIds = merged.map((row) => `${row.provider_id}/${row.model_id}`);
  check("并集不重复（table-owned 只出现一次）", mergedIds.filter((id) => id === "P1/table-owned").length === 1, mergedIds.join(","));
  check(
    "并集同时保留表行与配置行（不再全有或全无）",
    mergedIds.includes("P1/hy4flash-free") && mergedIds.includes("P1/table-owned"),
    mergedIds.join(","),
  );
  const tableOwned = merged.find((row) => row.model_id === "table-owned");
  check("同名时表行优先（display_name 来自表）", tableOwned.display_name === "表里的 table-owned", tableOwned.display_name);

  check(
    "停用供应商的模型仍会读出来，但不进入可解析索引",
    configRows.some((row) => row.provider_id === "P2") &&
      !plugin.modelPairUsable({ providerId: "P2", modelId: "ghost" }),
    "P2/ghost",
  );
  check("启用供应商的配置模型可用（不因 models 表缺行而误判）", plugin.modelPairUsable({ providerId: "P1", modelId: "hy4flash-free" }), "P1/hy4flash-free");
  check("完全不存在的模型不可用", !plugin.modelPairUsable({ providerId: "P1", modelId: "not-a-model" }), "P1/not-a-model");
  db.close();
}

console.log(fails.length ? `\n${fails.length} failure(s)` : "\n0 failure(s)");
process.exit(fails.length ? 1 : 0);
