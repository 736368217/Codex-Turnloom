import { useState } from 'react';
import { Check, X, Terminal, ShieldCheck } from 'lucide-react';
import { COLORS } from '../theme/optionATokens';
import { ActionButton } from './ui';
import { useSheetState, closeSheet } from '../state/sheetStore';
import { resolveApproval } from '../state/dataStore';
import { currentRequestContext } from '../state/sessionStore';
import { haptic } from '../lib/nativeBridge';

/** Approval drawer. Calls POST /api/approval on the current verified harness. */
export default function ApprovalSheet() {
  const { approval, contextThreadId } = useSheetState();
  const context = currentRequestContext();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const title = approval?.title || '待审批操作';
  const command = approval?.command || '等待电脑端提供命令详情';
  const reason = approval?.reason || '此操作会修改工作区文件，请确认后继续。';

  const decide = async (decision: 'approve' | 'reject') => {
    if (busy || !context) return;
    setBusy(true);
    haptic(decision === 'approve' ? 'success' : 'warning');
    const ok = await resolveApproval(context, approval?.threadId || contextThreadId, approval?.id || contextThreadId, decision);
    setBusy(false);
    if (!ok) { setNotice('提交失败，请检查连接后重试'); haptic('error'); return; }
    closeSheet();
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 14, background: COLORS.fillSecondary, marginBottom: 14 }}>
        <ShieldCheck size={17} color={COLORS.blue} />
        <span style={{ fontSize: 13, color: COLORS.labelSecondary, flex: 1 }}>{reason}</span>
      </div>
      <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.labelPrimary, marginBottom: 8 }}>{title}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Terminal size={15} color={COLORS.labelSecondary} style={{ flex: '0 0 auto', marginTop: 2 }} />
          <pre className="tl-selectable" style={{ margin: 0, flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: 19, color: COLORS.labelPrimary }}>{command}</pre>
        </div>
      </div>
      {notice && <div style={{ fontSize: 13, color: COLORS.red, marginBottom: 12 }}>{notice}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ActionButton variant="green" icon={<Check size={18} />} onClick={() => { void decide('approve'); }} disabled={busy || !context}>批准并应用</ActionButton>
        <ActionButton variant="neutral" icon={<X size={18} />} onClick={() => { void decide('reject'); }} disabled={busy || !context} style={{ color: COLORS.labelSecondary }}>拒绝</ActionButton>
      </div>
    </div>
  );
}
