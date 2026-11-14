import type { ThreadMessage } from './turnloomApi';

/** Host IDs may be null. Match its cursor identity rather than render indexes. */
export function messagePageKey(row: ThreadMessage): string {
  if (row.id) return `id:${row.id}`;
  return [row.requestId, row.turnId, row.lineNumber, row.role, row.timestamp, String(row.content || '').slice(0, 120)]
    .filter(value => value !== undefined && value !== null && value !== '').join(':');
}

/** Keep chronological page order, deduplicate overlaps, update live row bodies. */
export function mergeMessagePages(earlier: ThreadMessage[], later: ThreadMessage[]): ThreadMessage[] {
  const rows = new Map<string, ThreadMessage>();
  for (const row of [...earlier, ...later]) rows.set(messagePageKey(row), row);
  return Array.from(rows.values());
}
