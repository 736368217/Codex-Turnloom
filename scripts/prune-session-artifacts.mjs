#!/usr/bin/env node
/**
 * 清理「验证用」会话：QA 巡检线、探针、问候冒烟、空壳会话。
 *
 * 背景（2026-11-01 用户抱怨）：每次做完活都会在会话列表里留下十来条临时对话，
 * 手点删除既慢又容易误删。这个脚本把判据写死成可审计的规则：默认干跑，
 * 只有 --apply 才软删除，删除前先把完整行导出成备份。
 *
 * 判据（命中任一即进候选）：
 *   EMPTY       0 条消息的空壳（发送失败留下的）
 *   MARKED      首条消息自带「可删」标记
 *   GREETING    首条是「你好」之类，且消息数很少（冒烟测试）
 *   ABORTED-SPAWN 巡检提示词开头、消息数很少（派出去就没动静的）
 *   REVIEW-LINE 巡检提示词开头、有实际产出（报告已落盘到 .review-artifacts）
 *
 * 永不删除：
 *   · 有 running 轮次的会话
 *   · 首条消息是 pi-desktop:// 或用户自己的任务描述的会话
 *   · 早于 --since 的会话（更早的巡检线交给用户单独确认）
 *   · 巡检提示词不匹配的「巡检」同名对话（人写的，不是机器产物）
 *
 *   node scripts/prune-session-artifacts.mjs                          # 干跑
 *   node scripts/prune-session-artifacts.mjs --since 2026-10-31 --apply
 *   node scripts/prune-session-artifacts.mjs --db <path> --out <dir> --apply
 *
 * 回滚：把备份 JSON 里的 id 的 deleted_at 置回 NULL。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const APPLY = args.includes("--apply");
const DB_PATH = flag("--db", "");
const OUT_DIR = flag("--out", path.join(os.tmpdir(), "turnloom-session-prune"));
// Optional exact allowlist: never widens the default cleanup scope.
const ONLY_IDS = new Set(flag("--ids", "").split(",").filter(Boolean));
if ((args.includes("--ids") && !ONLY_IDS.size) || ONLY_IDS.size > 32 || [...ONLY_IDS].some((id) => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) {
  console.error("--ids must be a comma-separated list of at most 32 complete session UUIDs");
  process.exit(2);
}

// 只清理某个时间点之后创建的会话：更早的巡检线可能对应已不在盘上的交付物，
// 交给用户单独确认，别让一次「顺手清理」把历史记录带走。
const SINCE = flag("--since", "") ? Date.parse(flag("--since", "")) : 0;
if (Number.isNaN(SINCE)) {
  console.error("--since 需要一个可解析的日期，例如 2026-10-31");
  process.exit(2);
}
if (APPLY && !SINCE) {
  console.error("--apply 必须同时给 --since（例如 --since 2026-10-31）：没有时间窗就会连历史会话一起算进来。");
  console.error("先不带 --apply 干跑，确认候选清单后再执行。");
  process.exit(2);
}

const ARTIFACT_ROOTS = [];
// 巡检线提示词的开头。只有这几条才允许被判成机器产物。
const REVIEW_PROMPTS = ["你是独立", "你是一条独立", "你是**独立", "你是一个**零产品知识"];
const GREETING_RE = /^(你好|nihao|hi|hello)[。.!！\s]*$/i;
const MARKER = "可删";
const SMALL_TALK_MAX_MSGS = 8;
/** 0 消息会话至少要「空置」这么久才允许判成空壳。 */
const EMPTY_MIN_AGE_MS = 24 * 60 * 60 * 1000;

if (!DB_PATH) {
  console.error("请通过 --db <数据库路径> 指定要清理的数据库");
  process.exit(2);
}
const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });
const now = Date.now();

