import {
  createHighlighterCore,
  type HighlighterCore,
} from 'shiki/core';
// 使用官方 JS 正则引擎：纯 JS RegExp，不实例化 WebAssembly。
// 服务端 CSP 为 script-src 'self'（无 unsafe-eval / wasm-unsafe-eval），
// oniguruma WASM 引擎会抛 CompileError 被吞掉，导致代码高亮永远停在 fallback。
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
// 语言与主题都以静态 ESM import 打进本地 bundle（同源 chunk），零 CDN、零 fetch，
// 满足 CSP script-src 'self'。
import js from 'shiki/langs/javascript.mjs';
import ts from 'shiki/langs/typescript.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import json from 'shiki/langs/json.mjs';
import bash from 'shiki/langs/bash.mjs';
import python from 'shiki/langs/python.mjs';
import diff from 'shiki/langs/diff.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import githubLight from 'shiki/themes/github-light.mjs';

const LANGS = [js, ts, jsx, tsx, json, bash, python, diff, markdown];

let highlighterPromise: Promise<HighlighterCore> | null = null;
const htmlCache = new Map<string, string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight],
      langs: LANGS,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
}

const ALIASES: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash',
  shell: 'bash', zsh: 'bash', yml: 'yaml', patch: 'diff',
  text: 'markdown', plaintext: 'markdown', txt: 'markdown',
};
const SUPPORTED = new Set([
  'javascript', 'typescript', 'jsx', 'tsx', 'json', 'bash',
  'python', 'diff', 'markdown',
]);

function normalizeLang(lang?: string): string {
  const value = String(lang || '').trim().toLowerCase();
  const mapped = ALIASES[value] || value;
  return SUPPORTED.has(mapped) ? mapped : 'markdown';
}

/** 官方 highlighter.codeToHtml + github-light，返回可注入的 HTML。 */
export async function highlightWithShiki(code: string, lang?: string): Promise<string> {
  const language = normalizeLang(lang);
  const key = `${language}\n${code}`;
  const cached = htmlCache.get(key);
  if (cached) return cached;
  try {
    const highlighter = await getHighlighter();
    const html = highlighter.codeToHtml(code, { lang: language, theme: 'github-light' });
    if (htmlCache.size > 120) htmlCache.clear();
    htmlCache.set(key, html);
    return html;
  } catch {
    return '';
  }
}
