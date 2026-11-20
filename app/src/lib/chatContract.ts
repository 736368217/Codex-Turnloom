/**
 * Pure chat protocol helpers. Deliberately dependency-free so Node contract
 * tests can execute the exact helpers used by the React app.
 *
 * The runtime state is authoritative in GET /api/threads/:id/messages:
 * status.thinking (excluding staleTurn), status.interactionRequired, turnId
 * and startedAtMs. Never derive "running" from network activity or a list row.
 */

export type ThreadRuntimeState = 'ended' | 'running' | 'waiting';

/** Server-side delivery state of one queued message; never invented locally. */
export type QueueDeliveryState = 'queued' | 'sending' | 'awaitingConfirmation' | 'failed';

export interface QueueImageRef {
  name: string;
  /** Only an absolute (or ability-authenticated) URL is usable in a WebView. */
  url?: string;
  dataUrl?: string;
  /** The `data:` URL type; never guessed from the endpoint. */
  mimeType?: string;
}

export interface QueueFileRef {
  name: string;
  size: number;
  mimeType: string;
}

export interface QueueMessage {
  id: string;
  position: number;
  text: string;
  preview: string;
  imageCount: number;
  fileCount: number;
  images: QueueImageRef[];
  files: QueueFileRef[];
  enqueuedAt: string;
  deliveryState: QueueDeliveryState;
  lastError: string;
  model: string;
  effort: string;
}

/** What this backend can actually do with a queue; the server decides, not the UI. */
export interface QueueCapabilities {
  /** True only where steer really folds into the running turn (Codex local). */
  turnSteer: boolean;
  /** False where queued files are refused (PI-native); images still work. */
  queueFiles: boolean;
}

export const DEFAULT_QUEUE_CAPABILITIES: QueueCapabilities = {
  // Unknown is not "yes": never promise a behavior the backend has not declared.
  turnSteer: false,
  queueFiles: true,
};

export interface ThreadRuntimeStatus {
  state: ThreadRuntimeState;
  thinking: boolean;
  interactionRequired: boolean;
  staleTurn: boolean;
  turnId: string | null;
  startedAtMs: number | null;
  /** Queue snapshot from the same authoritative status object. */
  queueLength: number;
  queuePaused: boolean;
  queuedMessages: QueueMessage[];
  queueSource: string;
  queueCapabilities: QueueCapabilities;
  /** The bridge could not answer this poll; the numbers are the last known ones. */
  queueUnavailable: boolean;
}

export interface ModelCatalogEntry {
  /** Exact backend slug (`<provider>/<model>`), the only ID a send may carry. */
  id: string;
  label: string;
  /** Real provider group: the ID's prefix, or the backend's own kind. */
  provider: string;
  /** Provider as the desktop shows it (2.2.5 contract); falls back to `provider`. */
  providerLabel?: string;
  /** Bare model id inside the provider (2.2.5 contract); the UI never splits `id`. */
  modelId?: string;
  /** The desktop pinned this model; the host already orders pinned rows first. */
  pinned?: boolean;
  efforts: string[];
  defaultEffort: string;
  supportsImages: boolean | null;
}

export interface ModelCatalog {
  scope: string;
  /** Exactly the models the desktop added and enabled, in the host's order. */
  models: ModelCatalogEntry[];
  defaultModel: string;
  defaultEffort: string;
  /**
   * Model of the most recent thread that had one, as served by the host. Carried
   * verbatim: whether it may be used is decided only in `resolveTurnPreference`.
   */
  lastUsedModel: string;
}

export interface TurnPreference {
  model: string;
  effort: string;
}

export interface SendAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Plain base64 payload, never a data: URL. */
  data: string;
  /** Local preview only; never included in the API request. */
  dataUrl?: string;
  kind: 'image' | 'file';
}

export interface SendPayload {
  message: string;
  clientRequestId: string;
  model?: string;
  effort?: string;
  images: Array<{ name: string; mimeType: string; data: string }>;
  files: Array<{ name: string; mimeType: string; data: string }>;
}

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 6 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const EFFORT_LABELS: Record<string, string> = {
  low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高', ultra: '极致',
};
export const MODEL_LABEL = '模型';
export const EFFORT_LABEL = '思考强度';

