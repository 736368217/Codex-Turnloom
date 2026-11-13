import { Cpu, Wifi, WifiOff, ChevronDown } from 'lucide-react';
import { COLORS, APP_IDENTITY } from '../theme/optionATokens';
import { useSessionState } from '../state/sessionStore';
import { useOfflineState } from '../state/offlineStore';
import { openSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';

/** Header: identity, connection state and a clear discovered-service switcher. */
export default function MachineHubHeader() {
  const session = useSessionState();
  const offline = useOfflineState();
  const showOffline = offline.offlineBadgeVisible || !session.online;
  const discovered = session.harnesses;
  const selectedName = session.harnessName || '选择服务';

  return (
    <div className="tl-safe-top" style={{ padding: '12px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, color: COLORS.labelSecondary, letterSpacing: .4 }}>{APP_IDENTITY.label}</div>
          <div className="tl-large-title" style={{ marginTop: 2 }}>工作台</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 28, padding: '0 10px', borderRadius: 999, background: showOffline ? '#FFE4E2' : '#E1F7E8', color: showOffline ? COLORS.actionRed : COLORS.actionGreen, fontSize: 11, fontWeight: 700 }}>
          {showOffline ? <WifiOff size={12} /> : <Wifi size={12} />}{showOffline ? '离线' : '在线'}
        </span>
      </div>

      <button
        type="button"
        className="tl-press"
        disabled={discovered.length === 0 || session.status === 'reconnecting'}
        onClick={() => { haptic('selection'); openSheet('harness'); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          minHeight: 46, marginTop: 10, padding: '0 12px', border: 0,
          borderRadius: 13, background: COLORS.surface, color: COLORS.labelPrimary,
          textAlign: 'left', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
        }}
      >
        <Cpu size={17} color={COLORS.blue} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedName}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: COLORS.labelSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.machineName}{discovered.length > 1 ? ` · ${discovered.length} 个服务` : ''}
          </span>
        </span>
        {discovered.length > 1 && <ChevronDown size={16} color={COLORS.labelSecondary} />}
      </button>
    </div>
  );
}
