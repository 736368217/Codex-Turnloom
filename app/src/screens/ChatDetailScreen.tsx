import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Brain, Terminal, FileDiff, Loader2 } from 'lucide-react';
import { ComposerFields, ChatPrimaryButton, useComposerFields, requestIdForIdentity } from '../components/ChatComposer';
import { COLORS } from '../theme/optionATokens';
import {
  messageText, compactMessageText, isRunning, supportsImages,
  buildSendPayload, sendRequestIdentity, type ThreadRuntimeStatus,
} from '../lib/chatContract';
import { haptic } from '../lib/nativeBridge';
import {
  useDataState, refreshMessages, refreshChanges, sendMessage, interruptThread,
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
        <pre className="tl-selectable" style={{ margin: 0, padding: 12, borderTop: `.5px solid ${COLORS.separator}`, background: COLORS.fillSecondary, color: COLORS.labelPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: 19, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
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
    if (running) {
      setSubmitting(true);
      fields.setError('');
      const ok = await interruptThread(context, threadId);
      setSubmitting(false);
      if (!ok) fields.setError('停止请求未成功，请检查连接后重试；输入内容已保留。');
      else await refreshMessages(context, threadId);
      return;
    }
    const text = fields.composer.text.trim();
    const attachments = fields.composer.attachments;
    if (!text && !attachments.length) return;
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
      fields.setError('发送未确认成功，草稿和附件已保留。请检查电脑端连接后再次点发送。');
      haptic('error');
    }
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
            <div style={{ fontSize: 11, lineHeight: 15, color: COLORS.labelSecondary }}>
              {status?.interactionRequired ? '等待电脑端处理' : running ? '运行中' : '空闲'}
              {status?.staleTurn ? ' · 长时间无输出' : ''}
            </div>
          </div>
          {running && <Loader2 size={17} className="tl-spin" color={COLORS.blue} aria-label="运行中" />}
        </div>
      </header>

      <main className="tl-detail-body tl-no-scrollbar">
        <div className="tl-chat-list" role="log" aria-label="消息流">
          {messages.length === 0 ? (
            <div role="status" style={{ fontSize: 13, lineHeight: 19, color: COLORS.labelSecondary, padding: '8px 4px' }}>
              {data.messageState[threadId]?.error || (data.messageState[threadId]?.loaded ? '暂无消息，可以发送第一条消息。' : '正在加载消息…')}
              {data.messageState[threadId]?.error && <button type="button" className="tl-connect-manual" onClick={() => { if (context) void refreshMessages(context, threadId); }}>重试加载消息</button>}
            </div>
          ) : messages.map((message: ThreadMessage, index: number) => {
            const isUser = message.role === 'user';
            const text = messageText(message);
            const images = Array.isArray(message.images) ? message.images : [];
            if (!text && !images.length) return null;
            return (
              <div key={String(message.id || index)} className={`tl-chat-row${isUser ? ' tl-chat-row--user' : ''}`}>
                <div className={`tl-chat-bubble tl-selectable ${isUser ? 'tl-chat-bubble--user' : 'tl-chat-bubble--assistant'}`}>
                  {text || '(空消息)'}
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
            <div style={{ fontSize: 12, lineHeight: 17, color: COLORS.labelSecondary, padding: '4px 16px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileDiff size={14} /> {changes.length} 个文件变更
            </div>
            <CollapsibleLog title="变更明细" icon={<FileDiff size={16} color={COLORS.labelSecondary} />} lines={diffLines} />
          </>
        )}
      </main>

      <form className="tl-composer" onSubmit={(event) => { void onSubmit(event); }} aria-label="消息编辑器">
        <ComposerFields fields={fields} primary={<ChatPrimaryButton scope={scope} threadId={threadId} fields={fields} />} />
      </form>
    </div>
  );
}