export const ENDED_STATUS: ThreadRuntimeStatus = {
  state: 'ended', thinking: false, interactionRequired: false, staleTurn: false,
  turnId: null, startedAtMs: null,
  queueLength: 0, queuePaused: false, queuedMessages: [], queueSource: '',
  queueCapabilities: DEFAULT_QUEUE_CAPABILITIES, queueUnavailable: false,
};

export const EMPTY_QUEUE = {
  queueLength: 0, queuePaused: false, queuedMessages: [] as QueueMessage[],
  queueSource: '', queueCapabilities: DEFAULT_QUEUE_CAPABILITIES, queueUnavailable: false,
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function countValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function queueDeliveryState(value: unknown): QueueDeliveryState {
  const state = stringValue(value).toLowerCase();
  if (state === 'sending') return 'sending';
  if (state === 'awaitingconfirmation') return 'awaitingConfirmation';
  if (state === 'failed') return 'failed';
  return 'queued';
}

/** One queued item. Unknown shapes are dropped, never rendered as an empty row. */
export function normalizeQueueMessage(raw: unknown, index = 0): QueueMessage | null {
  const row = object(raw);
  if (!row) return null;
  const text = typeof row.text === 'string' ? row.text : '';
  const images = Array.isArray(row.images) ? row.images.map((entry) => {
    const image = object(entry);
    const name = stringValue(image?.name);
    const url = stringValue(image?.url);
    const dataUrl = stringValue(image?.dataUrl);
    const mimeType = stringValue(image?.mimeType).toLowerCase();
    return name || url || dataUrl
      ? { name, ...(url ? { url } : {}), ...(dataUrl ? { dataUrl } : {}), ...(mimeType ? { mimeType } : {}) } as QueueImageRef
      : null;
  }).filter((entry): entry is QueueImageRef => entry !== null) : [];
  const files = Array.isArray(row.files) ? row.files.map((entry) => {
    const file = object(entry);
    const name = stringValue(file?.name);
    if (!name) return null;
    return {
      name,
      size: Math.max(0, Math.trunc(Number(file?.size) || 0)),
      mimeType: stringValue(file?.mimeType),
    } as QueueFileRef;
  }).filter((entry): entry is QueueFileRef => entry !== null) : [];
  return {
    id: stringValue(row.id) || `queued-${index + 1}`,
    position: numberValue(row.position) || index + 1,
    text,
    preview: stringValue(row.preview) || text.replace(/\s+/g, ' ').slice(0, 80),
    imageCount: countValue(row.imageCount) ?? images.length,
    fileCount: countValue(row.fileCount) ?? files.length,
    images,
    files,
    enqueuedAt: stringValue(row.enqueuedAt),
    deliveryState: queueDeliveryState(row.deliveryState),
    lastError: stringValue(row.lastError).slice(0, 500),
    model: stringValue(row.model),
    effort: stringValue(row.effort),
  };
}

/** Server order is send order; `position` is display only. */
export function normalizeQueueList(raw: unknown): QueueMessage[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: QueueMessage[] = [];
  for (const entry of raw) {
    const item = normalizeQueueMessage(entry, rows.length);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    rows.push(item);
  }
  return rows;
}

export interface QueueSnapshot {
  queueLength: number;
  queuePaused: boolean;
  queuedMessages: QueueMessage[];
  queueSource: string;
  queueCapabilities: QueueCapabilities;
  queueUnavailable: boolean;
}

/** Declared capabilities only; an undeclared flag keeps its previous value. */
function capabilitiesFrom(raw: unknown, previous?: QueueSnapshot | null): QueueCapabilities {
  const row = object(raw);
  const declared = object(row?.queueCapabilities);
  const base = previous?.queueCapabilities || DEFAULT_QUEUE_CAPABILITIES;
  return {
    turnSteer: typeof declared?.turnSteer === 'boolean' ? declared.turnSteer : base.turnSteer,
    queueFiles: typeof declared?.queueFiles === 'boolean' ? declared.queueFiles : base.queueFiles,
  };
}

/**
 * Merge queue fields from a status / action response. A payload that carries
 * none of them keeps the previous snapshot (a failed poll or a local stop must
 * not blank the bar); a length that disagrees with the cached list drops the
 * list so the bar count and the panel can never claim different numbers.
 */
export function normalizeQueueSnapshot(raw: unknown, previous?: QueueSnapshot | null): QueueSnapshot {
  const row = object(raw);
  const hasMessages = Array.isArray(row?.queuedMessages);
  const lengthValue = countValue(row?.queueLength);
  const hasPaused = typeof row?.queuePaused === 'boolean';
  if (!row || (!hasMessages && lengthValue === null && !hasPaused)) {
    if (!previous) return { ...EMPTY_QUEUE, queuedMessages: [], queueCapabilities: capabilitiesFrom(raw) };
    // Copy only the queue fields: `previous` may be a full ThreadRuntimeStatus.
    return {
      queueLength: previous.queueLength,
      queuePaused: previous.queuePaused,
      queuedMessages: previous.queuedMessages.slice(),
      queueSource: previous.queueSource,
      queueCapabilities: capabilitiesFrom(raw, previous),
      queueUnavailable: previous.queueUnavailable,
    };
  }
  const list = hasMessages ? normalizeQueueList(row?.queuedMessages) : [];
  const length = hasMessages ? list.length : lengthValue ?? previous?.queueLength ?? 0;
  const kept = hasMessages
    ? list.slice(0, length)
    : previous && previous.queuedMessages.length === length
      ? previous.queuedMessages.slice(0, length)
      : [];
  return {
    queueLength: length,
    queuePaused: hasPaused ? row?.queuePaused === true : Boolean(previous?.queuePaused),
    queuedMessages: kept,
    queueSource: stringValue(row?.queueSource) || previous?.queueSource || '',
    queueCapabilities: capabilitiesFrom(row, previous),
    queueUnavailable: row?.queueUnavailable === true,
  };
}

/** Normalize only a top-level messages-response status object. */
export function normalizeThreadStatus(raw: unknown, previous?: ThreadRuntimeStatus | null): ThreadRuntimeStatus {
  const status = object(raw);
  const queue = normalizeQueueSnapshot(raw, previous);
  if (!status) return { ...ENDED_STATUS, ...queue };
  const thinking = status.thinking === true;
  const staleTurn = status.staleTurn === true;
  const interactionRequired = status.interactionRequired === true;
  const authoritativeThinking = thinking && !staleTurn;
  return {
    state: authoritativeThinking ? 'running' : interactionRequired ? 'waiting' : 'ended',
    thinking: authoritativeThinking,
    interactionRequired,
    staleTurn,
    turnId: stringValue(status.turnId) || null,
    startedAtMs: numberValue(status.startedAtMs),
    ...queue,
  };
}

/** The primary button is STOP only for a real, non-stale running turn. */
export function isRunning(status: ThreadRuntimeStatus | null | undefined): boolean {
  return Boolean(status && status.state === 'running' && status.thinking && !status.staleTurn);
}

function cleanEfforts(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => stringValue(item)).filter(Boolean)))
    : [];
}

