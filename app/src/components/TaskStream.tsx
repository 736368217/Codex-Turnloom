import { useEffect, useRef } from 'react';
import { Activity, AlertTriangle, Check, Clock, MessageSquare } from 'lucide-react';
import type { ThreadSummary } from '../lib/turnloomApi';
import { haptic } from '../lib/nativeBridge';
import { projectThread, formatThreadWhen, type ThreadStatusProjection } from '../lib/threadProjection';
import { openDetail } from '../state/tabStore';

export type TaskTone = 'running' | 'waiting' | 'done' | 'error';
type StatusMap = Record<string, ThreadStatusProjection | undefined>;

export function toneOfThread(thread: ThreadSummary, statusByThread: StatusMap = {}): TaskTone {
  return projectThread(thread, statusByThread).tone;
}

import { previewOfThread, titleOfThread } from '../lib/threadPreview';
export { previewOfThread, titleOfThread } from '../lib/threadPreview';

/** 长按 550ms 触发（归档这种危险动作只走长按，不占地方也不会误触）。 */
function ThreadRow({
  thread,
  statusByThread,
  archived,
  onLongPress,
}: {
  thread: ThreadSummary;
  statusByThread: StatusMap;
  archived: boolean;
  onLongPress?: (threadId: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const tone = toneOfThread(thread, statusByThread);
  const title = titleOfThread(thread);
  const preview = previewOfThread(thread);
  // The left slot used to be a decorative initial. It carries state now, which is the
  // only thing that earns 40px of every row.
  const stateIcon = tone === 'running'
    ? <Activity size={18} aria-hidden="true" />
    : tone === 'waiting'
      ? <Clock size={18} aria-hidden="true" />
      : tone === 'error'
        ? <AlertTriangle size={18} aria-hidden="true" />
        : <Check size={18} aria-hidden="true" />;
  const stateLabel = tone === 'running' ? '运行中' : tone === 'waiting' ? '等待审批' : tone === 'error' ? '出错' : archived ? '已归档' : '空闲';
  const status = archived && tone === 'done'
    ? <span className="tl-thread-status" style={{ background: 'rgba(142,142,147,.14)', color: '#636366' }}>已归档</span>
    : null;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  return (
    <button
      type="button"
      className="tl-press tl-thread-row"
      onClick={() => {
        if (fired.current) { fired.current = false; return; }
        haptic('selection');
        openDetail(thread.id, title);
      }}
      onPointerDown={() => {
        if (!onLongPress) return;
        fired.current = false;
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          haptic('warning');
          onLongPress(String(thread.id || ''));
        }, 550);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(event) => {
        if (!onLongPress) return;
        event.preventDefault();
        haptic('warning');
        onLongPress(String(thread.id || ''));
      }}
    >
      <span className="tl-thread-state" data-tone={tone} title={stateLabel} aria-label={stateLabel} role="img">
        {stateIcon}
      </span>
      <span className="tl-thread-main">
        <span className="tl-thread-top">
          <span className="tl-thread-title">{title}</span>
          <span className="tl-thread-time">{formatThreadWhen(thread)}</span>
        </span>
        {preview && <span className="tl-thread-preview">{preview}</span>}
      </span>
      <span className="tl-thread-tail">{status}</span>
    </button>
  );
}

/** Full-bleed conversation list (2.2.2 IA); CSS lives in globals.css §2.2.2. */
export default function TaskStream({
  threads,
  statusByThread = {},
  limit,
  emptyTitle = '暂无会话',
  emptyDescription = '连接电脑或点右上角 + 开始一个新会话。',
  onLongPress,
  isArchived,
}: {
  threads: ThreadSummary[];
  statusByThread?: StatusMap;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  onLongPress?: (threadId: string) => void;
  isArchived?: (thread: { id?: string; archived?: unknown }) => boolean;
}) {
  const list = typeof limit === 'number' ? threads.slice(0, limit) : threads;
  if (list.length === 0) {
    return (
      <div className="tl-thread-empty">
        <MessageSquare size={26} color="var(--tl-label-secondary)" aria-hidden="true" />
        <div className="tl-empty-title">{emptyTitle}</div>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="tl-thread-list">
      {list.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          statusByThread={statusByThread}
          archived={Boolean(isArchived?.(thread))}
          onLongPress={onLongPress}
        />
      ))}
    </div>
  );
}
