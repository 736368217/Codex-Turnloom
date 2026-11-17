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
  const tone: TaskTone = status.thinking
    ? 'running'
    : status.state === 'waiting'
      ? 'waiting'
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
