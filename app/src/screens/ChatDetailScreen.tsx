import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Brain, Terminal, FileDiff, Folder, Loader2, Check, X, Sparkles } from 'lucide-react';
import { ComposerFields, ChatPrimaryButton, ModelChip, useComposerFields, requestIdForIdentity } from '../components/ChatComposer';
import MarkdownMessage from '../components/MarkdownMessage';
import VaulSheet from '../components/VaulSheet';
import { COLORS } from '../theme/optionATokens';
import { messageText, isRunning, supportsImages,
  buildSendPayload, sendRequestIdentity, type ThreadRuntimeStatus,
} from '../lib/chatContract';
import { composerSubmitDecision } from '../lib/composerSubmit';
import { haptic, pushNativeBackLayer } from '../lib/nativeBridge';
import {
  useDataState, dataStore, refreshMessages, loadOlderMessages, refreshChanges, sendMessage, interruptThread, resolveApproval, createThread,
} from '../state/dataStore';
import { closeDetail, openDetail } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { clearComposerInputs } from '../state/composerStore';
import { getThreadStatus } from '../state/runtimeStore';
import { getProjects, type ProjectInfo, type ThreadMessage } from '../lib/turnloomApi';

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
        {decisions.map(decision => <button key={decision} type="button" className={decision === 'decline' ? 'tl-approval-reject' : 'tl-approval-approve'} style={{ minHeight: 44 }} disabled={!canApprove || busy} onClick={() => { void decide(decision); }}>
          {decision === 'decline' ? <X size={15} /> : <Check size={15} />} {approvalDecisionLabel(decision)}
        </button>)}
      </div>
    </>}
  </div>;
}

/** 思考过程：浅底 + 左色条 + 明确标签，和正文气泡不是同一种东西。 */
function ThoughtBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 180;
  const expanded = open || !long;
  return (
    <div className="tl-thought">
      <button
        type="button"
        className="tl-thought-head"
        aria-expanded={expanded}
        onClick={() => { if (long) setOpen((value) => !value); }}
        style={{ minHeight: 44 }}
      >
        <Brain size={14} />
        <span>思考过程</span>
        {long && <span className="tl-thought-toggle">{open ? '收起' : '展开'}</span>}
      </button>
      <div className={`tl-thought-body${expanded ? ' tl-thought-body--open' : ''}`}>{text}</div>
    </div>
  );
}

/** 工具调用 / 输出：等宽字体 + 工具名标题，绝不混进正文气泡。 */
function ToolBlock({ text, name, failed }: { text: string; name: string; failed?: boolean }) {
  return (
    <div className={`tl-tool${failed ? ' tl-tool--error' : ''}`}>
      <div className="tl-tool-head"><Terminal size={14} /><span>{name || '工具调用'}</span></div>
      <pre className="tl-tool-body tl-selectable">{text}</pre>
    </div>
  );
}

