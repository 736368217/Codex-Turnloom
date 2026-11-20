/**
 * Pure queue presentation helpers. Node contract tests execute these exact
 * functions, so every label, badge and enabled/disabled rule lives here rather
 * than inside a component.
 *
 * The server is the only source of `deliveryState`; this module never derives a
 * sending/failed state from timing, attachment presence or a local action.
 */

import type {
  QueueCapabilities, QueueDeliveryState, QueueMessage, SendAttachment,
} from './chatContract';
import { DEFAULT_QUEUE_CAPABILITIES } from './chatContract';

export const QUEUE_MAX_ITEMS = 20;
export const QUEUE_LIMIT_NOTE_FROM = 17;
export const QUEUE_FAILURE_CHARS = 200;

export type QueueTone = 'neutral' | 'blue' | 'red' | 'warning';

export interface QueueBarSummary {
  text: string;
  tone: QueueTone;
  /** Paused: the bar itself offers "恢复", so it must not look like a dead row. */
  showResume: boolean;
  /** First failed item, opened directly from the bar. */
  failedId: string;
}

export function isQueueLocked(state: QueueDeliveryState): boolean {
  return state === 'sending' || state === 'awaitingConfirmation';
}

export function firstFailed(queue: QueueMessage[]): QueueMessage | undefined {
  return queue.find((item) => item.deliveryState === 'failed');
}

export function queueBarSummary(input: {
  queueLength: number;
  queuePaused: boolean;
  queue: QueueMessage[];
}): QueueBarSummary {
  if (input.queueLength <= 0) return { text: '', tone: 'neutral', showResume: false, failedId: '' };
  const failed = firstFailed(input.queue);
  // FIFO: a delivery failure can only sit at the head, so say so instead of
  // counting rows inside a 12px line that has to fit 320px.
  if (failed) return { text: '队首发送失败', tone: 'red', showResume: false, failedId: failed.id };
  if (input.queuePaused) return { text: '已暂停', tone: 'warning', showResume: true, failedId: '' };
  if (input.queue.some((item) => isQueueLocked(item.deliveryState))) {
    return { text: '正在发送…', tone: 'blue', showResume: false, failedId: '' };
  }
  return { text: '下一条将在本轮结束后发送', tone: 'neutral', showResume: false, failedId: '' };
}

export function queueCountText(length: number): string {
  return `${Math.max(0, Math.trunc(length))} 条排队`;
}

/** Attachment meta line for a list row; references are text, not a field here. */
export function queueMetaLine(item: QueueMessage): string {
  const parts: string[] = [];
  if (item.imageCount > 0) parts.push(`图片 ${item.imageCount}`);
  if (item.fileCount > 0) parts.push(`附件 ${item.fileCount}`);
  return parts.join(' · ');
}

/** Two-line row preview: real text first, then an attachment-only fallback. */
export function queueItemPreview(item: QueueMessage): string {
  const text = String(item.text || '').trim();
  if (text) return item.preview || text.replace(/\s+/g, ' ').slice(0, 80);
  const parts: string[] = [];
  if (item.imageCount > 0) parts.push(`${item.imageCount} 张图片`);
  if (item.fileCount > 0) parts.push(`${item.fileCount} 个附件`);
  return parts.length ? `（${parts.join('，')}）` : '（空消息）';
}

export interface QueueBadge {
  label: string;
  tone: QueueTone;
  spinning: boolean;
}

export function queueStateBadge(state: QueueDeliveryState): QueueBadge {
  switch (state) {
    case 'sending': return { label: '发送中', tone: 'blue', spinning: true };
    case 'awaitingConfirmation': return { label: '待确认', tone: 'blue', spinning: true };
    case 'failed': return { label: '失败', tone: 'red', spinning: false };
    default: return { label: '排队中', tone: 'neutral', spinning: false };
  }
}

export function queueItemSubtitle(item: QueueMessage): string {
  switch (item.deliveryState) {
    case 'sending': return '正在发送，暂时不能修改';
    case 'awaitingConfirmation': return '等待电脑端确认，暂时不能修改';
    case 'failed': return '发送失败';
    default: return '等待本轮结束';
  }
}

