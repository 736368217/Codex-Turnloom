/**
 * 会话页顶部运行条（2.2.6）：把「监控」tab 里唯一独占的能力——看见运行中的
 * 任务并停止——搬到任务列表上方。有任务才出现，点开就地展开，不再另开一页。
 */
import { useState } from 'react';
import { ChevronDown, RefreshCw, Square } from 'lucide-react';
import { useDataState, interruptThread, dataStore } from '../state/dataStore';
import { currentRequestContext } from '../state/sessionStore';
import { projectThread } from '../lib/threadProjection';
import { titleOfThread } from '../lib/threadPreview';
import { openDetail } from '../state/tabStore';
import { haptic } from '../lib/nativeBridge';

export default function RunningStrip() {
  const data = useDataState();
  const context = currentRequestContext();
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState('');
  const [error, setError] = useState('');
  const running = data.threads.filter((thread) => projectThread(thread, data.statusByThread).status.thinking);

  if (running.length === 0) return null;

  const stop = async (threadId: string) => {
    if (!context || stopping) return;
    setStopping(threadId);
    setError('');
    haptic('warning');
    const ok = await interruptThread(context, threadId);
    setStopping('');
    if (!ok) setError(`${dataStore.getState().error || '停止请求未成功。'} 可点会话进入详情后重试。`);
  };

  return (
    <div className="tl-runstrip">
      <button
        type="button"
        className="tl-runstrip-head tl-press"
        aria-expanded={expanded}
        onClick={() => { haptic('selection'); setExpanded((value) => !value); }}
      >
        <span className="tl-runstrip-dot" aria-hidden="true" />
        <span className="tl-runstrip-label">{running.length} 运行中</span>
        <span className="tl-runstrip-go">{expanded ? '收起' : '展开'}<ChevronDown size={14} className="tl-runstrip-caret" aria-hidden="true" /></span>
      </button>
      <div className="tl-runlist" data-open={expanded}>
        <div className="tl-runlist-inner">
          {running.map((thread) => (
            <div key={thread.id} className="tl-runrow">
              <button
                type="button"
                className="tl-runrow-open tl-press"
                onClick={() => { haptic('selection'); openDetail(thread.id, titleOfThread(thread)); }}
              >
                <span className="tl-runrow-title">{titleOfThread(thread)}</span>
              </button>
              <button
                type="button"
                className="tl-runrow-stop tl-press"
                aria-label={`停止 ${titleOfThread(thread)}`}
                disabled={Boolean(stopping)}
                onClick={() => { void stop(thread.id); }}
              >
                {stopping === thread.id ? <RefreshCw size={14} className="tl-spin" /> : <Square size={14} fill="currentColor" />}
                {stopping === thread.id ? '停止中' : '停止'}
              </button>
            </div>
          ))}
          {error && <p role="alert" className="tl-runrow-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
