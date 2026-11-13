import { useEffect, useState, type ReactNode } from 'react';
import { Activity, Clock, AlertTriangle, RefreshCw, Radio, Cpu } from 'lucide-react';
import { InsetGroup } from '../components/Segmented';
import { StatusPill, TapRow } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshAll } from '../state/dataStore';
import { useSessionState, currentRequestContext } from '../state/sessionStore';
import { openSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';
import { openDetail } from '../state/tabStore';
import { titleOfThread } from '../components/TaskStream';
import { projectThread } from '../lib/threadProjection';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function MonitorsScreen() {
  const data = useDataState();
  const session = useSessionState();
  const context = currentRequestContext();
  const [elapsed, setElapsed] = useState(0);
  const runningThreads = data.threads.filter(thread => projectThread(thread, data.statusByThread).status.thinking);

  useEffect(() => {
    const base = data.lastSyncAt || Date.now();
    const tick = () => setElapsed(Date.now() - base);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [data.lastSyncAt]);

  return (
    <div className="tl-screen tl-no-scrollbar">
      <div className="tl-safe-top" style={{ padding: '12px 20px 0' }}>
        <div className="tl-large-title">监控</div>
        <div style={{ fontSize: 13, color: COLORS.labelSecondary, marginTop: 4 }}>{session.harnessName} 的运行概览</div>
      </div>
      <InsetGroup title="运行态摘要">
        <div style={{ display: 'flex', padding: '14px 8px' }}>
          <Metric icon={<Radio size={16} />} label="运行中" value={runningThreads.length} tone="blue" />
          <Metric icon={<AlertTriangle size={16} />} label="错误" value={data.errorCount} tone="red" />
          <Metric icon={<Cpu size={16} />} label="会话" value={data.threads.length} tone="green" />
        </div>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', minHeight: 52 }}>
          <Clock size={17} color={COLORS.blue} />
          <span style={{ flex: 1, fontSize: 14, marginLeft: 10 }}>距上次同步</span>
          <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{data.lastSyncAt ? formatElapsed(elapsed) : '尚未同步'}</span>
        </div>
        <div className="tl-separator" style={{ marginLeft: 16 }} />
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', minHeight: 52 }}>
          <Activity size={17} color={COLORS.blue} />
          <span style={{ flex: 1, fontSize: 14, marginLeft: 10 }}>连接状态</span>
          <StatusPill tone={session.online && !data.offline ? 'green' : 'red'} active>{session.online && !data.offline ? '已连接' : '离线'}</StatusPill>
        </div>
      </InsetGroup>
      <InsetGroup title="运行中的会话">
        {runningThreads.map(thread => (
          <TapRow key={thread.id} leading={<Radio size={17} color={COLORS.blue} />} trailing={<span style={{ fontSize: 12, color: COLORS.blue }}>查看 / 停止</span>}
            onClick={() => { haptic('selection'); openDetail(thread.id, titleOfThread(thread)); }}>
            <span className="tl-monitor-title">{titleOfThread(thread)}</span>
          </TapRow>
        ))}
        {runningThreads.length === 0 && <p className="tl-page-note">当前已加载的会话中没有运行任务</p>}
      </InsetGroup>
      <InsetGroup title="错误与告警">
        {data.errorCount > 0 ? (
          <TapRow leading={<AlertTriangle size={17} color={COLORS.red} />} trailing={<StatusPill tone="red" active>{data.errorCount}</StatusPill>} onClick={() => { haptic('warning'); openSheet('diagnostics'); }}>
            <span style={{ fontSize: 14 }}>查看失败任务与诊断信息</span>
          </TapRow>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', minHeight: 52 }}>
            <Activity size={17} color={COLORS.green} /><span style={{ fontSize: 14, color: COLORS.labelSecondary }}>暂无错误</span>
          </div>
        )}
        {data.error && <div style={{ padding: '0 16px 12px', fontSize: 12, color: COLORS.red, wordBreak: 'break-all' }}>{data.error}</div>}
      </InsetGroup>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button type="button" className="tl-press" onClick={() => { if (context) { haptic('selection'); void refreshAll(context); } }} style={{ minHeight: 44, padding: '0 18px', border: 0, borderRadius: 999, background: COLORS.surface, color: COLORS.blue, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={15} /> 刷新运行态
        </button>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'blue' | 'green' | 'red' }) {
  const color = tone === 'blue' ? COLORS.blue : tone === 'red' ? COLORS.red : COLORS.green;
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', color }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 5, color: COLORS.labelPrimary }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.labelSecondary, marginTop: 2 }}>{label}</div>
    </div>
  );
}
