import { useState, useRef, type ReactNode } from 'react';
import { ArrowLeft, Send, Square, ShieldCheck, FileDiff } from 'lucide-react';
import { COLORS, GLASS } from '../theme/optionATokens';
import { haptic } from '../lib/nativeBridge';
import { closeDetail } from '../state/tabStore';
import { openSheet } from '../state/sheetStore';
import { sendMessage } from '../state/dataStore';
import { currentRequestContext } from '../state/sessionStore';
import { readDraft, saveDraft } from '../state/draftStore';

export default function ThumbGlassBar({ threadId }: { threadId: string }) {
  const context = currentRequestContext();
  const scope = context?.scope || '';
  const [text, setText] = useState(() => readDraft(scope, threadId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const submit = async () => {
    const value = text.trim();
    if (!value || submitting.current || !context) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const ok = await sendMessage(context, threadId, value);
      if (ok) { setText(''); saveDraft(scope, threadId, ''); haptic('success'); }
      else { setError('未确认发送成功，草稿已保留。请检查连接后重试。'); haptic('error'); }
    } finally { submitting.current = false; setBusy(false); }
  };
  const iconButton = (label: string, icon: ReactNode, onClick: () => void, background: string = COLORS.blue, disabled = false) => (
    <button type="button" aria-label={label} className="tl-press" onClick={onClick} disabled={disabled} style={{ flex: '0 0 auto', width: 44, height: 44, borderRadius: 14, border: 0, background, color: background === COLORS.fillSecondary ? COLORS.labelPrimary : '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</button>
  );
  return <div className="tl-thumbbar" style={{ background: GLASS.thumb }}>
    {iconButton('返回', <ArrowLeft size={19} />, () => closeDetail(), COLORS.fillSecondary)}
    <input className="tl-thumbbar-input" aria-label="消息" placeholder="发送消息…" value={text} disabled={busy}
      onChange={e => { setText(e.target.value); saveDraft(scope, threadId, e.target.value); setError(''); }}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} enterKeyHint="send" />
    {iconButton('审批', <ShieldCheck size={19} />, () => openSheet('approval', threadId), COLORS.actionGreen)}
    {iconButton('中断', <Square size={17} />, () => openSheet('interruptAll', threadId), COLORS.actionRed)}
    {iconButton('发送', <Send size={18} />, () => void submit(), COLORS.actionBlue, busy || !text.trim())}
    {error && <div role="alert" className="tl-thumbbar-message">{error}</div>}
  </div>;
}
export function ThumbBarDiffAction({ threadId }: { threadId: string }) {
  return <button type="button" className="tl-press" onClick={() => openSheet('diagnostics', threadId)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', border: 0, borderRadius: 14, background: COLORS.surface, color: COLORS.blue, fontSize: 13, fontWeight: 600 }}><FileDiff size={15} /> 查看诊断</button>;
}
