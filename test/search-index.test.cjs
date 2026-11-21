"use strict";

/**
 * `server/search-index.cjs` 的纯函数（2.4.0 正文搜索）。
 *
 * 黑盒契约（`tools/qa/check-search-api.mjs`，Vera 维护）证明 HTTP 行为；
 * 这里钉住实现里最容易悄悄变的那几个语义：
 *   - 中文子串按字符匹配，ASCII 只折叠 A-Z（SQLite LIKE 的同一把尺子）；
 *   - `%` / `_` / `\` 必须被转义成字面量，用户输入不能当通配符；
 *   - 片段要截在命中词附近，且带省略号；
 *   - 正文预算从**新到旧**收，超了要 `capped: true`，不许静默丢。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  chunksForMessages,
  foldAscii,
  likePattern,
  normalizeQuery,
  openSearchIndex,
  snippetAround,
  MAX_QUERY_CHARS
} = require("../server/search-index.cjs");

test("foldAscii 只折叠 A-Z：中文、全角与其它语言原样保留", () => {
  assert.equal(foldAscii("DEF def"), "def def");
  assert.equal(foldAscii("深空ABC计划"), "深空abc计划");
  assert.equal(foldAscii("ÄÖÜ"), "ÄÖÜ");
  assert.equal(foldAscii(null), "");
});

test("normalizeQuery 去空白并把长度截到上限", () => {
  assert.equal(normalizeQuery("  深空   计划 "), "深空 计划");
  assert.equal(normalizeQuery("   "), "");
  const long = "字".repeat(MAX_QUERY_CHARS + 10);
  assert.equal(Array.from(normalizeQuery(long)).length, MAX_QUERY_CHARS);
});

test("likePattern 把 % _ \\ 转成字面量，交给 LIKE ? ESCAPE '\\'", () => {
  assert.equal(likePattern("100%"), "%100\\%%");
  assert.equal(likePattern("a_b"), "%a\\_b%");
  assert.equal(likePattern("C:\\tmp"), "%C:\\\\tmp%");
  assert.equal(likePattern("深空"), "%深空%");
});

test("snippetAround 在命中词附近截断，前后加省略号", () => {
  const text = `${"前".repeat(80)}深空站${"后".repeat(200)}`;
  const snippet = snippetAround(text, "深空站", { before: 10, after: 10 });
  assert.ok(snippet.includes("深空站"), snippet);
  assert.ok(snippet.startsWith("…"), snippet);
  assert.ok(snippet.endsWith("…"), snippet);
  assert.ok(snippet.length < text.length);
  // ASCII 命中按折叠后的位置算，但不能把原文大小写改掉。
  assert.ok(snippetAround("Def Build is green", "def build").includes("Def Build"));
});

test("chunksForMessages 从新到旧收满预算，超出必须披露 capped", () => {
  const messages = [
    { role: "user", content: "最老的一句", timestamp: "2026-11-21T00:00:00.000Z" },
    { role: "assistant", content: "中间一句", timestamp: "2026-11-21T00:00:01.000Z" },
    { role: "user", content: "最新一句", timestamp: "2026-11-21T00:00:02.000Z" },
    { role: "tool", content: "工具输出不该进索引", timestamp: "2026-11-21T00:00:03.000Z" }
  ];
  const all = chunksForMessages(messages, { budget: 1024 });
  assert.deepEqual(all.chunks.map((row) => row.text), ["最老的一句", "中间一句", "最新一句"]);
  assert.equal(all.capped, false);

  const capped = chunksForMessages(messages, { budget: 5 });
  assert.equal(capped.capped, true);
  // 从新到旧：最新一条完整保留；剩余 1 个字符的预算只能装下上一条的开头，
  // 这是「截断」而不是「丢弃」，所以 capped 必须为真。
  assert.equal(capped.chunks.at(-1).text, "最新一句");
  assert.equal(capped.chars, 5);
  assert.ok(capped.chunks.length >= 1);
});

test("openSearchIndex 用参数化 LIKE 检索，% 只命中字面量", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turnloom-search-index-"));
  const dbPath = path.join(dir, "index.sqlite");
  const index = openSearchIndex(DatabaseSync, dbPath);
  try {
    index.putThread({
      threadId: "t1",
      title: "深空调试",
      project: "深空计划",
      updatedAtMs: 1,
      size: 10,
      mtimeMs: 1,
      chunks: [{ role: "assistant", atMs: 1, text: "覆盖率 100% 通过；命名 a_b。" }],
      capped: false
    });
    index.putThread({
      threadId: "t2",
      title: "无关",
      project: "",
      updatedAtMs: 2,
      size: 10,
      mtimeMs: 2,
      chunks: [{ role: "user", atMs: 2, text: "一百个百分点" }],
      capped: false
    });
    assert.deepEqual(index.searchContent("100%", 10).map((row) => row.thread_id), ["t1"]);
    assert.deepEqual(index.searchContent("a_b", 10).map((row) => row.thread_id), ["t1"]);
    assert.deepEqual(index.searchContent("a%b", 10), []);
    assert.equal(index.stats().threads, 2);

    // 同 id 再写一次是整体替换，不是追加。
    index.putThread({
      threadId: "t1",
      title: "深空调试",
      project: "深空计划",
      updatedAtMs: 3,
      size: 11,
      mtimeMs: 3,
      chunks: [{ role: "assistant", atMs: 3, text: "已经改完了。" }],
      capped: false
    });
    assert.deepEqual(index.searchContent("100%", 10), []);
    assert.deepEqual(index.searchContent("改完", 10).map((row) => row.thread_id), ["t1"]);
    assert.equal(index.docFor("t1").size, 11);
  } finally {
    index.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
