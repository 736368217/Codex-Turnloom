import { listStatusOf } from './chatContract';

export type TaskTone = 'running' | 'waiting' | 'done' | 'error';
export type ThreadStatusProjection = { state: 'ended' | 'running' | 'waiting'; thinking: boolean };
type StatusMap = Record<string, ThreadStatusProjection | undefined>;

interface ThreadWithStatus {
  id: string;
  status?: unknown;
}

/**
 * One projection for list badges, filters, home cards and monitors. The
 * per-thread authoritative status wins over a thread-list row, including when
 * an older list refresh arrives after a stop.
 */
export function projectThread(thread: ThreadWithStatus, statusByThread: StatusMap = {}): {
  status: ThreadStatusProjection;
  tone: TaskTone;
} {
  const authoritative = statusByThread[thread.id];
  const status = authoritative
    ? { state: authoritative.state, thinking: authoritative.thinking }
    : listStatusOf(thread.status);
  const raw = String(typeof thread.status === 'object'
    ? (thread.status as { state?: unknown } | null)?.state || ''
    : thread.status || '').toLowerCase();
  const tone: TaskTone = status.state === 'waiting'
    ? 'waiting'
    : status.thinking
      ? 'running'
      : !authoritative && /error|fail|denied|reject/.test(raw)
        ? 'error'
        : 'done';
  return { status, tone };
}

/**
 * 归档判定：服务端可能把 archived_sessions 目录里的会话当普通会话返回，
 * 所以除了 archived 标记，还要看 rolloutPath 落在哪个目录。
 * 入参用 unknown，避免把没有这些字段的线程类型拒之门外。
 */
export function isArchivedThread(thread: unknown): boolean {
  const row = (thread || {}) as { archived?: unknown; rolloutPath?: unknown };
  if (row.archived === true) return true;
  const path = String(row.rolloutPath || '');
  return /(^|[\\/])archived_sessions[\\/]/i.test(path);
}

/**
 * 会话的最后活动时间（毫秒）。
 *
 * 服务端两种后端返回的字段名不同：Codex 侧是 `updatedAt`，HTTP 后端
 * （backends/http-backend.js）规范化后只给 `updatedAtMs`。只看 `updatedAt`
 * 会让「按时间」排序退化成服务端顺序、列表也没有时间戳。
 */
export function threadUpdatedAtMs(thread: unknown): number {
  const row = (thread || {}) as { updatedAt?: unknown; updatedAtMs?: unknown; createdAt?: unknown; createdAtMs?: unknown };
  for (const value of [row.updatedAt, row.updatedAtMs, row.createdAt, row.createdAtMs]) {
    const numeric = typeof value === 'string' && value.trim() && !/^\d+(\.\d+)?$/.test(value.trim())
      ? Date.parse(value)
      : Number(value);
    if (Number.isFinite(numeric) && (numeric as number) > 0) return numeric as number;
  }
  return 0;
}

/** 列表行右侧的时间标签：今天显示时分，昨天显示「昨天」，更早显示月/日。 */
export function formatThreadWhen(thread: unknown, nowMs = Date.now()): string {
  const at = threadUpdatedAtMs(thread);
  if (!at) return '';
  const date = new Date(at);
  const now = new Date(nowMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 会话是否置顶（Desktop 的 `sessions.pinned`）。
 *
 * 服务端 `threadListMetadata()` 已经归一化成布尔 `pinned`，但 App 也可能连
 * `--backend http` 的宿主，那里给的是原始行（`isPinned` / `is_pinned` / 分组名
 * `pinned`）。三种形状都认，explicit false 不再被后面的字段翻回来。
 */
export function isPinnedThread(thread: unknown): boolean {
  const row = (thread || {}) as { pinned?: unknown; isPinned?: unknown; is_pinned?: unknown; sectionName?: unknown; section_name?: unknown };
  const flag = row.pinned ?? row.isPinned ?? row.is_pinned;
  if (flag === true || flag === 1 || flag === '1' || flag === 'true') return true;
  if (flag === false || flag === 0 || flag === '0' || flag === 'false') return false;
  const section = String(row.sectionName ?? row.section_name ?? '').trim().toLowerCase();
  return section === 'pinned';
}

/**
 * 把置顶会话从普通列表里摘出来：置顶组在最上面，且不在下面的项目组/时间
 * 列表里重复出现（一个置顶会话同时属于某个项目，不摘就会渲染两次）。
 * 两组各自保持入参顺序。
 */
export function partitionPinned<T>(threads: T[]): { pinned: T[]; rest: T[] } {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const thread of threads || []) {
    (isPinnedThread(thread) ? pinned : rest).push(thread);
  }
  return { pinned, rest };
}

/**
 * 会话按项目分组。顺序按首次出现，保持服务端原有的排序；
 * 没有 project 的会话归到「未归类项目」，不要丢弃。
 */
export function groupThreadsByProject<T>(
  threads: T[],
): { key: string; name: string; rows: T[] }[] {
  const groups: { key: string; name: string; rows: T[] }[] = [];
  const slots = new Map<string, number>();
  for (const thread of threads || []) {
    const row = (thread || {}) as { project?: { key?: unknown; name?: unknown } | null };
    const projectKey = String(row.project?.key || '').trim();
    const projectName = String(row.project?.name || '').trim();
    const key = projectKey || `uncategorized:${projectName || 'default'}`;
    const name = projectName || '未归类项目';
    if (!slots.has(key)) {
      slots.set(key, groups.length);
      groups.push({ key, name, rows: [] });
    }
    groups[slots.get(key)!].rows.push(thread);
  }
  return groups;
}
