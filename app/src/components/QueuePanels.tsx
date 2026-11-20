import { useEffect, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowUp, ArrowUpToLine, ChevronLeft, ChevronRight, CornerUpLeft,
  Image as ImageIcon, ListOrdered, Loader2, Paperclip, PauseCircle, Pencil, RotateCw, Trash2,
} from 'lucide-react';
import VaulSheet from './VaulSheet';
import AuthedImage from './AuthedImage';
import { COLORS } from '../theme/optionATokens';
import {
  QUEUE_FAILED_HEAD_NOTE,
  QUEUE_FAILED_ORDER_NOTE,
  QUEUE_PAUSED_NOTICE,
  queueActionRows, queueAttachmentDetail, queueBarSummary, queueCountText,
  queueFailureText, queueItemPreview, queueItemSubtitle, queueLimitNote, queueMetaLine,
  queueSheetSubtitle, queueStateBadge,
  type QueueActionId,
} from '../lib/queueLogic';
import { haptic, pushNativeBackLayer } from '../lib/nativeBridge';
import { currentRequestContext } from '../state/sessionStore';
import {
  cancelQueuedMessage, refreshQueue, reorderQueuedMessage, retryQueuedMessage,
  steerQueuedMessage,
} from '../state/dataStore';
import { DEFAULT_QUEUE_CAPABILITIES, type QueueMessage, type ThreadRuntimeStatus } from '../lib/chatContract';
import type { QueueDraft } from '../lib/turnloomApi';

/** 22px numbered circle; the row keeps the 44px hit area. */
function QueueIndex({ position }: { position: number }) {
  return <span className="tl-queue-index" aria-hidden="true">{position}</span>;
}

/**
 * One persistent row above the composer. Paused: the row trades its chevron for
 * a real "恢复" button so the queue can be resumed without opening the panel.
 */
export function QueueBar({ status, busy, onOpen, onResume }: {
  status: ThreadRuntimeStatus | null;
  busy: boolean;
  onOpen: (failedId?: string) => void;
  onResume: () => void;
}) {
  if (!status || status.queueLength <= 0) return null;
  const summary = queueBarSummary({
    queueLength: status.queueLength,
    queuePaused: status.queuePaused,
    queue: status.queuedMessages,
  });
  const paused = summary.showResume;
  return (
    <div className={`tl-queuebar${paused ? ' tl-queuebar--paused' : ''}`} role="group" aria-label="排队消息">
      <button
        type="button"
        className="tl-press tl-queuebar-main"
        aria-label={`${queueCountText(status.queueLength)}，${summary.text}，打开排队消息`}
        onClick={() => { haptic('selection'); onOpen(summary.failedId || undefined); }}
      >
        {summary.tone === 'warning'
          ? <PauseCircle size={14} color={COLORS.warningLabel} aria-hidden="true" />
          : <ListOrdered size={14} color={summary.tone === 'red' ? COLORS.red : COLORS.labelSecondary} aria-hidden="true" />}
        <span className="tl-queuebar-count">{queueCountText(status.queueLength)}</span>
        <span className={`tl-queuebar-state tl-queuebar-state--${summary.tone}`}>{summary.text}</span>
        {!paused && <ChevronRight size={14} color={COLORS.labelSecondary} aria-hidden="true" />}
      </button>
      {paused && (
        <button
          type="button"
          className="tl-press tl-queuebar-resume"
          aria-label="恢复队列"
          disabled={busy}
          onClick={() => { haptic('selection'); onResume(); }}
        >
          恢复
        </button>
      )}
    </div>
  );
}

function StateBadge({ item }: { item: QueueMessage }) {
  const badge = queueStateBadge(item.deliveryState);
  const tone = badge.tone === 'red' ? ' is-red' : badge.tone === 'blue' ? ' is-blue' : '';
  return (
    <span className={`tl-queue-badge${tone}`}>
      {badge.spinning && <Loader2 size={14} className="tl-spin" aria-hidden="true" />}
      {badge.label}
    </span>
  );
}

