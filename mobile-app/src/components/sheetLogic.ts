/**
 * Pure, runtime-dependency-free helpers for the two expo bottom sheets
 * (`PairingSheet` / `ApprovalBottomSheet`).
 *
 * Rules for this file:
 *  - No React / React Native / expo imports (type-only imports are avoided too),
 *    so the logic can be unit-tested with plain `node` (type stripping) and can
 *    never drag a native module into a test run.
 *  - Only structural shapes are declared here; real `Message` rows from
 *    `/api/threads/:id/messages` satisfy them, and nothing is fabricated.
 *
 * Authoritative URL normalization / QR parsing still lives in
 * `@/services/pairing`; the helpers below are UX pre-checks that mirror it.
 */

// ---------------------------------------------------------------------------
// Pairing: manual input composition, masking, error copy
// ---------------------------------------------------------------------------

export type ManualPairingInput = {
  url?: string | null;
  token?: string | null;
};

export type ManualPairingResult = { ok: true; raw: string } | { ok: false; error: string };

const HTTP_PROTOCOL = /^https?:\/\//i;
const CUSTOM_PAIRING_LINK = /^codexpocket:\/\//i;
/** Any `scheme://` prefix — used to reject non-http protocols instead of mangling them. */
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Mirrors `normalizeServerUrl()` in services/pairing.ts without importing it. */
export function toServerOrigin(raw: string | null | undefined): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const hasScheme = ANY_SCHEME.test(trimmed);
  // 只接受 http(s)；其它协议（ftp://、javascript: …）直接判无效，不做前缀拼接。
  if (hasScheme && !HTTP_PROTOCOL.test(trimmed)) return '';
  const withProtocol = HTTP_PROTOCOL.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return '';
    if (!url.hostname) return '';
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

/**
 * Builds the string handed to `parsePairingQR()` from the manual fields.
 *
 * - `codexpocket://…` pasted into the address field is used verbatim.
 * - Without an access code the address field is passed through, so a full
 *   `…/login?token=…` link keeps working.
 * - With an access code the origin is rebuilt as `<origin>/login?token=<code>`
 *   (query/hash from the address field is dropped, same as before).
 */
export function composeManualPairingInput(input: ManualPairingInput): ManualPairingResult {
  const url = String(input?.url ?? '').trim();
  const token = String(input?.token ?? '').trim();

  if (!url) return { ok: false, error: '请输入服务地址或粘贴配对码' };
  if (CUSTOM_PAIRING_LINK.test(url)) return { ok: true, raw: url };

  const origin = toServerOrigin(url);
  if (!origin) return { ok: false, error: '服务地址格式不正确，请检查地址与端口' };
  if (!token) return { ok: true, raw: url };

  return { ok: true, raw: `${origin}/login?token=${encodeURIComponent(token)}` };
}

/** Never reveals access-code characters; only the length is hinted by dot count. */
export function maskAccessCode(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return '•'.repeat(Math.min(Math.max(trimmed.length, 4), 8));
}

/** One-line, non-revealing status for the access-code field. */
export function accessCodeSummary(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '未填写访问码';
  return `已填写访问码 ${maskAccessCode(trimmed)}`;
}

const TIMEOUT_HINT = /abort|timeout|timed out|超时|已取消/i;
const NETWORK_HINT =
  /network request failed|failed to fetch|fetch failed|networkerror|enotfound|econnrefused|network is unreachable|无法连接/i;

function rawErrorText(caught: unknown): string {
  if (caught instanceof Error) return String(caught.message ?? '').trim();
  if (typeof caught === 'string') return caught.trim();
  return '';
}

/**
 * Maps a thrown pairing error to user copy. A missing/blank error still yields a
 * failure message — never an empty string that a caller could read as success.
 */
export function pairingErrorMessage(caught: unknown, fallback = '配对失败，请重试'): string {
  const text = rawErrorText(caught);
  if (!text) return fallback;
  if (TIMEOUT_HINT.test(text)) return '连接超时：请确认电脑端已启动，手机与电脑在同一网络';
  if (NETWORK_HINT.test(text)) return '无法连接电脑端：请检查服务地址、端口与网络';
  return text;
}

// ---------------------------------------------------------------------------
// Pairing: barcode scan throttle
// ---------------------------------------------------------------------------

export type ScanThrottle = { code: string; blockedUntil: number };

export const SCAN_RETRY_COOLDOWN_MS = 2500;

/**
 * Barcode callbacks fire continuously while a code stays in frame. Accept the
 * first read of a code, then block the same code until the cooldown ends so a
 * failed pairing cannot loop into a request storm; a different code is accepted
 * immediately.
 */
export function shouldHandleScan(
  throttle: ScanThrottle | null,
  code: string | null | undefined,
  now: number
): boolean {
  const value = String(code ?? '').trim();
  if (!value) return false;
  if (!throttle) return true;
  if (throttle.code !== value) return true;
  return now >= throttle.blockedUntil;
}

export function blockScanAfterFailure(
  code: string | null | undefined,
  now: number,
  cooldownMs: number = SCAN_RETRY_COOLDOWN_MS
): ScanThrottle | null {
  const value = String(code ?? '').trim();
  if (!value) return null;
  const extra = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : SCAN_RETRY_COOLDOWN_MS;
  return { code: value, blockedUntil: now + extra };
}