export function queueSheetSubtitle(input: {
  queueLength: number;
  queuePaused: boolean;
  queue: QueueMessage[];
}): string {
  if (input.queueLength <= 0) return '没有排队消息';
  if (firstFailed(input.queue)) return '队首消息发送失败。重试、编辑或删除后继续。';
  if (input.queuePaused) return '已暂停，点「恢复」后按顺序继续发送。';
  if (input.queue.some((item) => isQueueLocked(item.deliveryState))) return '正在发送队列中的消息。';
  return '本轮结束后按顺序发送。可编辑、排序、插入本轮或删除。';
}

/** Bottom note: the cap is only worth a line when the user is near it. */
export function queueLimitNote(length: number): string {
  return length >= QUEUE_LIMIT_NOTE_FROM ? `最多 ${QUEUE_MAX_ITEMS} 条。` : '';
}

export function queueFailureText(item: QueueMessage): string {
  const raw = String(item.lastError || '').trim();
  if (!raw) return '电脑端没有给出原因，可重试或删除。';
  return raw.length > QUEUE_FAILURE_CHARS ? `${raw.slice(0, QUEUE_FAILURE_CHARS)}…` : raw;
}

export type QueueActionId = 'edit' | 'steer' | 'top' | 'up' | 'down' | 'retry' | 'remove';

export interface QueueActionRow {
  id: QueueActionId;
  label: string;
  disabled: boolean;
  reason: string;
  danger: boolean;
}

/**
 * Action panel rows in one fixed order (edit → insert → order → retry → delete).
 * "插入本轮" exists only where the backend declares real steer; "移到队首" is a
 * separate row with its own meaning. A failed item hides the whole order group
 * (the rule "a failed head is resolved, not skipped" is stated in one line of
 * copy instead of three greyed rows).
 */
export function queueActionRows(
  item: QueueMessage,
  index: number,
  total: number,
  running: boolean,
  capabilities: QueueCapabilities = DEFAULT_QUEUE_CAPABILITIES,
  options: { failedIndex?: number } = {},
): QueueActionRow[] {
  const locked = isQueueLocked(item.deliveryState);
  const failed = item.deliveryState === 'failed';
  const lockedReason = '正在发送，暂时不能修改';
  // A failed head can only be left behind by moving an item down; "to the head"
  // is blocked for everyone, and "up" only for the row touching the failed one.
  const failedIndex = Number.isInteger(options.failedIndex) ? Number(options.failedIndex) : -1;
  const headBlocked = failedIndex >= 0 && index > failedIndex;
  const upBlocked = failedIndex >= 0 && index === failedIndex + 1;
  const rows: QueueActionRow[] = [
    { id: 'edit', label: '取回编辑', disabled: locked, reason: locked ? lockedReason : '', danger: false },
  ];
  // One flag drives both meanings of steer: real turn insertion where the
  // backend supports it, and "send this next" (priority) where it does not.
  // The PI bridge only raises priority, so the word 插入本轮 must never appear.
  const showSteer = capabilities.turnSteer || !failed;
  if (showSteer) {
    const priorityBlocked = !capabilities.turnSteer && (headBlocked || index <= 0);
    rows.push({
      id: 'steer',
      label: capabilities.turnSteer ? '插入本轮' : '优先下一条',
      disabled: locked || (capabilities.turnSteer ? !running : priorityBlocked),
      reason: locked
        ? lockedReason
        : capabilities.turnSteer && !running
          ? '本轮已结束'
          : !capabilities.turnSteer && index <= 0 && !headBlocked
            ? '已是下一条'
            : '',
      danger: false,
    });
  }
  // Reordering exists only where steer is real (Codex local); PI-native has no
  // reorder endpoint, so the whole order group stays out of the panel there.
  if (!failed && capabilities.turnSteer) {
    // Blocked rows carry no per-row reason: the panel states it once in a line.
    rows.push({
      id: 'top', label: '移到队首',
      disabled: locked || index <= 0 || headBlocked,
      reason: locked ? lockedReason : index <= 0 && !headBlocked ? '已在队首' : '',
      danger: false,
    });
    if (total > 1) {
      rows.push(
        {
          id: 'up', label: '上移',
          disabled: locked || index <= 0 || upBlocked,
          reason: locked ? lockedReason : index <= 0 && !upBlocked ? '已在队首' : '',
          danger: false,
        },
        {
          id: 'down', label: '下移',
          disabled: locked || index >= total - 1,
          reason: locked ? lockedReason : index >= total - 1 ? '已在队尾' : '',
          danger: false,
        },
      );
    }
  }
  if (failed) {
    rows.push({ id: 'retry', label: '重试', disabled: locked, reason: locked ? lockedReason : '', danger: false });
  }
  rows.push({ id: 'remove', label: '删除', disabled: locked, reason: locked ? lockedReason : '', danger: true });
  return rows;
}

