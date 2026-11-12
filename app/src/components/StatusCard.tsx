/** Home status card: verified machine, selected service and real counters. */
import type { ReactNode } from 'react';
import { Server, Wifi, WifiOff, Cpu, Clock, RefreshCw } from 'lucide-react';
import { useSessionState, currentRequestContext } from '../state/sessionStore';
import { useDataState, refreshAll } from '../state/dataStore';
import { haptic } from '../lib/nativeBridge';
import { COLORS } from '../theme/optionATokens';
import { StatusPill, TapRow, cardStyle } from './ui';

export default function StatusCard() {
  const session = useSessionState();
  const data = useDataState();
  const context = currentRequestContext();
  const online = session.status === 'ready' && session.online && !data.offline;

  return (
    <div className="tl-card" style={{ ...cardStyle, margin: '0 16px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 12px' }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: online ? '#E1F7E8' : COLORS.fillSecondary, color: online ? COLORS.green : COLORS.labelSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Server size={20} strokeWidth={1.9} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.labelPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.machineName || '已连接的电脑'}
          </div>
          <div style={{ fontSize: 12, color: COLORS.labelSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.harnessName || session.serverUrl}
          </div>
        </div>
        {online
          ? <StatusPill tone="green"><Wifi size={12} /> 在线</StatusPill>
          : <StatusPill tone="red"><WifiOff size={12} /> 离线</StatusPill>}
      </div>
      <div className="tl-separator" style={{ margin: '0 16px' }} />
      <div style={{ display: 'flex', padding: '8px 4px' }}>
        <Metric icon={<Cpu size={15} />} label="当前服务" value={session.harnessName || '—'} />
        <Metric icon={<ActivityPulse />} label="运行中" value={String(data.runningCount)} />
        <Metric icon={<Clock size={15} />} label="会话数" value={String(data.threads.length)} />
      </div>
      <div className="tl-separator" style={{ margin: '0 16px' }} />
      <TapRow
        leading={<RefreshCw size={17} color={COLORS.blue} />}
        trailing={<span style={{ fontSize: 12, color: COLORS.labelSecondary }}>{data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '未同步'}</span>}
        onClick={() => { if (context) { haptic('selection'); void refreshAll(context); } }}
      >
        <span style={{ fontSize: 14, color: COLORS.blue, fontWeight: 500 }}>刷新状态</span>
      </TapRow>
    </div>
  );
}

function ActivityPulse() { return <span style={{ fontSize: 13, fontWeight: 700 }}>◉</span>; }

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '6px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, color: COLORS.labelSecondary }}>
        {icon}<span style={{ fontSize: 11 }}>{label}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.labelPrimary, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}