// ---------------------------------------------------------------------------
// Approval: queue, cursor, labels, errors
// ---------------------------------------------------------------------------

/** Structural subset of `Message` needed to render an approvable row. */
export type ApprovalRequestLike = {
  role?: string;
  requestId?: string | null;
  canApprove?: boolean;
  approvalKind?: string;
};

/** Cursor into the approvable queue. `id` wins while the row still exists. */
export type ApprovalCursor = { id: string | null; index: number };

export const EMPTY_APPROVAL_CURSOR: ApprovalCursor = { id: null, index: 0 };

/**
 * Only real server rows with `role === 'interaction'`, `canApprove` and a
 * non-empty `requestId` are approvable — identical to `approvableMessages()`.
 * Server order is preserved so "上一条 / 下一条" matches the message stream.
 */
export function approvalQueue<T extends ApprovalRequestLike>(
  requests: readonly T[] | null | undefined
): T[] {
  const list = Array.isArray(requests) ? requests : [];
  return list.filter((item) => {
    if (!item || item.role !== 'interaction' || !item.canApprove) return false;
    return String(item.requestId ?? '').trim().length > 0;
  });
}

/** `-1` for an empty queue, otherwise an integer inside `[0, length - 1]`. */
export function clampApprovalIndex(index: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) return -1;
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(safe, 0), length - 1);
}

/** An explicitly selected request must not silently change when it disappears. */
export function approvalIndexFor<T extends ApprovalRequestLike>(
  queue: readonly T[],
  cursor: ApprovalCursor
): number {
  if (queue.length === 0) return -1;
  const wanted = String(cursor?.id ?? '').trim();
  if (wanted) {
    return queue.findIndex((item) => String(item.requestId ?? '').trim() === wanted);
  }
  return clampApprovalIndex(cursor?.index ?? 0, queue.length);
}

/**
 * The row actually shown. `null` means "nothing approvable" — callers must then
 * disable both actions instead of submitting a request without a requestId.
 */
export function resolveApprovalCursor<T extends ApprovalRequestLike>(
  queue: readonly T[],
  cursor: ApprovalCursor
): { message: T; index: number } | null {
  const index = approvalIndexFor(queue, cursor);
  if (index < 0) return null;
  const message = queue[index];
  return message ? { message, index } : null;
}

/** Wraps around at both ends; no-op (empty cursor) for an empty queue. */
export function stepApprovalCursor<T extends ApprovalRequestLike>(
  queue: readonly T[],
  cursor: ApprovalCursor,
  delta: number
): ApprovalCursor {
  if (queue.length === 0) return EMPTY_APPROVAL_CURSOR;
  const current = approvalIndexFor(queue, cursor);
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  const next = (((current + step) % queue.length) + queue.length) % queue.length;
  const target = queue[next];
  const id = String(target?.requestId ?? '').trim();
  return { id: id || null, index: next };
}

/**
 * Cursor for `present(request)`:
 *  - a real request focuses that row,
 *  - `present(null)` focuses the first approvable row.
 */
export function focusApprovalCursor<T extends ApprovalRequestLike>(
  queue: readonly T[],
  request: ApprovalRequestLike | null | undefined
): ApprovalCursor {
  const requestId = String(request?.requestId ?? '').trim();
  if (!requestId) return EMPTY_APPROVAL_CURSOR;
  const index = queue.findIndex((item) => String(item.requestId ?? '').trim() === requestId);
  return { id: requestId, index: index >= 0 ? index : 0 };
}

/**
 * Single guard for both action buttons: there must be a real requestId, no
 * in-flight submit, and the session must not be read-only.
 */
export function canDecideApproval(
  shownRequestId: string | null | undefined,
  options: { pending?: boolean; readOnly?: boolean } = {}
): boolean {
  if (options.pending) return false;
  if (options.readOnly) return false;
  return String(shownRequestId ?? '').trim().length > 0;
}

const APPROVAL_KIND_LABELS: Record<string, string> = {
  command: '命令执行',
  file: '文件补丁',
  permission: '权限请求',
};

/** zh label for `approvalKind`; unknown kinds are shown verbatim. */
export function approvalKindLabel(kind?: string | null): string {
  const key = String(kind ?? '').trim();
  if (!key) return '审批请求';
  return APPROVAL_KIND_LABELS[key.toLowerCase()] ?? key;
}

/** e.g. `第 2 / 5 项`; empty string when the queue is empty. */
export function approvalPositionLabel(index: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '';
  const current = clampApprovalIndex(index, total) + 1;
  return `第 ${current} / ${total} 项`;
}

/**
 * Maps a thrown approval error to user copy. Content stays mounted so the user
 * can retry; a blank error still yields a failure message.
 */
export function approvalErrorMessage(caught: unknown, fallback = '提交失败，请重试'): string {
  const text = rawErrorText(caught);
  if (!text) return fallback;
  if (TIMEOUT_HINT.test(text)) return '提交超时：请刷新后确认审批状态再重试';
  if (NETWORK_HINT.test(text)) return '提交失败：无法连接电脑端，内容已保留，可重试';
  return `提交失败：${text}`;
}
