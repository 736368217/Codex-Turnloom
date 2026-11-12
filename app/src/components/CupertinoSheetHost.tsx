import { Square, Activity, RefreshCw, Cpu, CircleCheck } from 'lucide-react';
import VaulSheet from './VaulSheet';
import NewTaskSheet from './NewTaskSheet';
import ApprovalSheet from './ApprovalSheet';
import { ActionButton, TapRow } from './ui';
import { COLORS } from '../theme/optionATokens';
import { useSheetState, closeSheet, type SheetKey } from '../state/sheetStore';
import { useSessionState, switchHarness, currentRequestContext, unpair } from '../state/sessionStore';
import { useDataState, clearOfflineCache, refreshAll, interruptThread } from '../state/dataStore';
import { haptic } from '../lib/nativeBridge';

const TITLES: Record<Exclude<SheetKey, null>, string> = {
  newTask: '新建任务', harness: '切换电脑上的服务', approval: '审批变更',
  diagnostics: '运行信息', interruptAll: '中断任务', disconnect: '忘记这台电脑',
};
const SUBTITLES: Record<Exclude<SheetKey, null>, string> = {
  newTask: '在当前电脑的服务中创建任务',
  harness: '选择桌面端发现的服务，切换后会重新读取各自会话',
  approval: '确认后电脑端才会应用此变更',
  diagnostics: '当前连接与会话信息',
  interruptAll: '停止当前正在执行的任务', disconnect: '移除配对及这台电脑的本机会话缓存。电脑上的会话不会被删除。',
};

/** Global singleton bottom drawer. No arbitrary engine settings / pairing sheet. */
export default function CupertinoSheetHost() {
  const { sheet, contextThreadId } = useSheetState();
  const session = useSessionState();
  const data = useDataState();
  const context = currentRequestContext();
  const open = sheet !== null;

  const content = () => {
    switch (sheet) {
      case 'disconnect': return <div style={{ display: 'grid', gap: 10 }}><ActionButton variant="red" onClick={() => { clearOfflineCache(context); unpair(); closeSheet(); }}>确认忘记这台电脑</ActionButton><ActionButton variant="neutral" onClick={closeSheet}>保留连接</ActionButton></div>;
      case 'newTask': return <NewTaskSheet />;
      case 'approval': return <ApprovalSheet />;
      case 'harness':
        return (
          <div>
            <div style={{ fontSize: 13, color: COLORS.labelSecondary, marginBottom: 10 }}>
              {session.machineName} · 发现 {session.harnesses.length} 个服务
            </div>
            {session.harnesses.map((harness) => {
              const active = harness.id === session.harnessId;
              return (
                <TapRow
                  key={harness.id}
                  leading={<Cpu size={17} color={active ? COLORS.blue : COLORS.labelSecondary} />}
                  trailing={active ? <span style={{ color: COLORS.blue, fontSize: 13 }}>当前</span> : undefined}
                  disabled={session.status === 'reconnecting'}
                  onClick={() => { haptic('selection'); void switchHarness(harness.id); closeSheet(); }}
                >
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{harness.name}</span>
                </TapRow>
              );
            })}
            {session.status === 'reconnecting' && <div style={{ fontSize: 12, color: COLORS.labelSecondary, marginTop: 8 }}>正在验证所选服务…</div>}
          </div>
        );
      case 'diagnostics': {
        const rows: [string, string][] = [
          ['应用版本', session.appVersion],
          ['电脑', session.machineName],
          ['当前服务', session.harnessName],
          ['服务地址', session.serverUrl],
          ['连接状态', session.online ? '在线' : '离线'],
          ['会话数量', String(data.threads.length)],
          ['最近同步', data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('zh-CN') : '尚未同步'],
          ['外观', '浅色'],
        ];
        return (
          <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', overflow: 'hidden' }}>
            {rows.map(([label, value], index) => (
              <div key={label}>
                {index > 0 && <div className="tl-separator" style={{ marginLeft: 16 }} />}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 16px', minHeight: 44 }}>
                  <span style={{ width: 88, flex: '0 0 auto', fontSize: 12, color: COLORS.labelSecondary }}>{label}</span>
                  <span className="tl-selectable" style={{ flex: 1, fontSize: 12, color: COLORS.labelPrimary, wordBreak: 'break-all' }}>{value}</span>
                </div>
              </div>
            ))}
          </div>
        );
      }
      case 'interruptAll':
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 14, background: '#FFE4E2', marginBottom: 16 }}>
              <Activity size={17} color={COLORS.red} />
              <span style={{ fontSize: 13, color: COLORS.labelPrimary, flex: 1 }}>将向当前会话发送中断请求，此操作不可撤销。</span>
            </div>
            <ActionButton variant="red" icon={<Square size={16} />} disabled={!context || !contextThreadId} onClick={() => {
              haptic('warning');
              if (context && contextThreadId) void interruptThread(context, contextThreadId);
              closeSheet();
            }}>中断当前任务</ActionButton>
          </div>
        );
      default: return null;
    }
  };

  return (
    <VaulSheet open={open} onOpenChange={(next) => { if (!next) closeSheet(); }} title={sheet ? TITLES[sheet] : undefined} subtitle={sheet ? SUBTITLES[sheet] : undefined}>
      {sheet === 'diagnostics' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <ActionButton variant="neutral" icon={<RefreshCw size={16} />} onClick={() => { if (context) { haptic('selection'); void refreshAll(context); } }}>重新同步</ActionButton>
          <ActionButton variant="neutral" icon={<CircleCheck size={16} />} onClick={() => { haptic('warning'); clearOfflineCache(context); }}>清缓存</ActionButton>
        </div>
      )}
      {content()}
    </VaulSheet>
  );
}
