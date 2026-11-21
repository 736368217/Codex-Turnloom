/**
 * 会话页顶部运行条（2.2.6 / 2.4.0）。
 *
 * 2.4.0 的计数口径由服务端 `/api/threads.active` 决定（与分页无关）：
 * `running` = 正在跑，`waiting` = 等你授权/回答。两组的数字和展开行必须同源；
 * `truncated` 时数字是下界，写成「4+」并在展开区末行说「另有会话未统计」。
 * 老服务没有 `active` 时退回已加载页的投影，并保持两类分组（诚实但可能不全）。
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Square } from 'lucide-react';
import { useDataState, interruptThread, dataStore } from '../state/dataStore';
import { currentRequestContext } from '../state/sessionStore';
import { projectThread } from '../lib/threadProjection';
import { titleOfThread } from '../lib/threadPreview';
import { openDetail } from '../state/tabStore';
import { haptic } from '../lib/nativeBridge';

type Group = 'running' | 'waiting';
type Row = { id: string; title: string };

export default function RunningStrip() {
  const data = useDataState();
  const context = currentRequestContext();
  const [openGroup, setOpenGroup] = useState<Group | ''>('');
  const [stopping, setStopping] = useState('');
  const [error, setError] = useState('');

  const active = data.active;
  const projected = data.threads.map((thread) => ({ thread, tone: projectThread(thread, data.statusByThread).tone }));
  // Old hosts have no `active`: derive waiting from the row's own
  // interactionRequired (thinking stays true while a turn waits for approval).
  const fallbackWaitingIds = new Set(data.threads.filter((thread) => {
    const raw = typeof thread.status === 'object' && thread.status ? thread.status as Record<string, unknown> : null;
    return raw?.interactionRequired === true;
  }).map((thread) => thread.id));
  const waiting: Row[] = active
    ? active.waiting.map((row) => ({ id: row.id, title: row.title }))
    : projected.filter((row) => fallbackWaitingIds.has(row.thread.id)).map(({ thread }) => ({ id: thread.id, title: titleOfThread(thread) }));
  // A session waiting for approval also has an open turn (`thinking: true` on
  // the wire). Contract A makes the server's arrays disjoint; this filter keeps
  // old or hand-built payloads from double-counting the same session.
  const waitingIds = new Set(waiting.map((row) => row.id));
  const running: Row[] = active
    ? active.running.filter((row) => !waitingIds.has(row.id)).map((row) => ({ id: row.id, title: row.title }))
    : projected.filter((row) => row.tone === 'running' && !waitingIds.has(row.thread.id)).map(({ thread }) => ({ id: thread.id, title: titleOfThread(thread) }));
  const truncated = Boolean(active?.truncated);

  if (running.length === 0 && waiting.length === 0) return null;

  const toggle = (group: Group) => {
    haptic('selection');
    setOpenGroup((current) => (current === group ? '' : group));
  };

  const stop = async (threadId: string) => {
    if (!context || stopping) return;
    setStopping(threadId);
    setError('');
    haptic('warning');
    const ok = await interruptThread(context, threadId);
    setStopping('');
    if (!ok) setError(`${dataStore.getState().error || '停止请求未成功。'} 可点会话进入详情后重试。`);
  };

  const pill = (group: Group, count: number) => {
    if (count === 0) return null;
    const label = group === 'running' ? '运行中' : '待你处理';
    const spoken = `${truncated ? '至少 ' : ''}${count} 个${label}${truncated ? '，另有会话未统计' : ''}`;
    return (
      <button
        type="button"
        className="tl-runstrip-pill tl-press"
        data-kind={group}
        aria-expanded={openGroup === group}
        aria-label={spoken}
        onClick={() => toggle(group)}
      >
        {group === 'running' ? <span className="tl-runstrip-dot" aria-hidden="true" /> : <span className="tl-runstrip-clock" aria-hidden="true" />}
        <span className="tl-runstrip-label">{count}{truncated ? '+' : ''} {label}</span>
        <ChevronDown size={14} className="tl-runstrip-caret" aria-hidden="true" />
      </button>
    );
  };

  const rows = (group: Group, list: Row[]) => (
    <div className="tl-runlist" data-open={openGroup === group}>
      <div className="tl-runlist-inner">
        {list.map((row) => (
          <div key={row.id} className="tl-runrow">
            <button
              type="button"
              className="tl-runrow-open tl-press"
              onClick={() => { haptic('selection'); openDetail(row.id, row.title); }}
            >
              <span className="tl-runrow-title">{row.title}</span>
            </button>
            {group === 'running' ? (
              <button
                type="button"
                className="tl-runrow-stop tl-press"
                aria-label={`停止 ${row.title}`}
                disabled={Boolean(stopping)}
                onClick={() => { void stop(row.id); }}
              >
                {stopping === row.id ? <RefreshCw size={14} className="tl-spin" /> : <Square size={14} fill="currentColor" />}
                {stopping === row.id ? '停止中' : '停止'}
              </button>
            ) : (
              <button
                type="button"
                className="tl-runrow-go tl-press"
                aria-label={`去处理 ${row.title}`}
                onClick={() => { haptic('selection'); openDetail(row.id, row.title); }}
              >
                去处理
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {truncated && <p className="tl-runrow-note">另有会话未统计</p>}
        {error && group === 'running' && <p role="alert" className="tl-runrow-error">{error}</p>}
      </div>
    </div>
  );

  return (
    <div className="tl-runstrip">
      <div className="tl-runstrip-head">
        {pill('running', running.length)}
        {pill('waiting', waiting.length)}
      </div>
      {rows('running', running)}
      {rows('waiting', waiting)}
    </div>
  );
}
