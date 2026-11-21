/**
 * `/api/search` 的正文索引（2.4.0）。
 *
 * 为什么不直接扫 rollout：2000 个会话的 JSONL 是几百 MB，逐次搜索都要全量解析，
 * 300ms 的门禁根本不可能过。为什么不用 FTS5：要求是「中文子串匹配，不分词」，
 * trigram 分词器对两字中文查询不成立（少于 3 个字符就没有 token），改用它就得
 * 降级成 LIKE 兜底，等于两套语义。这里用**一份只存正文的副库 + 参数化 LIKE**：
 * SQLite 的 LIKE 对 ASCII 天然大小写不敏感，对中文是纯子串，正好是要的语义。
 *
 * 索引是**增量**的：按 rollout 的 size/mtime 判定要不要重解析，单线程写入，
 * 读的时候只做一次 SELECT。正文按「最近的先收，收满 SEARCH_TEXT_BUDGET 字为止」
 * 截断，所以老到很久以前的正文可能不在索引里——这一点靠 `chars`/`capped` 披露，
 * 不靠「应该都能搜到」蒙混。
 */

const SEARCH_TEXT_BUDGET = 24 * 1024;
const MAX_QUERY_CHARS = 120;
const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 80;

/** SQLite 的 LIKE 只把 A-Z 当大小写不敏感；JS 侧切片段要用同一把尺子。 */
function foldAscii(value) {
  return String(value ?? "").replace(/[A-Z]/g, (char) => char.toLowerCase());
}

function normalizeQuery(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length > MAX_QUERY_CHARS ? chars.slice(0, MAX_QUERY_CHARS).join("") : text;
}

/** `%` `_` `\` 全部转义，配合 `LIKE ? ESCAPE '\'` 使用：用户输入不当通配符。 */
function likePattern(query) {
  const escaped = String(query ?? "").replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function snippetAround(text, query, { before = SNIPPET_BEFORE, after = SNIPPET_AFTER } = {}) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const index = foldAscii(raw).indexOf(foldAscii(query));
  if (index < 0) return raw.slice(0, before + after);
  const start = Math.max(0, index - before);
  const end = Math.min(raw.length, index + String(query).length + after);
  return `${start > 0 ? "…" : ""}${raw.slice(start, end)}${end < raw.length ? "…" : ""}`;
}

function openSearchIndex(DatabaseSync, dbPath) {
  const db = new DatabaseSync(dbPath);
  // 2000 会话的首轮索引是一条一条提交的；WAL + NORMAL 让每次提交不 fsync 日志，
  // 首轮从几十秒降到几秒。索引丢了可以重建，这里不需要 FULL 的持久性。
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs(
      thread_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      updated_at_ms INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      mtime_ms REAL NOT NULL DEFAULT 0,
      indexed_at_ms INTEGER NOT NULL DEFAULT 0,
      chars INTEGER NOT NULL DEFAULT 0,
      capped INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chunks(
      thread_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      at_ms INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      PRIMARY KEY(thread_id, seq)
    );
  `);
  const selectDoc = db.prepare("SELECT thread_id, title, project, updated_at_ms, size, mtime_ms, chars, capped FROM docs WHERE thread_id = ?");
  const deleteChunks = db.prepare("DELETE FROM chunks WHERE thread_id = ?");
  const deleteDoc = db.prepare("DELETE FROM docs WHERE thread_id = ?");
  const upsertDoc = db.prepare(`
    INSERT INTO docs(thread_id, title, project, updated_at_ms, size, mtime_ms, indexed_at_ms, chars, capped)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      title = excluded.title, project = excluded.project, updated_at_ms = excluded.updated_at_ms,
      size = excluded.size, mtime_ms = excluded.mtime_ms, indexed_at_ms = excluded.indexed_at_ms,
      chars = excluded.chars, capped = excluded.capped
  `);
  const insertChunk = db.prepare("INSERT INTO chunks(thread_id, seq, role, at_ms, text) VALUES(?, ?, ?, ?, ?)");
  const selectChunks = db.prepare(
    "SELECT thread_id, seq, role, at_ms, text FROM chunks WHERE text LIKE ? ESCAPE '\\' LIMIT ?"
  );
  const countDocs = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(chars), 0) AS chars FROM docs");
  const listDocIds = db.prepare("SELECT thread_id FROM docs");

  return {
    dbPath,
    /** 已索引的会话数量与正文字数：诊断和 `indexing` 披露都用它。 */
    stats() {
      const row = countDocs.get();
      return { threads: Number(row?.c || 0), chars: Number(row?.chars || 0) };
    },
    docFor(threadId) {
      return selectDoc.get(String(threadId)) || null;
    },
    /** 索引里现存的会话 id：用来清掉已经不在列表里的（删掉/归档/换账号）正文。 */
    allDocIds() {
      return listDocIds.all().map((row) => String(row.thread_id));
    },
    removeThread(threadId) {
      const id = String(threadId);
      db.exec("BEGIN");
      try {
        deleteChunks.run(id);
        deleteDoc.run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    /** 一条会话的正文整体替换：先删旧片段，再按 seq 顺序写入新片段。 */
    putThread({ threadId, title, project, updatedAtMs, size, mtimeMs, chunks, capped }) {
      const id = String(threadId);
      const rows = Array.isArray(chunks) ? chunks : [];
      const chars = rows.reduce((sum, row) => sum + String(row?.text || "").length, 0);
      db.exec("BEGIN");
      try {
        deleteChunks.run(id);
        upsertDoc.run(
          id,
          String(title || ""),
          String(project || ""),
          Number(updatedAtMs) || 0,
          Number(size) || 0,
          Number(mtimeMs) || 0,
          Date.now(),
          chars,
          capped ? 1 : 0
        );
        rows.forEach((row, index) => {
          insertChunk.run(id, index, String(row?.role || ""), Number(row?.atMs) || 0, String(row?.text || ""));
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { chars, capped: Boolean(capped) };
    },
    /** 参数化 LIKE 查询；命中行按 threadId 分组由调用方做，SQL 里不排序。 */
    searchContent(query, limit) {
      return selectChunks.all(likePattern(query), Math.max(1, Number(limit) || 1));
    },
    close() {
      db.close();
    }
  };
}

/**
 * 把一条会话的消息压成索引片段：只收 user/assistant 的正文，从**新到旧**收，
 * 收满预算为止（老正文进来也搜不到几次，换来的是查询恒定的扫描量）。
 */
function chunksForMessages(messages, { budget = SEARCH_TEXT_BUDGET } = {}) {
  const rows = [];
  let used = 0;
  let capped = false;
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index] || {};
    const role = String(message.role || "");
    if (role !== "user" && role !== "assistant") continue;
    const text = String(message.content || "").trim();
    if (!text) continue;
    const remaining = budget - used;
    if (remaining <= 0) {
      capped = true;
      break;
    }
    const slice = text.length > remaining ? text.slice(0, remaining) : text;
    if (slice.length < text.length) capped = true;
    rows.push({ role, atMs: Date.parse(message.timestamp) || 0, text: slice });
    used += slice.length;
  }
  return { chunks: rows.reverse(), capped, chars: used };
}

module.exports = {
  chunksForMessages,
  foldAscii,
  likePattern,
  normalizeQuery,
  openSearchIndex,
  snippetAround,
  MAX_QUERY_CHARS,
  SEARCH_TEXT_BUDGET
};
