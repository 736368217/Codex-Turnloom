import assert from "node:assert/strict";
import test from "node:test";

import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { marked } from "marked";

import { renderMarkdown } from "../public/markdown.js";

function render(content) {
  const window = new JSDOM("<!doctype html><html><body></body></html>").window;
  const purify = createDOMPurify(window);
  return renderMarkdown(content, {
    parseMarkdown: (source, options) => marked.parse(source, options),
    sanitizeHtml: (html) => purify.sanitize(html, { USE_PROFILES: { html: true } }),
    document: window.document,
    renderPluginReference: (label) => `<span class="message-plugin-ref">${label}</span>`,
    renderLocalImage: (alt, path) => `<img class="generated-image" alt="${alt}" src="/api/local-image?path=${encodeURIComponent(path)}" />`
  });
}

test("renders GFM tables, emphasis, links, lists, and fenced code for mobile messages", () => {
  const html = render(`## 可选方案\n\n**推荐** [项目主页](https://example.com)\n\n| 项目 | 评分 |\n| --- | --- |\n| Pocket | 5 |\n\n- 第一项\n- 第二项\n\n\`inline\`\n\n\`\`\`js\nconst ready = true;\n\`\`\``);
  const document = new JSDOM(`<body>${html}</body>`).window.document;

  assert.equal(document.querySelector("h2")?.textContent, "可选方案");
  assert.equal(document.querySelector("strong")?.textContent, "推荐");
  assert.equal(document.querySelector("table.markdown-table tbody tr td")?.textContent, "Pocket");
  assert.equal(document.querySelectorAll("ul li").length, 2);
  assert.match(document.querySelector("pre code")?.textContent || "", /const ready = true/);
  const link = document.querySelector("a[href='https://example.com']");
  assert.equal(link?.getAttribute("target"), "_blank");
  assert.equal(link?.getAttribute("rel"), "noopener noreferrer");
});

test("preserves trusted local embeds and strips unsafe message HTML", () => {
  const html = render(`[@插件](plugin://example)\n\n![截图](C:\\Temp\\result.png)\n\n<img src=x onerror=alert(1)><script>alert(1)</script>[bad](javascript:alert(1))`);
  const document = new JSDOM(`<body>${html}</body>`).window.document;

  assert.equal(document.querySelector(".message-plugin-ref")?.textContent, "插件");
  assert.match(document.querySelector("img.generated-image")?.getAttribute("src") || "", /C%3A%5CTemp%5Cresult.png/);
  assert.equal(document.querySelector("script"), null);
  assert.equal(document.querySelector("img[onerror]"), null);
  assert.doesNotMatch(html, /javascript:/i);
});