/** The backend's own kind is a real provider label; never invented. */
function backendProvider(health: Record<string, unknown>): string {
  const kind = stringValue(object(health.backend)?.kind).toLowerCase();
  if (kind === 'codex') return 'Codex';
  if (kind === 'pi' || kind === 'pidesk') return 'Pi-Desktop';
  return stringValue(object(health.backend)?.kind) || '当前服务';
}

/** Real grouping: explicit field, then the ID's `provider/model` prefix. */
function providerOf(id: string, row: Record<string, unknown>, fallback: string): string {
  const explicit = stringValue(row.provider);
  if (explicit) return explicit;
  const slash = id.indexOf('/');
  return slash > 0 ? id.slice(0, slash) : fallback;
}

/** Preserve exact backend IDs; omit capability claims the backend did not make. */
export function normalizeHealthCatalog(raw: unknown, scope: string): ModelCatalog {
  const health = object(raw) || {};
  const fallbackProvider = backendProvider(health);
  const models = Array.isArray(health.models)
    ? health.models.map((entry): ModelCatalogEntry | null => {
      const row = object(entry);
      const id = stringValue(row?.id);
      if (!row || !id) return null;
      const efforts = cleanEfforts(row.efforts);
      const defaultEffort = efforts.includes(stringValue(row.defaultEffort))
        ? stringValue(row.defaultEffort) : efforts[0] || '';
      const provider = providerOf(id, row, fallbackProvider);
      const slash = id.indexOf('/');
      return {
        id,
        label: stringValue(row.label) || id,
        provider,
        providerLabel: stringValue(row.providerLabel) || provider,
        modelId: stringValue(row.modelId) || (slash >= 0 ? id.slice(slash + 1) : id),
        pinned: row.pinned === true || row.pin === true,
        efforts,
        defaultEffort,
        supportsImages: typeof row.supportsImages === 'boolean' ? row.supportsImages : null,
      };
    }).filter((entry): entry is ModelCatalogEntry => entry !== null)
    : [];
  const defaultModel = models.some((entry) => entry.id === stringValue(health.defaultModel))
    ? stringValue(health.defaultModel) : models[0]?.id || '';
  const selected = models.find((entry) => entry.id === defaultModel);
  const defaultEffort = selected?.efforts.includes(stringValue(health.defaultEffort))
    ? stringValue(health.defaultEffort) : selected?.defaultEffort || '';
  // Carried as served: `resolveTurnPreference` checks membership, so an ID the
  // catalogue no longer lists can never become a default here or in the store.
  const lastUsedModel = stringValue(health.lastUsedModel);
  return { scope: String(scope || ''), models, defaultModel, defaultEffort, lastUsedModel };
}

