import { ChevronRight, MessageSquare, Loader2, Clock, AlertTriangle, Archive, ArchiveRestore } from 'lucide-react';
import type { ThreadSummary } from '../lib/turnloomApi';
import { COLORS } from '../theme/optionATokens';
import { haptic } from '../lib/nativeBridge';
import { projectThread, type ThreadStatusProjection } from '../lib/threadProjection';
import { openDetail } from '../state/tabStore';
import { StatusPill, EmptyState, cardStyle } from './ui';

export type TaskTone = 'running' | 'waiting' | 'done' | 'error';
type StatusMap = Record<string, ThreadStatusProjection | undefined>;

export function toneOfThread(thread: ThreadSummary, statusByThread: StatusMap = {}): TaskTone {
  return projectThread(thread, statusByThread).tone;
}

export function titleOfThread(thread: ThreadSummary): string {
  return String(thread.title || thread.name || thread.preview || thread.id || '未命名会话');
}

/** Active task stream list used by Home and Threads screens. */
export default function TaskStream({
  threads,
  statusByThread = {},
  limit,
  emptyTitle = '暂无会话',
  emptyDescription = '连接主机或新建任务后，会话会显示在这里。',
  onArchive,
  isArchived,
}: {
  threads: ThreadSummary[];
  statusByThread?: StatusMap;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  /** 传了才渲染归档按钮；不传的页面（首页）保持只读列表。 */
  onArchive?: (threadId: string, archived: boolean) => void;
  isArchived?: (threadId: string) => boolean;
}) {
  const list = typeof limit === 'number' ? threads.slice(0, limit) : threads;
  if (list.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} icon={<MessageSquare size={26} />} />;
  }

  return (
    <div className="tl-card" style={{ ...cardStyle, margin: '0 16px', overflow: 'hidden' }}>
      {list.map((thread, index) => {
        const tone = toneOfThread(thread, statusByThread);
        const icon = tone === 'running'
          ? <Loader2 size={16} color={COLORS.blue} className="tl-spin" />
          : tone === 'error'
            ? <AlertTriangle size={16} color={COLORS.red} />
            : tone === 'waiting'
              ? <Clock size={16} color={COLORS.blue} />
              : <MessageSquare size={16} color={COLORS.labelSecondary} />;
        const pill = tone === 'running'
          ? <StatusPill tone="blue" active>运行中</StatusPill>
          : tone === 'error'
            ? <StatusPill tone="red" active>错误</StatusPill>
            : tone === 'waiting'
              ? <StatusPill tone="blue">待处理</StatusPill>
              : <StatusPill>已结束</StatusPill>;

        const archived = Boolean(isArchived?.(String(thread.id || '')));
        return (
          <div key={thread.id || index}>
            {index > 0 && <div className="tl-separator" style={{ marginLeft: 16 }} />}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              <button
                type="button"
                className="tl-press"
                onClick={() => {
                  haptic('selection');
                  openDetail(thread.id, titleOfThread(thread));
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flex: 1,
                  minWidth: 0,
                  minHeight: 64,
                  padding: '10px 16px',
                  border: 0,
                  background: 'transparent',
                  textAlign: 'left',
                  color: COLORS.labelPrimary,
                }}
              >
                <span style={{ flex: '0 0 auto', display: 'flex' }}>{icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {titleOfThread(thread)}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: COLORS.labelSecondary, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(thread.preview || thread.cwd || thread.id || '')}
                  </span>
                </span>
                <span style={{ flex: '0 0 auto' }}>{pill}</span>
                <ChevronRight size={16} color={COLORS.labelSecondary} />
              </button>
              {onArchive && (
                <button
                  type="button"
                  className="tl-press"
                  aria-label={archived ? `取消归档 ${titleOfThread(thread)}` : `归档 ${titleOfThread(thread)}`}
                  aria-pressed={archived}
                  onClick={() => {
                    haptic('selection');
                    onArchive(String(thread.id || ''), !archived);
                  }}
                  style={{
                    flex: '0 0 auto',
                    width: 52,
                    minHeight: 64,
                    border: 0,
                    background: 'transparent',
                    color: COLORS.labelSecondary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
