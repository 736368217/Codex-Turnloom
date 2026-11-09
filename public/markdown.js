function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fallbackMarkdown(content) {
  return `<p>${escapeHtml(content).replaceAll("\n", "<br>")}</p>`;
}

function markerPrefix(content) {
  let attempt = 0;
  let prefix = "";
  do {
    prefix = `@@CODEXPOCKET${Date.now().toString(36)}${attempt.toString(36)}@@`;
    attempt += 1;
  } while (String(content).includes(prefix));
  return prefix;
}

function decorateRenderedHtml(html, document) {
  const container = document.createElement("div");
  container.innerHTML = html;
  for (const link of container.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
  for (const image of container.querySelectorAll("img")) {
    image.classList.add("markdown-image");
    image.setAttribute("loading", "lazy");
  }
  for (const table of container.querySelectorAll("table")) {
    table.classList.add("markdown-table");
  }
  return container.innerHTML;
}

export function renderMarkdown(
  content,
  {
    parseMarkdown,
    sanitizeHtml,
    document = globalThis.document,
    renderPluginReference = () => "",
    renderLocalImage = () => ""
  } = {}
) {
  const source = String(content || "");
  if (!source) return "";
  if (typeof parseMarkdown !== "function" || typeof sanitizeHtml !== "function" || !document?.createElement) {
    return fallbackMarkdown(source);
  }

  const prefix = markerPrefix(source);
  const replacements = [];
  const placeholder = (html) => {
    const token = `${prefix}${replacements.length}@@`;
    replacements.push({ token, html });
    return token;
  };
  const withEmbeds = source
    .replace(/\[@([^\]\n]+)\]\((plugin:\/\/[^)\s]+)\)/g, (_match, label, uri) => placeholder(renderPluginReference(label, uri)))
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+\.(?:png|jpe?g|webp|gif|bmp|svg))\)/gi,
      (_match, alt, imagePath) => placeholder(renderLocalImage(alt, imagePath))
    );
  const parsed = parseMarkdown(withEmbeds, { gfm: true, breaks: true });
  const sanitized = sanitizeHtml(parsed);
  // marked / DOMPurify 缺失时上游的箭头函数返回 undefined：必须退回转义文本，
  // 否则 decorateRenderedHtml 会把 undefined 写成字面量，用户看到的是一条“空消息”。
  if (typeof sanitized !== "string" || !sanitized.trim()) return fallbackMarkdown(source);
  let rendered = decorateRenderedHtml(sanitized, document);
  // 必须用函数式替换：字符串形式的 replaceAll 会把 $&、$'、$` 当成替换语法，
  // 消息里出现 alt="a$'b" 就能让占位符漏出、或把整段 HTML 复制一遍。
  for (const replacement of replacements) {
    rendered = rendered.replaceAll(replacement.token, () => replacement.html);
  }
  return rendered;
}