/**
 * Resolve a per-thread selection. A user's explicit per-thread choice wins; then
 * the thread's own model; then the last model used on this machine — only if the
 * active catalogue still lists it; then the catalogue default. This is the one
 * place the fallback order lives (the store only carries `lastUsedModel`).
 */
export function resolveTurnPreference(
  catalog: ModelCatalog | null | undefined,
  saved: Partial<TurnPreference> | null | undefined,
  threadModel: unknown,
): TurnPreference {
  const models = catalog?.models || [];
  const savedModelId = stringValue(saved?.model);
  const savedModel = savedModelId ? models.find((entry) => entry.id === savedModelId) : undefined;
  // 用户明确选过的模型即使暂时不在目录里也要保留：静默换成目录里的别的模型，
  // 会让手机显示的和电脑端实际跑的不是同一个（真机上已复现）。
  const savedOverride: ModelCatalogEntry | undefined = savedModelId && !savedModel
    ? {
      id: savedModelId,
      label: savedModelId,
      provider: savedModelId.includes('/') ? savedModelId.slice(0, savedModelId.indexOf('/')) : '',
      efforts: [],
      defaultEffort: '',
      supportsImages: null,
    }
    : undefined;
  const byId = (id: unknown): ModelCatalogEntry | undefined => models.find((entry) => entry.id === stringValue(id));
  // 会话里的模型 ID 可能没有 provider 前缀（`deepseek-v4.1-flash`），目录里是
  // `wbfd/deepseek-v4.1-flash`；不归一就会掉到目录默认模型，进而每轮都请求切换。
  const threadEntry = matchModelEntry(
    models,
    threadModel,
    modelProvider(stringValue(threadModel)) || modelProvider(stringValue(catalog?.defaultModel)),
  );
  // `lastUsedModel` 只有仍在当前集合里才可用：它可能来自已停用供应商或已移除模型。
  const lastUsedEntry = byId(catalog?.lastUsedModel);
  // A saved per-thread choice is an intentional override; threadModel is only
  // the first-entry fallback before the user has picked anything.
  const selected = savedModel || savedOverride || threadEntry || lastUsedEntry
    || byId(catalog?.defaultModel) || models[0];
  if (!selected) return { model: '', effort: '' };
  const savedEffort = selected.id === savedModelId ? stringValue(saved?.effort) : "";
  const healthDefaultEffort = stringValue(catalog?.defaultEffort);
  const effort = savedEffort && selected.efforts.includes(savedEffort)
    ? savedEffort
    : selected.efforts.includes(selected.defaultEffort)
      ? selected.defaultEffort
      : healthDefaultEffort && selected.efforts.includes(healthDefaultEffort)
        ? healthDefaultEffort
        : selected.efforts[0] || '';
  return { model: selected.id, effort };
}
export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] || effort;
}

/**
 * 模型 ID 归一：目录里可能给 `wbfd/deepseek-v4.1-flash`，而会话里记的是
 * `deepseek-v4.1-flash`（真机上两者同时出现过）。裸 ID 与带 provider 前缀的
 * ID 指同一个模型，不能因为字符串不等就回退到别的模型——那会让每一轮发送
 * 都变成一次「切换模型」，桥侧会走 dangerous 的 session/configure 并弹原生框。
 */