function QueueRow({ item, index, onOpen }: { item: QueueMessage; index: number; onOpen: () => void }) {
  const meta = queueMetaLine(item);
  const subtitle = queueItemSubtitle(item);
  return (
    <button
      type="button"
      className={`tl-press tl-queue-row${item.deliveryState === 'failed' ? ' tl-queue-row--failed' : ''}`}
      aria-label={`第 ${item.position || index + 1} 条，${subtitle}，${queueItemPreview(item)}`}
      onClick={() => { haptic('selection'); onOpen(); }}
    >
      <QueueIndex position={item.position || index + 1} />
      <span className="tl-queue-row-text">
        <span className="tl-queue-row-preview">{queueItemPreview(item)}</span>
        {meta && <span className="tl-queue-row-meta">{meta}</span>}
      </span>
      <StateBadge item={item} />
      <ChevronRight size={16} color={COLORS.labelSecondary} aria-hidden="true" />
    </button>
  );
}

const ACTION_ICONS: Record<QueueActionId, typeof Pencil> = {
  edit: Pencil,
  steer: CornerUpLeft,
  top: ArrowUpToLine,
  up: ArrowUp,
  down: ArrowDown,
  retry: RotateCw,
  remove: Trash2,
};

/**
 * Bottom drawer with the queue list and a one-level drill-down per item. Both
 * levels share one Vaul drawer so there is never a second overlay or scroll lock;
 * BACK closes the drill-down first (LIFO layers), then the drawer.
 */
