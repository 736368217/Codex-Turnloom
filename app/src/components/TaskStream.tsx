import { ChevronRight, MessageSquare, Loader2, CircleCheck, AlertTriangle } from 'lucide-react';
import type { ThreadSummary } from '../lib/turnloomApi';
import { COLORS } from '../theme/optionATokens';
import { haptic } from '../lib/nativeBridge';
import { openDetail } from '../state/tabStore';
import { StatusPill, EmptyState, cardStyle } from './ui';

export type TaskTone = 'running' | 'waiting' | 'done' | 'error';

export function toneOfThread(thread: ThreadSummary): TaskTone {
  const raw = thread.status;
  const text = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? String(raw.state || raw.label || '') : '');
  const s = text.toLowerCase();
  if (/error|fail|denied|reject/.test(s)) return 'error';
  if (/wait|approval|pending|pause|queue/.test(s)) return 'waiting';
  if (/run|active|working|exec|stream|thinking|progress/.test(s)) return 'running';
  return 'done';
}

export function titleOfThread(thread: ThreadSummary): string {
  return String(thread.title || thread.name || thread.preview || thread.id || '未命名会话');
}

/** Active task stream list used by Home and Threads screens. */
export default function TaskStream({
  threads,
  limit,
  emptyTitle = '暂无会话',
  emptyDescription = '连接主机或新建任务后，会话会显示在这里。',
}: {
  threads: ThreadSummary[];
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const list = typeof limit === 'number' ? threads.slice(0, limit) : threads;
  if (list.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} icon={<MessageSquare size={26} />} />;
  }

  return (
    <div className="tl-card" style={{ ...cardStyle, margin: '0 16px', overflow: 'hidden' }}>
      {list.map((thread, index) => {
        const tone = toneOfThread(thread);
        const icon = tone === 'running'
          ? <Loader2 size={16} color={COLORS.blue} className="tl-spin" />
          : tone === 'error'
            ? <AlertTriangle size={16} color={COLORS.red} />
            : tone === 'waiting'
              ? <CircleCheck size={16} color={COLORS.green} />
              : <MessageSquare size={16} color={COLORS.labelSecondary} />;
        const pill = tone === 'running'
          ? <StatusPill tone="blue" active>运行中</StatusPill>
          : tone === 'error'
            ? <StatusPill tone="red" active>错误</StatusPill>
            : tone === 'waiting'
              ? <StatusPill tone="green">待审批</StatusPill>
              : <StatusPill>已完成</StatusPill>;

        return (
          <div key={thread.id || index}>
            {index > 0 && <div className="tl-separator" style={{ marginLeft: 16 }} />}
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
                width: '100%',
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
          </div>
        );
      })}
    </div>
  );
}
