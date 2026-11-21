/**
 * 2.4.0 搜索结果的纯逻辑：归一化、分组、命中高亮、旧服务端回退。
 *
 * 服务端契约（Atlas）：GET /api/search -> { ok, query, took,
 * results: [{ kind:'thread'|'message', threadId, title, project,
 *             field:'title'|'project'|'content', snippet, at }] }.
 * 这里不做网络，任何字段缺失都降级而不是伪造。
 */

export type SearchField = 'title' | 'project' | 'content';
export type SearchKind = 'thread' | 'message';

export interface SearchHit {
  kind: SearchKind;
  threadId: string;
  title: string;
  project: string;
  field: SearchField;
  snippet: string;
  at: number;
}

export interface SearchGroups {
  threads: SearchHit[];
  messages: SearchHit[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function atMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function fieldOf(value: unknown, kind: SearchKind): SearchField {
  if (value === 'title' || value === 'project' || value === 'content') return value;
  return kind === 'message' ? 'content' : 'title';
}

/** Keep only rows the UI can actually open; never invent a thread id. */
export function normalizeSearchHits(raw: unknown): SearchHit[] {
  if (!Array.isArray(raw)) return [];
  const hits: SearchHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const threadId = text(row.threadId) || text(row.thread_id);
    if (!threadId) continue;
    const field = fieldOf(row.field, row.kind === 'message' ? 'message' : 'thread');
    const kind: SearchKind = row.kind === 'message' || field === 'content' ? 'message' : 'thread';
    hits.push({
      kind,
      threadId,
      title: text(row.title) || '未命名会话',
      project: text(row.project) || text(row.projectName),
      field,
      snippet: text(row.snippet) || text(row.preview),
      at: atMs(row.at) || atMs(row.updatedAt) || atMs(row.updatedAtMs),
    });
  }
  return hits;
}

/**
 * 会话组在前、内容命中组在后；组内保持服务端顺序（服务端已按标题/项目
 * 命中优先排序）。同一条消息重复返回不合并——它们可能是不同的命中片段。
 */
export function groupSearchHits(hits: SearchHit[]): SearchGroups {
  return {
    threads: hits.filter((hit) => hit.kind === 'thread'),
    messages: hits.filter((hit) => hit.kind === 'message'),
  };
}

export interface HighlightPart { text: string; hit: boolean }

/**
 * 子串高亮：中文不分词，ASCII 大小写不敏感。返回原文字符，不返回 HTML，
 * 让 React 自己转义（片段来自服务端，绝不能拼 innerHTML）。
 */
export function highlightParts(value: string, query: string, maxParts = 60): HighlightPart[] {
  const source = String(value || '');
  const needle = String(query || '').trim();
  if (!source) return [];
  if (!needle) return [{ text: source, hit: false }];
  const lower = source.toLowerCase();
  const target = needle.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;
  let at = lower.indexOf(target);
  while (at >= 0 && parts.length < maxParts) {
    if (at > cursor) parts.push({ text: source.slice(cursor, at), hit: false });
    parts.push({ text: source.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
    at = lower.indexOf(target, cursor);
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), hit: false });
  return parts;
}

interface LocalThread {
  id?: string;
  title?: string;
  name?: string;
  preview?: string;
  project?: { name?: string } | null;
}

/**
 * Old hosts without /api/search: match title, project and preview only.
 * The thread id is deliberately NOT searchable (a single letter used to match
 * a pile of uuids and filled the list with rows that had no text hit).
 */
export function localThreadMatches<T extends LocalThread>(threads: T[], query: string): T[] {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return threads;
  return threads.filter((thread) => {
    const title = String(thread.title || thread.name || '').toLowerCase();
    const preview = String(thread.preview || '').toLowerCase();
    const project = String(thread.project?.name || '').toLowerCase();
    return title.includes(needle) || preview.includes(needle) || project.includes(needle);
  });
}