export function QueueSheet({
  open, onClose, threadId, running, status, composerHasContent,
  onRetrieved, onNotice, onResume, initialItemId,
}: {
  open: boolean;
  onClose: () => void;
  threadId: string;
  running: boolean;
  status: ThreadRuntimeStatus | null;
  composerHasContent: boolean;
  onRetrieved: (draft: QueueDraft) => void;
  onNotice: (text: string) => void;
  onResume: () => void;
  initialItemId?: string;
}) {
  const [viewId, setViewId] = useState('');
  const [busy, setBusy] = useState<QueueActionId | ''>('');
  const [error, setError] = useState('');
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [loading, setLoading] = useState(false);
  const context = currentRequestContext();

  const queue = status?.queuedMessages || [];
  const queueLength = status?.queueLength || 0;
  const paused = Boolean(status?.queuePaused);
  const capabilities = status?.queueCapabilities || DEFAULT_QUEUE_CAPABILITIES;
  const failedIndex = queue.findIndex((row) => row.deliveryState === 'failed');
  const viewIndex = viewId ? queue.findIndex((row) => row.id === viewId) : -1;
  const item = viewIndex >= 0 ? queue[viewIndex] : null;

  // Opening refreshes from the server: the bar may only know a count.
  useEffect(() => {
    if (!open) {
      setViewId(''); setError(''); setConfirmEdit(false); setConfirmRemove(false); setBusy('');
      return;
    }
    setViewId(initialItemId || '');
    setError('');
    setConfirmEdit(false);
    setConfirmRemove(false);
    if (!context) return;
    setLoading(true);
    const token = context;
    void refreshQueue(token, threadId).finally(() => setLoading(false));
  }, [open, initialItemId, threadId, context?.scope, context?.generation]);

  // The item was removed / replaced while its detail was open: back to the list.
  useEffect(() => {
    if (!open || !viewId || loading) return;
    if (queueLength !== queue.length) return;
    if (!queue.some((row) => row.id === viewId)) setViewId('');
  }, [open, viewId, queue, queueLength, loading]);

  // The detail level owns BACK before the drawer does.
  useEffect(() => {
    if (!open || !viewId) return;
    return pushNativeBackLayer(() => {
      haptic('selection');
      setViewId('');
      setConfirmEdit(false);
      setConfirmRemove(false);
    });
  }, [open, viewId]);

  const run = async (key: QueueActionId, work: () => Promise<{ ok: boolean; error: string }>): Promise<boolean> => {
    if (busy) return false;
    setBusy(key);
    setError('');
    const result = await work();
    setBusy('');
    if (!result.ok) {
      setError(result.error || '操作未成功，请重试。');
      haptic('error');
      if (context) void refreshQueue(context, threadId);
      return false;
    }
    if (context) void refreshQueue(context, threadId);
    return true;
  };

  const retrieve = async (): Promise<void> => {
    if (!context || !item || busy) return;
    setConfirmEdit(false);
    setBusy('edit');
    setError('');
    const result = await cancelQueuedMessage(context, threadId, item.id, true);
    setBusy('');
    if (!result.ok) {
      setError(result.error || '取回失败，请重试。');
      haptic('error');
      return;
    }
    onRetrieved(result.data?.draft || {});
    haptic('success');
    onClose();
  };

  const remove = async (): Promise<void> => {
    if (!context || !item || busy) return;
    setConfirmRemove(false);
    const ok = await run('remove', async () => {
      const result = await cancelQueuedMessage(context, threadId, item.id, false);
      return { ok: result.ok, error: result.error };
    });
    if (ok) { onNotice('已删除排队消息'); haptic('warning'); onClose(); }
  };

  const act = async (row: QueueActionId): Promise<void> => {
    if (!context || !item) return;
    if (row === 'remove') { setConfirmRemove(true); return; }
    if (row === 'edit') {
      // Only an occupied composer needs the "replace this draft" confirmation.
      if (composerHasContent) { setConfirmEdit(true); return; }
      await retrieve();
      return;
    }
    if (row === 'steer') {
      const ok = await run(row, async () => {
        const result = await steerQueuedMessage(context, threadId, item.id);
        return { ok: result.ok, error: result.error };
      });
      if (ok) {
        onNotice(capabilities.turnSteer ? '已插入本轮' : '已设为下一条');
        haptic('success');
        onClose();
      }
      return;
    }
    if (row === 'top' || row === 'up' || row === 'down') {
      const ok = await run(row, async () => {
        const result = await reorderQueuedMessage(context, threadId, item.id, row);
        return { ok: result.ok, error: result.error };
      });
      if (ok) haptic('selection');
      return;
    }
    if (row === 'retry') {
      const ok = await run(row, async () => {
        const result = await retryQueuedMessage(context, threadId, item.id);
        return { ok: result.ok, error: result.error };
      });
      if (ok) { onNotice('已重新排队'); haptic('success'); }
    }
  };

  const rows = item
    ? queueActionRows(item, viewIndex, queue.length, running, capabilities, { failedIndex })
    : [];
  const subtitle = item
    ? queueItemSubtitle(item)
    : queueSheetSubtitle({ queueLength, queuePaused: paused, queue });
  const title = item ? `排队消息 ${item.position || viewIndex + 1}` : '排队消息';
  const attachmentText = item ? queueAttachmentDetail(item) : null;
  const limitNote = queueLimitNote(queueLength);

  return (
    <VaulSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={title} subtitle={subtitle}>
      {item ? (
        <div className="tl-queue-detail">
          <button
            type="button"
            className="tl-press tl-queue-back"
            onClick={() => { haptic('selection'); setViewId(''); setConfirmEdit(false); setConfirmRemove(false); setError(''); }}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            <span>返回队列</span>
          </button>
          {failedIndex >= 0 && viewIndex > failedIndex && (
            <p className="tl-queue-order-note">{QUEUE_FAILED_HEAD_NOTE}</p>
          )}
          <div className="tl-queue-detail-body tl-no-scrollbar">
            <div className={`tl-queue-detail-text tl-selectable${item.text.trim() ? '' : ' is-empty'}`}>
              {item.text.trim() || queueItemPreview(item)}
            </div>
            {item.images.length > 0 && (
              <div className="tl-queue-detail-images">
                {item.images.slice(0, 4).map((image, index) => (
                  <AuthedImage
                    key={`${item.id}-image-${index}`}
                    src={image.url || image.dataUrl || ''}
                    alt={image.name || `图片 ${index + 1}`}
                    mimeType={image.mimeType || ''}
                  />
                ))}
              </div>
            )}
            {attachmentText && (attachmentText.images || attachmentText.files) && (
              <div className="tl-queue-detail-files">
                {attachmentText.images && <div><ImageIcon size={14} aria-hidden="true" /><span>{attachmentText.images}</span></div>}
                {attachmentText.files && <div><Paperclip size={14} aria-hidden="true" /><span>{attachmentText.files}</span></div>}
                <p>{attachmentText.note}</p>
              </div>
            )}
            {item.deliveryState === 'failed' && (
              <div role="alert" className="tl-queue-detail-error">
                <AlertCircle size={14} aria-hidden="true" />
                <span>{queueFailureText(item)}</span>
              </div>
            )}
            {error && <div role="alert" className="tl-queue-detail-error">{error}</div>}
            {confirmEdit && (
              <div className="tl-queue-confirm">
                <p>替换当前草稿？原草稿会丢失。</p>
                <div>
                  <button type="button" className="tl-press tl-queue-confirm-primary" disabled={Boolean(busy)} onClick={() => { void retrieve(); }}>替换</button>
                  <button type="button" className="tl-press tl-queue-confirm-cancel" onClick={() => setConfirmEdit(false)}>取消</button>
                </div>
              </div>
            )}
            {confirmRemove && (
              <div className="tl-queue-confirm">
                <p>删除这条排队消息？</p>
                <div>
                  <button type="button" className="tl-press tl-queue-confirm-danger" disabled={Boolean(busy)} onClick={() => { void remove(); }}>删除</button>
                  <button type="button" className="tl-press tl-queue-confirm-cancel" onClick={() => setConfirmRemove(false)}>取消</button>
                </div>
              </div>
            )}
          </div>
          {item.deliveryState === 'failed' && (
            <p className="tl-queue-order-note">{QUEUE_FAILED_ORDER_NOTE}</p>
          )}
          <div className="tl-queue-actions" role="group" aria-label="排队消息操作">
            {rows.map((row) => {
              const Icon = ACTION_ICONS[row.id];
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`tl-press tl-queue-action${row.danger ? ' is-danger' : ''}`}
                  aria-label={row.reason ? `${row.label}（${row.reason}）` : row.label}
                  disabled={row.disabled || Boolean(busy)}
                  onClick={() => { void act(row.id); }}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className="tl-queue-action-text">
                    <span>{row.label}</span>
                    {row.reason && <span className="tl-queue-action-reason">{row.reason}</span>}
                  </span>
                  {busy === row.id && <Loader2 size={16} className="tl-spin" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="tl-queue-list-wrap">
          {paused && (
            <div className="tl-queue-paused">
              <PauseCircle size={16} color={COLORS.warningLabel} aria-hidden="true" />
              <span>{QUEUE_PAUSED_NOTICE}</span>
              <button type="button" className="tl-press tl-queue-resume" onClick={() => { haptic('selection'); onResume(); }}>
                恢复队列
              </button>
            </div>
          )}
          {failedIndex >= 0 && <p className="tl-queue-head-note">{QUEUE_FAILED_HEAD_NOTE}</p>}
          {error && <div role="alert" className="tl-queue-detail-error">{error}</div>}
          {queueLength === 0 ? (
            <div className="tl-queue-empty">
              <ListOrdered size={22} color={COLORS.labelSecondary} aria-hidden="true" />
              <p className="tl-queue-empty-title">没有排队消息</p>
              <p className="tl-queue-empty-copy">本轮运行中时，发送的消息会排在这里。</p>
            </div>
          ) : (
            <div className="tl-queue-list" aria-label="排队消息列表">
              {queue.map((row, index) => (
                <QueueRow key={row.id} item={row} index={index} onOpen={() => setViewId(row.id)} />
              ))}
              {!queue.length && <p className="tl-queue-loading">{loading ? '正在读取队列…' : '正在同步队列…'}</p>}
            </div>
          )}
          {limitNote && <p className="tl-queue-note">{limitNote}</p>}
        </div>
      )}
    </VaulSheet>
  );
}