export function normalizeModelId(value: unknown): string {
  return stringValue(value).replace(/^\/+|\/+$/g, '');
}

function modelSuffix(id: string): string {
  const normalized = normalizeModelId(id);
  const slash = normalized.lastIndexOf('/');
  return (slash >= 0 ? normalized.slice(slash + 1) : normalized).toLowerCase();
}

function modelProvider(id: string): string {
  const normalized = normalizeModelId(id);
  const slash = normalized.indexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '';
}

/**
 * 精确 ID 优先；否则按「最后一个 `/` 之后」匹配。同尾段出现多个时，
 * 优先与 `preferProvider`（会话自己的 provider，或目录默认模型）一致的；
 * 仍然无法唯一确定就返回 undefined，绝不随便挑一个。
 */
export function matchModelEntry(
  models: ModelCatalogEntry[],
  rawId: unknown,
  preferProvider = '',
): ModelCatalogEntry | undefined {
  const wanted = normalizeModelId(rawId);
  if (!wanted || !models.length) return undefined;
  const exact = models.find((entry) => entry.id === wanted);
  if (exact) return exact;
  const wantedSuffix = modelSuffix(wanted);
  const candidates = models.filter((entry) => modelSuffix(entry.id) === wantedSuffix);
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  const provider = modelProvider(wanted) || preferProvider;
  return provider ? candidates.find((entry) => modelProvider(entry.id) === provider) : undefined;
}

/**
 * 一条普通消息该不该带 model/effort。
 *
 * 只有两种情况需要带：会话当前模型就是选中的模型（same-pair，`model` 省略，
 * 只在用户显式改过强度时带 effort），或用户在模型面板里真的选了一个新模型。
 * 「打开会话」本身不是一次切换——不带 model 时电脑端沿用会话自己的模型。
 */
export function sendModelFields(input: {
  catalog?: ModelCatalog | null;
  preference: TurnPreference;
  threadModel?: unknown;
  /** 用户是否在模型面板里为这个会话显式选过 */
  explicit?: boolean;
}): { model?: string; effort?: string } {
  const preferred = normalizeModelId(input.preference.model);
  if (!preferred) return {};
  const rawThread = normalizeModelId(input.threadModel);
  if (rawThread) {
    const threadEntry = matchModelEntry(input.catalog?.models || [], rawThread, modelProvider(preferred));
    const sameAsThread = preferred === rawThread || Boolean(threadEntry && threadEntry.id === preferred);
    if (sameAsThread) return input.explicit && input.preference.effort ? { effort: input.preference.effort } : {};
  }
  if (!input.explicit) return {};
  return { model: preferred, ...(input.preference.effort ? { effort: input.preference.effort } : {}) };
}

export function supportsImages(catalog: ModelCatalog | null | undefined, modelId: string): boolean | null {
  const entry = catalog?.models.find((item) => item.id === modelId);
  return entry ? entry.supportsImages : null;
}
/** Preserve intentional line breaks; collapse pathological blank-line runs. */
export function compactMessageText(raw: unknown, maxBlankLines = 2): string {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const normalized = text.replace(/\r\n?/g, '\n');
  const limit = Math.max(0, Math.min(8, Math.trunc(maxBlankLines)));
  const blank = new RegExp(`(?:\\n[ \\t]*){${limit + 2},}`, 'g');
  return normalized.replace(blank, '\n'.repeat(limit + 1));
}

/** safely accept either `content` or `text`, including non-string fallbacks. */
export function messageText(message: unknown): string {
  const row = object(message);
  if (!row) return '';
  const value = typeof row.content === 'string' ? row.content
    : typeof row.text === 'string' ? row.text
      : row.content != null ? row.content : row.text != null ? row.text : '';
  return compactMessageText(value);
}

/** A data URL is a local picker representation, not a request body field. */
export function plainBase64(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^data:[^;,]*;base64,([a-zA-Z0-9+/=\s]+)$/i.exec(value.trim());
  return (match ? match[1] : value.trim()).replace(/\s/g, '');
}

