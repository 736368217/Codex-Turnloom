import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Brain, Terminal, FileDiff, Loader2, Check, X } from 'lucide-react';
import { ComposerFields, ChatPrimaryButton, useComposerFields, requestIdForIdentity } from '../components/ChatComposer';
import MarkdownMessage from '../components/MarkdownMessage';
import { COLORS } from '../theme/optionATokens';
import { messageText, compactMessageText, isRunning, supportsImages,
  buildSendPayload, sendRequestIdentity, type ThreadRuntimeStatus,
} from '../lib/chatContract';
import { composerSubmitDecision } from '../lib/composerSubmit';
import { haptic } from '../lib/nativeBridge';
import {
  useDataState, dataStore, refreshMessages, loadOlderMessages, refreshChanges, sendMessage, interruptThread, resolveApproval,
} from '../state/dataStore';
import { closeDetail } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { clearComposerInputs } from '../state/composerStore';
import { getThreadStatus } from '../state/runtimeStore';
import type { ThreadMessage } from '../lib/turnloomApi';

/** Secondary cards are rendered only when the host actually sent real rows. */
function CollapsibleLog({ title, icon, lines }: { title: string; icon: ReactNode; lines: string[] }) {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', margin: '0 12px 8px', overflow: 'hidden' }}>
      <button type="button" aria-expanded={open} className="tl-press" onClick={() => setOpen((value) => !value)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '8px 12px', border: 0, background: 'transparent', color: COLORS.labelPrimary, textAlign: 'left' }}>
        {icon}<span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: COLORS.labelSecondary }}>{lines.length} 行</span>
        {open ? <ChevronDown size={15} color={COLORS.labelSecondary} /> : <ChevronRight size={15} color={COLORS.labelSecondary} />}
      </button>
      {open && (
        <pre className="tl-selectable" style={{ margin: 0, padding: 12, borderTop: `.5px solid ${COLORS.separator}`, background: COLORS.fillSecondary, color: COLORS.labelPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: '19px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

type ApprovalDecision = 'approve' | 'approveForSession' | 'decline';

function approvalDecisionFromOption(option: unknown): ApprovalDecision | null {
  const row = option && typeof option === 'object' ? option as Record<string, unknown> : null;
  const value = String(row?.id || row?.value || row?.action || option || '').trim().toLowerCase().replace(/[-_\s]/g, '');
  if (['accept', 'approve', 'yes', 'true', '批准', '允许'].includes(value)) return 'approve';
  if (['acceptforsession', 'approveforsession', 'always', 'session', '本次会话'].includes(value)) return 'approveForSession';
  if (['decline', 'deny', 'no', 'false', '拒绝'].includes(value)) return 'decline';
  return null;
}

function approvalDecisionLabel(decision: ApprovalDecision): string {
  return decision === 'approveForSession' ? '允许本次会话' : decision === 'approve' ? '批准' : '拒绝';
}

function ApprovalCard({ message, context, threadId }: { message: ThreadMessage; context: ReturnType<typeof currentRequestContext>; threadId: string }) {
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState('');
  const requestId = String(message.requestId || '');
  const approvalKind = String(message.approvalKind || '') as 'command' | 'file' | 'permission';
  const detailsHash = String(message.detailsHash || '');
  const advertised = Array.isArray(message.availableDecisions) ? message.availableDecisions : [];
  const decisions = Array.from(new Set((advertised.length ? advertised : ['decline', 'approve']).map(approvalDecisionFromOption).filter((item): item is ApprovalDecision => Boolean(item))));
  const canApprove = Boolean(message.canApprove && message.threadId === threadId && context && requestId && detailsHash && ['command', 'file', 'permission'].includes(approvalKind) && decisions.length);
  const decide = async (decision: ApprovalDecision) => {
    if (!canApprove || !context || busy) return;
    setBusy(true); setError('');
    const ok = await resolveApproval(context, threadId, requestId, approvalKind, detailsHash, decision);
    setBusy(false);
    if (ok) { setResolved(true); await refreshMessages(context, threadId); }
    else setError(dataStore.getState().error || '审批未成功，请刷新后重新核对。');
  };
  return <div className="tl-approval-card" aria-label="待确认操作">
    <div className="tl-approval-title"><span>{String(message.title || '需要确认的操作')}</span><span className="tl-approval-kind">{approvalKind || '操作'}</span></div>
    <code className="tl-approval-id">请求 ID · {requestId || '不可用'}</code>
    <pre className="tl-approval-content tl-selectable">{String(message.content || message.text || '')}</pre>
    {resolved ? <div className="tl-approval-resolved"><Check size={15} /> 已提交决定</div> : <>
      {error && <div role="alert" className="tl-approval-error">{error}</div>}
      {!canApprove && <div className="tl-approval-error">{message.unavailable ? '请求已过期、变化或已处理，已禁用决定。' : decisions.length ? '缺少可核对的请求详情，已禁用决定。' : '电脑端未提供可用决定，操作已禁用。'}</div>}
      <div className="tl-approval-actions">
        {decisions.map(decision => <button key={decision} type="button" className={decision === 'decline' ? 'tl-approval-reject' : 'tl-approval-approve'} disabled={!canApprove || busy} onClick={() => { void decide(decision); }}>
          {decision === 'decline' ? <X size={15} /> : <Check size={15} />} {approvalDecisionLabel(decision)}
        </button>)}
      </div>
    </>}
  </div>;
}

/** Chat screen: header-only back, compact bubbles, one authoritative primary action. */
export default function ChatDetailScreen({ threadId, title }: { threadId: string; title: string }) {
  const data = useDataState();
  const context = currentRequestContext();
  const scope = context?.scope || '';
  const messages = data.messagesByThread[threadId] || [];
  const changes = data.changesByThread[threadId] || [];
  const threadModel = data.threads.find((row) => row.id === threadId)?.model;
  const status: ThreadRuntimeStatus | null = getThreadStatus(scope, threadId);
  const running = isRunning(status);
  const fields = useComposerFields(scope, threadId, threadModel);
  const [submitting, setSubmitting] = useState(false);
  const bodyRef = useRef<HTMLElement>(null);
  const history = data.messagePages[threadId];
  const loadHistory = async () => {
    if (!context) return;
    const body = bodyRef.current;
    const height = body?.scrollHeight || 0;
    const top = body?.scrollTop || 0;
    await loadOlderMessages(context, threadId);
    requestAnimationFrame(() => { if (body && body === bodyRef.current) body.scrollTop = top + body.scrollHeight - height; });
  };

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

  const thinking = useMemo(() => messages.filter((message) => ['thinking', 'reasoning'].includes(String(message.kind || ''))).map(messageText).filter(Boolean), [messages]);
  const terminal = useMemo(() => messages.filter((message) => ['command', 'terminal'].includes(String(message.kind || ''))).map(messageText).filter(Boolean), [messages]);
  const diffLines = useMemo(() => changes.flatMap((entry) => [
    String(entry.path || entry.type || '变更'),
    ...(typeof entry.additions === 'number' ? [`+ ${entry.additions} 行新增`] : []),
    ...(typeof entry.deletions === 'number' ? [`- ${entry.deletions} 行删除`] : []),
  ]), [changes]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting || !context) return;
    const decision = composerSubmitDecision({
      running,
      text: fields.composer.text,
      attachmentCount: fields.composer.attachments.length,
    });
    if (decision.kind === 'blocked-running') {
      fields.setError('当前任务仍在运行。消息未发送，草稿已保留；请先点“停止”或等待本轮结束。');
      return;
    }
    if (decision.kind === 'empty') return;
    const text = fields.composer.text.trim();
    const attachments = fields.composer.attachments;
    if (supportsImages(fields.catalog, fields.preference.model) === false && attachments.some((item) => item.kind === 'image')) {
      fields.setError('当前模型仅支持文字。请移除图片或改用支持图片的模型。'); return;
    }
    const payload = buildSendPayload({
      message: text, clientRequestId: '', model: fields.preference.model, effort: fields.preference.effort, attachments,
    });
    const identity = sendRequestIdentity({ ...payload, threadId, newThread: false });
    payload.clientRequestId = requestIdForIdentity(identity);
    setSubmitting(true);
    fields.setBusy(true);
    fields.setError('');
    const ok = await sendMessage(context, threadId, { ...payload, threadId });
    setSubmitting(false);
    fields.setBusy(false);
    if (ok) {
      clearComposerInputs(scope, threadId, fields.composer.text, attachments);
      haptic('success');
    } else {
      // Keep text, tray, model/effort, and the same clientRequestId for retry.
      fields.setError(`${dataStore.getState().error || '发送未确认成功。'} 草稿和附件已保留，可再次点发送。`);
      haptic('error');
    }
  };

  const stopRunning = async (): Promise<void> => {
    if (submitting || !context || !running) return;
    setSubmitting(true);
    fields.setBusy(true);
    fields.setError('');
    const ok = await interruptThread(context, threadId);
    setSubmitting(false);
    fields.setBusy(false);
    if (!ok) {
      fields.setError(`${dataStore.getState().error || '停止请求未成功。'} 输入内容已保留。`);
      return;
    }
    await refreshMessages(context, threadId);
  };

  return (
    <div className="tl-detail-scroll">
      <header className="tl-safe-top" style={{ background: 'rgba(255,255,255,.96)', borderBottom: `.5px solid ${COLORS.separator}`, padding: '6px 10px 7px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 44 }}>
          <button type="button" className="tl-press" aria-label="返回" onClick={() => { haptic('selection'); closeDetail(); }}
            style={{ minWidth: 44, minHeight: 44, border: 0, borderRadius: 12, background: 'transparent', color: COLORS.blue, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={24} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: COLORS.labelPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || '会话详情'}</div>
            <div style={{ fontSize: 11, lineHeight: '15px', color: COLORS.labelSecondary }}>
              {status?.interactionRequired ? '等待电脑端处理' : running ? '运行中' : '空闲'}
              {status?.staleTurn ? ' · 长时间无输出' : ''}
            </div>
          </div>
          {running && <Loader2 size={17} className="tl-spin" color={COLORS.blue} aria-label="运行中" />}
        </div>
      </header>

      <main ref={bodyRef} className="tl-detail-body tl-no-scrollbar">
        {history?.hasOlder && <div style={{ padding: '8px 12px' }}>
          <button type="button" className="tl-connect-manual" disabled={history.loading || !history.olderCursor} onClick={() => { void loadHistory(); }}>
            {history.loading ? '正在加载历史…' : history.olderCursor ? '加载更早消息' : '电脑端暂未提供更早消息游标'}
          </button>
          {history.error && <div role="alert" className="tl-page-note tl-page-note--error">{history.error} 可再次点击重试。</div>}
        </div>}
        <div className="tl-chat-list" role="log" aria-label="消息流">
          {messages.length === 0 ? (
            <div role="status" style={{ fontSize: 13, lineHeight: '19px', color: COLORS.labelSecondary, padding: '8px 4px' }}>
              {data.messageState[threadId]?.error || (data.messageState[threadId]?.loaded ? '暂无消息，可以发送第一条消息。' : '正在加载消息…')}
              {data.messageState[threadId]?.error && <button type="button" className="tl-connect-manual" onClick={() => { if (context) void refreshMessages(context, threadId); }}>重试加载消息</button>}
            </div>
          ) : messages.map((message: ThreadMessage, index: number) => {
            const isUser = message.role === 'user';
            const text = messageText(message);
            const images = Array.isArray(message.images) ? message.images : [];
            if (message.role === 'interaction' && message.approvalKind) {
              return <div key={`approval:${threadId}:${String(message.requestId || message.id || index)}:${String(message.detailsHash || '')}`} className="tl-chat-row tl-approval-row"><ApprovalCard message={message} context={context} threadId={threadId} /></div>;
            }
            if (!text && !images.length) return null;
            return (
              <div key={String(message.id || index)} className={`tl-chat-row${isUser ? ' tl-chat-row--user' : ''}`}>
                <div className={`tl-chat-bubble tl-selectable ${isUser ? 'tl-chat-bubble--user' : 'tl-chat-bubble--assistant'}`}>
                  {isUser ? text || '(空消息)' : <MarkdownMessage text={text || '(空消息)'} />}
                  {images.length > 0 && (
                    <div className="tl-chat-attachment" aria-label={`${images.length} 张图片`}>
                      {images.slice(0, 4).map((image: unknown, imageIndex: number) => {
                        const src = typeof image === 'string' ? image
                          : image && typeof image === 'object' ? String((image as { url?: unknown; dataUrl?: unknown }).url || (image as { dataUrl?: unknown }).dataUrl || '') : '';
                        return src ? <img key={imageIndex} src={src} alt={`附件 ${imageIndex + 1}`} /> : null;
                      })}
                      <span>{images.length} 张图片</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <CollapsibleLog title="推理过程" icon={<Brain size={16} color={COLORS.blue} />} lines={thinking.map(compactMessageText)} />
        <CollapsibleLog title="命令记录" icon={<Terminal size={16} color={COLORS.labelSecondary} />} lines={terminal.map(compactMessageText)} />
        {diffLines.length > 0 && (
          <>
            <div style={{ fontSize: 12, lineHeight: '17px', color: COLORS.labelSecondary, padding: '4px 16px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileDiff size={14} /> {changes.length} 个文件变更
            </div>
            <CollapsibleLog title="变更明细" icon={<FileDiff size={16} color={COLORS.labelSecondary} />} lines={diffLines} />
          </>
        )}
      </main>

      <form className="tl-composer" onSubmit={(event) => { void onSubmit(event); }} aria-label="消息编辑器">
        <ComposerFields fields={fields} enterKeyHint={running ? 'done' : 'send'}
          primary={<ChatPrimaryButton scope={scope} threadId={threadId} fields={fields} onStop={stopRunning} />} />
      </form>
    </div>
  );
}
