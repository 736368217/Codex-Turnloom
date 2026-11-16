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