export function attachmentPayload(attachments: SendAttachment[]): Pick<SendPayload, 'images' | 'files'> {
  const images: SendPayload['images'] = [];
  const files: SendPayload['files'] = [];
  for (const attachment of attachments) {
    const item = {
      name: String(attachment.name || '').slice(0, 120),
      mimeType: String(attachment.mimeType || '').toLowerCase(),
      data: plainBase64(attachment.data),
    };
    if (attachment.kind === 'image') images.push(item);
    else files.push(item);
  }
  return { images, files };
}

/** Stable retry identity: identical user input keeps its clientRequestId. */
export function sendRequestIdentity(payload: Omit<SendPayload, 'clientRequestId'> & {
  threadId?: string; newThread?: boolean; projectId?: string;
}): string {
  return JSON.stringify({
    threadId: payload.threadId || null,
    newThread: Boolean(payload.newThread),
    projectId: payload.projectId || '',
    message: payload.message,
    model: payload.model || '',
    effort: payload.effort || '',
    images: payload.images,
    files: payload.files,
  });
}

export function buildSendPayload(input: {
  message: string;
  clientRequestId: string;
  model?: string;
  effort?: string;
  attachments?: SendAttachment[];
}): SendPayload {
  return {
    message: input.message,
    clientRequestId: input.clientRequestId,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...attachmentPayload(input.attachments || []),
  };
}

export interface AttachmentValidation {
  ok: boolean;
  error: string;
  attachments: SendAttachment[];
}

/** Enforce picker limits, image types, and known text-only model capability. */
export function validateAttachments(
  existing: SendAttachment[],
  incoming: Array<Pick<SendAttachment, 'name' | 'mimeType' | 'kind' | 'data' | 'dataUrl' | 'sizeBytes' | 'id'>>,
  imageSupport: boolean | null = null,
): AttachmentValidation {
  const seen = new Set<string>();
  const combined: SendAttachment[] = [];
  for (const item of [...existing, ...incoming]) {
    const name = String(item.name || '');
    const mimeType = String(item.mimeType || '').toLowerCase();
    const data = plainBase64(item.data || item.dataUrl);
    const kind = item.kind === 'image' ? 'image' : 'file';
    const identity = `${kind}:${name}:${mimeType}:${data}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const sizeBytes = Number(item.sizeBytes) || Math.floor(data.length * 3 / 4);
    combined.push({
      id: String(item.id || `${kind}-${combined.length}-${name}`),
      name, mimeType, sizeBytes, data,
      ...(item.dataUrl ? { dataUrl: item.dataUrl } : {}),
      kind,
    });
  }
  if (combined.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `最多添加 ${MAX_ATTACHMENTS} 个附件，请移除一些后重试。`, attachments: existing };
  }
  if (combined.reduce((total, item) => total + item.sizeBytes, 0) > MAX_ATTACHMENTS_TOTAL_BYTES) {
    return { ok: false, error: '附件总大小不能超过 6 MiB，请移除大文件后重试。', attachments: existing };
  }
  for (const item of combined) {
    if (item.sizeBytes > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `「${item.name || '附件'}」超过 4 MiB，请选择更小的文件。`, attachments: existing };
    }
    if (item.kind === 'image' && !IMAGE_MIME_TYPES.includes(item.mimeType as typeof IMAGE_MIME_TYPES[number])) {
      return { ok: false, error: '图片仅支持 JPEG、PNG、WebP 格式。', attachments: existing };
    }
  }
  if (imageSupport === false && combined.some((item) => item.kind === 'image')) {
    return { ok: false, error: '当前模型仅支持文字。请移除图片或改用支持图片的模型。', attachments: existing };
  }
  return { ok: true, error: '', attachments: combined };
}

/** Thread-list status is a three-state projection; stale turns are not running. */
export function listStatusOf(status: unknown): { state: ThreadRuntimeState; thinking: boolean } {
  const normalized = normalizeThreadStatus(status);
  return { state: normalized.state, thinking: normalized.thinking };
}

export const chatContract = {
  normalizeThreadStatus, isRunning, normalizeHealthCatalog, resolveTurnPreference,
  effortLabel, supportsImages, compactMessageText, messageText, plainBase64,
  attachmentPayload, sendRequestIdentity, buildSendPayload, validateAttachments,
  listStatusOf, normalizeQueueMessage, normalizeQueueList, normalizeQueueSnapshot,
  ENDED_STATUS, EMPTY_QUEUE,
};