/** One line instead of three greyed order rows for a failed item. */
export const QUEUE_FAILED_ORDER_NOTE = '这条发送失败，先重试、编辑或删除；不能调整顺序。';

/** Stated once under the panel subtitle, never repeated on each blocked row. */
export const QUEUE_FAILED_HEAD_NOTE = '队首消息发送失败，处理前不能越过它排序。';

export interface QueueDraftPayload {
  text?: string;
  images?: Array<{ name?: string; mimeType?: string; data?: string }>;
  files?: Array<{ name?: string; mimeType?: string; data?: string }>;
}

/** `cancel {edit:true}` returns base64 rows; rebuild them as composer attachments. */
export function draftAttachments(draft: QueueDraftPayload | null | undefined): SendAttachment[] {
  const images = Array.isArray(draft?.images) ? draft?.images || [] : [];
  const files = Array.isArray(draft?.files) ? draft?.files || [] : [];
  const rows: SendAttachment[] = [];
  const push = (kind: 'image' | 'file', row: { name?: string; mimeType?: string; data?: string }, index: number) => {
    const data = String(row?.data || '').replace(/\s/g, '');
    if (!data) return;
    const mimeType = String(row?.mimeType || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream')).toLowerCase();
    const name = String(row?.name || (kind === 'image' ? `图片 ${index + 1}` : `附件 ${index + 1}`)).slice(0, 120);
    rows.push({
      id: `queue-${kind}-${index}-${name}`,
      name, mimeType,
      sizeBytes: Math.floor(data.length * 3 / 4),
      data,
      ...(kind === 'image' ? { dataUrl: `data:${mimeType};base64,${data}` } : {}),
      kind,
    });
  };
  images.forEach((row, index) => push('image', row || {}, index));
  files.forEach((row, index) => push('file', row || {}, index));
  return rows;
}

/** File chip subtitle: name is the identity, size is the useful extra. */
export function fileSizeLabel(bytes: number): string {
  const size = Number(bytes) || 0;
  if (size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Attachment text for the item detail. Thumbnails come from `AuthedImage`; these
 * lines stay underneath as the honest fallback and as the only place third-party
 * file names are shown. Names also live in each image's `alt` text.
 */
export function queueAttachmentDetail(item: QueueMessage): { images: string; files: string; note: string } {
  const imageNames = item.images.map((row, index) => row.name || `图片 ${index + 1}`).slice(0, 8);
  const fileNames = item.files.slice(0, 8).map((row) => {
    const size = fileSizeLabel(row.size);
    return size ? `${row.name}（${size}）` : row.name;
  });
  return {
    images: item.imageCount > 0
      ? `图片 ${item.imageCount} 张${item.images.length ? `：${imageNames.join('、')}` : ''}`
      : '',
    files: item.fileCount > 0
      ? `附件 ${item.fileCount} 个${fileNames.length ? `：${fileNames.join('、')}` : ''}`
      : '',
    note: item.imageCount > 0 || item.fileCount > 0 ? '附件会在发送这条消息时一起带上。' : '',
  };
}

/** The one hint line above the composer; a notice temporarily replaces it. */
export function queueHintText(input: {
  running: boolean;
  hasInput: boolean;
  queueLength: number;
  notice: string;
}): string {
  if (input.notice) return input.notice;
  if (input.running && input.hasInput && input.queueLength <= 0) {
    return '本轮运行中，发送会排队，结束后自动发出';
  }
  return '';
}

/**
 * State fact, not an action story: a pause marker survives a server restart,
 * and then "you interrupted this turn" would simply be false.
 */
export const QUEUE_PAUSED_NOTICE = '队列已暂停。恢复后按顺序继续。';