/** Chat screen: header-only back, compact bubbles, one authoritative primary action. */
export default function ChatDetailScreen({ threadId, title, newThread = false }: { threadId: string; title: string; newThread?: boolean }) {
  const data = useDataState();
  const context = currentRequestContext();
  const scope = context?.scope || '';
  // A blank new chat keeps its own composer slot so it can never inherit a
  // real thread's draft, tray, or pending clientRequestId.
  const composerThreadId = newThread ? '__new__' : threadId;
  const messages = newThread ? [] : data.messagesByThread[threadId] || [];
  const changes = newThread ? [] : data.changesByThread[threadId] || [];
  const threadModel = newThread ? undefined : data.threads.find((row) => row.id === threadId)?.model;
  const status: ThreadRuntimeStatus | null = newThread ? null : getThreadStatus(scope, threadId);
  const running = isRunning(status);
  const fields = useComposerFields(scope, composerThreadId, threadModel);
  const [submitting, setSubmitting] = useState(false);
  // New chat: the first message is filed into a project. Defaults to the most
  // recent project the user has talked to, but "未归类" is always one tap away.
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectSheet, setProjectSheet] = useState(false);
  const projectDefaulted = useRef(false);
  const bodyRef = useRef<HTMLElement>(null);
  const history = newThread ? undefined : data.messagePages[threadId];
  const loadHistory = async () => {
    if (!context) return;
    const body = bodyRef.current;
    const height = body?.scrollHeight || 0;
    const top = body?.scrollTop || 0;
    await loadOlderMessages(context, threadId);
    requestAnimationFrame(() => { if (body && body === bodyRef.current) body.scrollTop = top + body.scrollHeight - height; });
  };

  // 系统返回键/手势：详情页是最常用的二级页，必须自己吃掉这一层。
  // 不注册的话 `handleNativeBack()` 找不到任何 layer/backHandler，返回 false，
  // native 就 `moveTaskToBack(true)` —— 真机上表现成「按返回直接回桌面」。
  useEffect(() => pushNativeBackLayer(() => { haptic('selection'); closeDetail(); }), []);

  useEffect(() => {
    if (!context || newThread) return;
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
  }, [threadId, newThread, context?.scope, context?.generation]);

  // Project choices come from the host's own /api/projects; a failure only
  // hides the list, it never blocks sending (未归类 remains valid).
  useEffect(() => {
    if (!context || !newThread) return;
    let cancelled = false;
    void getProjects(context).then((result) => {
      if (cancelled || !result.ok) return;
      const rows = Array.isArray(result.data?.projects) ? result.data.projects : [];
      setProjects(rows);
    });
    return () => { cancelled = true; };
  }, [context?.scope, context?.generation, newThread]);

  // Default to the project of the most recent conversation, once.
  useEffect(() => {
    if (!newThread || projectDefaulted.current || !data.threads.length) return;
    projectDefaulted.current = true;
    const recent = [...data.threads]
      .filter((row) => row.projectId)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
    if (recent?.projectId) setProjectId(String(recent.projectId));
  }, [newThread, data.threads]);

  const projectName = useMemo(
    () => projects.find((project) => String(project.id || '') === projectId)?.name || '未归类',
    [projects, projectId],
  );
  // The thread's own project, not the new-chat chooser: the header prints it when it
  // exists and simply omits the line when the conversation belongs to no project.
  const ownProjectName = newThread
    ? projectName
    : (((data.threads.find((row) => row.id === threadId)?.project) as { name?: string } | undefined)?.name || '');

  // 打开会话先看最新消息：首次渲染贴底；之后只要用户还在底部附近，就跟新消息走。
  const stickToBottom = useRef(true);
  const scrolledOnce = useRef(false);
  useEffect(() => {
    scrolledOnce.current = false;
    stickToBottom.current = true;
  }, [threadId]);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onScroll = () => {
      stickToBottom.current = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [threadId]);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !messages.length) return;
    if (!scrolledOnce.current) {
      scrolledOnce.current = true;
      requestAnimationFrame(() => { if (body === bodyRef.current) body.scrollTop = body.scrollHeight; });
      return;
    }
    if (stickToBottom.current) {
      requestAnimationFrame(() => { if (body === bodyRef.current) body.scrollTop = body.scrollHeight; });
    }
  }, [messages, threadId]);

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
      message: text, clientRequestId: '', model: fields.send.model, effort: fields.send.effort, attachments,
    });
    const identity = sendRequestIdentity({ ...payload, threadId: newThread ? '' : threadId, newThread, projectId: newThread ? projectId : undefined });
    payload.clientRequestId = requestIdForIdentity(identity);
    setSubmitting(true);
    fields.setBusy(true);
    fields.setError('');
    if (newThread) {
      // First message creates the real thread; the draft lives under the
      // placeholder composer slot until the host returns an id.
      const id = await createThread(context, { ...payload, projectId: projectId || undefined });
      setSubmitting(false);
      fields.setBusy(false);
      if (id) {
        clearComposerInputs(scope, composerThreadId, fields.composer.text, attachments);
        openDetail(id, text.slice(0, 48) || '新会话');
        haptic('success');
      } else {
        const reason = dataStore.getState().lastSendError || dataStore.getState().error || '会话未创建成功。';
        const suffix = /草稿/.test(reason) ? '' : ' 草稿和附件已保留，可再次点发送。';
        fields.setError(`${reason}${suffix}`);
        haptic('error');
      }
      return;
    }
    const ok = await sendMessage(context, threadId, { ...payload, threadId });
    setSubmitting(false);
    fields.setBusy(false);
    if (ok) {
      clearComposerInputs(scope, composerThreadId, fields.composer.text, attachments);
      haptic('success');
    } else {
      // Keep text, tray, model/effort, and the same clientRequestId for retry.
      // Read the failure recorded by THIS send; a stale poll error must not
      // masquerade as the reason the user's message did not go out.
      const reason = dataStore.getState().lastSendError || dataStore.getState().error || '发送未确认成功。';
      const suffix = /草稿/.test(reason) ? '' : ' 草稿和附件已保留，可再次点发送。';
      fields.setError(`${reason}${suffix}`);
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
            <div style={{ fontSize: 17, fontWeight: 600, color: COLORS.labelPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || (newThread ? '新会话' : '会话详情')}</div>
            <div style={{ fontSize: 11, lineHeight: '15px', color: COLORS.labelSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[
                ownProjectName ? `项目：${ownProjectName}` : '',
                newThread ? '输入第一条消息开始会话' : status?.interactionRequired ? '等待电脑端处理' : running ? '运行中' : '空闲',
              ].filter(Boolean).join(' · ')}
              {!newThread && status?.staleTurn ? ' · 长时间无输出' : ''}
            </div>
          </div>
          <ModelChip fields={fields} />
          {running && <Loader2 size={17} className="tl-spin" color={COLORS.blue} aria-label="运行中" />}
        </div>
      </header>

      <main ref={bodyRef} className={`tl-detail-body tl-no-scrollbar${newThread ? ' tl-detail-body--blank' : ''}`}>
        {history?.hasOlder && <div style={{ padding: '8px 12px' }}>
          <button type="button" className="tl-connect-manual" disabled={history.loading || !history.olderCursor} onClick={() => { void loadHistory(); }}>
            {history.loading ? '正在加载历史…' : history.olderCursor ? '加载更早消息' : '电脑端暂未提供更早消息游标'}
          </button>
          {history.error && <div role="alert" className="tl-page-note tl-page-note--error">{history.error} 可再次点击重试。</div>}
        </div>}
        <div className={`tl-chat-list${newThread ? ' tl-chat-list--blank' : ''}`} role="log" aria-label="消息流" style={newThread ? { flexDirection: 'column' } : undefined}>
          {newThread ? (
            <div className="tl-chat-blank">
              <div className="tl-chat-blank-orb" aria-hidden="true"><Sparkles size={26} /></div>
              <div className="tl-chat-blank-title">开始一个新会话</div>
              <p className="tl-chat-blank-copy">消息直接发给电脑上的 agent，第一条发送成功后会话会出现在列表里。</p>
              <button
                type="button"
                className="tl-press"
                aria-label={`选择项目，当前 ${projectName}`}
                onClick={() => { haptic('selection'); setProjectSheet(true); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 12, padding: '0 14px', border: `.5px solid ${COLORS.separator}`, borderRadius: 999, background: COLORS.surface, color: COLORS.labelPrimary, fontSize: 13, fontWeight: 500 }}
              >
                <Folder size={14} color={COLORS.labelSecondary} />
                <span>项目：{projectName}</span>
                <ChevronDown size={14} color={COLORS.labelSecondary} />
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div role="status" style={{ fontSize: 13, lineHeight: '19px', color: COLORS.labelSecondary, padding: '8px 4px' }}>
              {data.messageState[threadId]?.error || (data.messageState[threadId]?.loaded ? '暂无消息，可以发送第一条消息。' : '正在加载消息…')}
              {data.messageState[threadId]?.error && <button type="button" className="tl-connect-manual" onClick={() => { if (context) void refreshMessages(context, threadId); }}>重试加载消息</button>}
            </div>
          ) : messages.map((message: ThreadMessage, index: number) => {
            const isUser = message.role === 'user';
            const kind = String(message.kind || '').toLowerCase();
            const text = messageText(message);
            const images = Array.isArray(message.images) ? message.images : [];
            if (message.role === 'interaction' && message.approvalKind) {
              return <div key={`approval:${threadId}:${String(message.requestId || message.id || index)}:${String(message.detailsHash || '')}`} className="tl-chat-row tl-approval-row"><ApprovalCard message={message} context={context} threadId={threadId} /></div>;
            }
            if (!text && !images.length) return null;
            const rowKey = String(message.id || index);
            // 思考与工具不是正文：用不同的容器和排版渲染，不再塞进普通气泡。
            if (['thinking', 'reasoning', 'analysis'].includes(kind)) {
              return <div key={rowKey} className="tl-chat-row tl-chat-row--meta"><ThoughtBlock text={text} /></div>;
            }
            if (message.role === 'tool' || ['tool_call', 'tool_output', 'command', 'terminal'].includes(kind)) {
              return (
                <div key={rowKey} className="tl-chat-row tl-chat-row--meta">
                  <ToolBlock
                    text={text}
                    name={String(message.title || message.toolName || message.name || '工具调用')}
                    failed={kind === 'error' || message.isError === true}
                  />
                </div>
              );
            }
            if (kind === 'error' || message.role === 'notice' || message.role === 'system') {
              return <div key={rowKey} className="tl-chat-row tl-chat-row--meta"><div className="tl-chat-notice">{text}</div></div>;
            }
            return (
              <div key={rowKey} className={`tl-chat-row${isUser ? ' tl-chat-row--user' : ''}`}>
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
        <ComposerFields fields={fields} enterKeyHint={running ? 'done' : 'send'} autoFocus={newThread}
          primary={<ChatPrimaryButton scope={scope} threadId={composerThreadId} fields={fields} onStop={stopRunning} />} />
      </form>

      <VaulSheet open={projectSheet} onOpenChange={setProjectSheet} title="选择项目" subtitle="第一条消息会归档到这个项目">
        <div style={{ padding: '4px 16px 20px', display: 'flex', flexDirection: 'column' }}>
          <button
            type="button"
            className="tl-press"
            onClick={() => { haptic('selection'); setProjectId(''); setProjectSheet(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 4px', border: 0, borderBottom: `.5px solid ${COLORS.separator}`, background: 'transparent', color: COLORS.labelPrimary, textAlign: 'left', fontSize: 14 }}
          >
            <Folder size={16} color={COLORS.labelSecondary} />
            <span style={{ flex: 1 }}>未归类</span>
            {!projectId && <Check size={16} color={COLORS.blue} />}
          </button>
          {projects.filter((project) => project.id).map((project) => {
            const id = String(project.id);
            const selected = id === projectId;
            return (
              <button
                key={id}
                type="button"
                className="tl-press"
                onClick={() => { haptic('selection'); setProjectId(id); setProjectSheet(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 4px', border: 0, borderBottom: `.5px solid ${COLORS.separator}`, background: 'transparent', color: COLORS.labelPrimary, textAlign: 'left', fontSize: 14 }}
              >
                <Folder size={16} color={COLORS.labelSecondary} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name || '未命名项目'}</span>
                {selected && <Check size={16} color={COLORS.blue} />}
              </button>
            );
          })}
          {!projects.length && (
            <div style={{ padding: '12px 4px', fontSize: 13, lineHeight: '19px', color: COLORS.labelSecondary }}>
              电脑端还没有可用项目；仍可直接发送到「未归类」。
            </div>
          )}
        </div>
      </VaulSheet>
    </div>
  );
}