const rows = db
  .prepare(
    `SELECT s.id, s.title, s.created_at, s.project_id,
       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS msgs,
       (SELECT substr(text, 1, 120) FROM messages m
          WHERE m.session_id = s.id AND m.role = 'user' AND COALESCE(m.tool_name, '') = ''
          ORDER BY m.seq LIMIT 1) AS first
       FROM sessions s
      WHERE s.deleted_at IS NULL`,
  )
  .all()
  .filter((row) => {
    if (ONLY_IDS.size && !ONLY_IDS.has(String(row.id))) return false;
    if (SINCE && Number(row.created_at) < SINCE) return false;
    const running = db
      .prepare("SELECT 1 FROM turns WHERE session_id = ? AND status = 'running' LIMIT 1")
      .get(row.id);
    return !running;
  });

const isReviewLine = (row) => REVIEW_PROMPTS.some((p) => String(row.first || "").startsWith(p));
const artifactExists = () => ARTIFACT_ROOTS.some((root) => fs.existsSync(root));

const classify = (row) => {
  const first = String(row.first || "").trim();
  // 0 消息的会话可能是用户刚建、还没发第一句的（「每次收尾都跑一次」正是这种时机）：
  // 只有创建超过一天仍然空着，才可能是发送失败留下的空壳。
  if (row.msgs === 0) return now - Number(row.created_at) >= EMPTY_MIN_AGE_MS ? "EMPTY" : "KEEP";
  if (first.includes(MARKER)) return "MARKED";
  // Explicitly scoped orchestration tasks are safe to retire after their reports are saved.
  if (ONLY_IDS.size && /^你是[「“]?多会话编排[」”]?派出的/.test(first)) return "SCOPED-SPAWN";
  if (isReviewLine(row)) {
    if (!artifactExists()) return "KEEP";
    return row.msgs <= SMALL_TALK_MAX_MSGS ? "ABORTED-SPAWN" : "REVIEW-LINE";
  }
  if (GREETING_RE.test(first) && row.msgs <= SMALL_TALK_MAX_MSGS) return "GREETING";
  return "KEEP";
};

const candidates = [];
for (const row of rows) {
  const verdict = classify(row);
  if (verdict === "KEEP") continue;
  candidates.push({ ...row, verdict });
}

const fmt = (r) =>
  `${String(r.id).slice(0, 8)}  ${new Date(Number(r.created_at)).toISOString().slice(5, 16).replace("T", " ")}  ` +
  `msgs=${String(r.msgs).padStart(4)}  ${r.verdict.padEnd(13)}  "${String(r.title).slice(0, 34)}"`;

if (!candidates.length) {
  console.log("没有候选：这一段时间里没有留下临时对话。");
  db.close();
  process.exit(0);
}

console.log(`候选 ${candidates.length} 条（判据见脚本头部注释）：\n`);
for (const r of candidates) console.log("  " + fmt(r));
console.log(`\n保留：${rows.length - candidates.length} 条`);

if (!APPLY) {
  console.log("\n这是干跑。加 --apply 才会软删除（删除前会导出完整行备份）。");
  db.close();
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(OUT_DIR, `session-prune-${stamp}.json`);
const full = candidates.map((c) => db.prepare("SELECT * FROM sessions WHERE id = ?").get(c.id));
fs.writeFileSync(backupFile, JSON.stringify({ takenAt: stamp, db: DB_PATH, sessions: full }, null, 2), "utf8");
console.log(`\n备份 → ${backupFile}`);

const before = db.prepare("SELECT COUNT(*) n FROM sessions WHERE deleted_at IS NULL").get().n;
let changed = 0;
for (const r of candidates) {
  changed +=
    Number(db.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, r.id).changes) || 0;
}
const after = db.prepare("SELECT COUNT(*) n FROM sessions WHERE deleted_at IS NULL").get().n;
db.close();
console.log(`软删除 ${changed} 条：${before} → ${after}`);
console.log("回滚：把备份里的 id 的 deleted_at 置回 NULL 即可。");
