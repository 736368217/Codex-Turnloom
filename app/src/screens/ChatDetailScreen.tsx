import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Brain, Terminal, FileDiff, Square, ShieldCheck } from 'lucide-react';
import ThumbGlassBar, { ThumbBarDiffAction } from '../components/ThumbGlassBar';
import DiffCard, { parseDiff, type DiffLine } from '../components/DiffCard';
import { SectionTitle, StatusPill } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshMessages, refreshChanges } from '../state/dataStore';
import { useTabState } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { openSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';
import type { ThreadMessage } from '../lib/turnloomApi';

function CollapsibleLog({ title, icon, lines, defaultOpen = false }: { title: string; icon: ReactNode; lines: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', margin: '0 16px 12px', overflow: 'hidden' }}>
      <button type="button" className="tl-press" onClick={() => setOpen((value) => !value)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 52, padding: '8px 14px', border: 0, background: 'transparent', color: COLORS.labelPrimary, textAlign: 'left' }}>
        {icon}<span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: COLORS.labelSecondary }}>{lines.length} 行</span>
        {open ? <ChevronDown size={16} color={COLORS.labelSecondary} /> : <ChevronRight size={16} color={COLORS.labelSecondary} />}
      </button>
      {open && (
        <pre className="tl-selectable" style={{ margin: 0, padding: 14, borderTop: `.5px solid ${COLORS.separator}`, background: COLORS.fillSecondary, color: COLORS.labelPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: 19, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {lines.length ? lines.join('\n') : '暂无记录'}
        </pre>
      )}
    </div>
  );
}

function messageText(message: ThreadMessage): string { return String(message.text ?? message.content ?? ''); }

export default function ChatDetailScreen({ threadId, title }: { threadId: string; title: string }) {
  const data = useDataState();
  const { detailTitle } = useTabState();
  const context = currentRequestContext();
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [thinking, setThinking] = useState<string[]>([]);
  const [terminal, setTerminal] = useState<string[]>([]);
  const messages = data.messagesByThread[threadId] || [];
  const changes = data.changesByThread[threadId] || [];
  const heading = title || detailTitle || '会话详情';

  useEffect(() => {
    if (!context) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (document.visibilityState === 'visible') {
        await Promise.all([refreshMessages(context, threadId), refreshChanges(context, threadId)]);
      }
      if (!stopped) timer = setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [threadId, context?.scope, context?.generation]);

  useEffect(() => {
    setThinking(messages.filter(message => message.kind === 'thinking' || message.kind === 'reasoning').map(messageText).filter(Boolean));
    setTerminal(messages.filter(message => message.kind === 'command' || message.kind === 'terminal').map(messageText).filter(Boolean));
  }, [messages]);

  useEffect(() => {
    if (!changes.length) { setDiffLines([]); return; }
    const lines: DiffLine[] = [];
    for (const entry of changes) {
      lines.push({ type: 'meta', text: String(entry.path || entry.type || '变更') });
      if (typeof entry.additions === 'number') lines.push({ type: 'add', text: `+ ${entry.additions} 行新增` });
      if (typeof entry.deletions === 'number') lines.push({ type: 'del', text: `- ${entry.deletions} 行删除` });
    }
    setDiffLines(lines.length ? lines : parseDiff(''));
  }, [changes]);

  return (
    <div className="tl-screen tl-screen--detail tl-no-scrollbar">
      <div className="tl-safe-top" style={{ padding: '12px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: COLORS.labelSecondary }}>会话详情</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -.4, color: COLORS.labelPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{heading}</div>
          </div>
          <StatusPill tone="blue">{data.messageState[threadId]?.loading ? '同步中' : '会话'}</StatusPill>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" className="tl-press" onClick={() => { haptic('warning'); openSheet('interruptAll', threadId); }} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', border: 0, borderRadius: 14, background: COLORS.surface, color: COLORS.red, fontSize: 13, fontWeight: 600 }}>
            <Square size={15} /> 中断
          </button>
          <button type="button" className="tl-press" onClick={() => { haptic('selection'); openSheet('approval', threadId); }} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', border: 0, borderRadius: 14, background: COLORS.surface, color: COLORS.green, fontSize: 13, fontWeight: 600 }}>
            <ShieldCheck size={15} /> 审批
          </button>
          <ThumbBarDiffAction threadId={threadId} />
        </div>
      </div>
      <SectionTitle>消息流</SectionTitle>
      <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', margin: '0 16px 12px', padding: 12 }}>
        {messages.length === 0 ? (
          <div role="status" style={{ fontSize: 13, color: COLORS.labelSecondary, padding: '8px 4px' }}>{data.messageState[threadId]?.error || (data.messageState[threadId]?.loaded ? '暂无消息，可以发送第一条消息。' : '正在加载消息…')}
            {data.messageState[threadId]?.error && <button type="button" className="tl-connect-manual" onClick={() => { if (context) void refreshMessages(context, threadId); }}>重试加载消息</button>}
          </div>
        ) : messages.map((message, index) => {
          const isUser = message.role === 'user';
          return (
            <div key={String(message.id || index)} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div className="tl-selectable" style={{ maxWidth: '86%', padding: '10px 13px', borderRadius: 16, background: isUser ? COLORS.blue : COLORS.fillSecondary, color: isUser ? '#FFFFFF' : COLORS.labelPrimary, fontSize: 14, lineHeight: 20, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {messageText(message) || '(空消息)'}
              </div>
            </div>
          );
        })}
      </div>
      <SectionTitle>推理与日志</SectionTitle>
      <CollapsibleLog title="推理过程" icon={<Brain size={17} color={COLORS.blue} />} lines={thinking.length ? thinking : ['暂无推理记录']} />
      <CollapsibleLog title="命令记录" icon={<Terminal size={17} color={COLORS.labelSecondary} />} lines={terminal.length ? terminal : ['暂无命令记录']} />
      <SectionTitle>变更 Diff</SectionTitle>
      <DiffCard path={`${heading} · ${changes.length} 个文件`} lines={diffLines} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: COLORS.labelSecondary, fontSize: 12, padding: '0 0 12px' }}>
        <FileDiff size={14} /> 变更概览
      </div>
      <ThumbGlassBar threadId={threadId} />
    </div>
  );
}
