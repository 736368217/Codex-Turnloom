/**
 * JS side of the Android TurnloomNative bridge (repair 2.1 contract).
 *
 * The packaged local page is the only caller. Native methods are invoked only
 * when they really exist; the browser fallback is an explicitly non-persistent
 * in-memory store and never pretends to have a camera, network executor, or
 * updater. Callbacks from native are routed by requestId and stale callbacks
 * are ignored after cancellation, timeout or a generation change.
 */

import { APP_IDENTITY } from '../theme/optionATokens';
import { safeExternalUrl } from './externalUrl';

export type HapticKind = 'selection' | 'success' | 'warning' | 'error';

export interface NativeHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface NativeHttpResult {
  status: number;
  body: string;
  error?: string;
}

export interface NativeUpdateOptions {
  url: string;
  token: string;
  sha256: string;
  versionCode: number;
  packageName: string;
}

export type UpdateState = 'downloading' | 'ready' | 'error' | 'cancelled' | 'permission-required';

export interface NativeUpdateEvent {
  state: UpdateState;
  received?: number;
  total?: number;
  message?: string;
}

export type QrScanResult =
  | { status: 'success'; value: string }
  | { status: 'cancelled' | 'error'; value?: string; code?: string; message?: string };

export interface NativeAttachmentItem {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export interface NativeAttachmentResult {
  status: 'success' | 'cancelled' | 'error';
  items?: NativeAttachmentItem[];
  error?: string;
}

/** Shape injected by native-shell MainActivity via addJavascriptInterface. */
export interface TurnloomNative {
  secureGet(key: string): string | null;
  secureSet(key: string, value: string): boolean;
  secureRemove(key: string): boolean;
  haptic(kind: HapticKind): void;
  scanQr(requestId: string): void;
  getAppInfo(): string;
  setLightBars(): void;
  pickAttachments?(requestId: string, kind: 'image' | 'file'): void;
  openExternalUrl?(url: string): boolean;
  request?(requestId: string, requestJson: string): void;
  cancelRequest?(requestId: string): void;
  downloadUpdate?(requestId: string, optionsJson: string): void;
  cancelUpdate?(): void;
  installUpdate?(): void;
}


export interface NativeAppInfo {
  label: string;
  version: string;
  versionCode?: number;
  packageName?: string;
  cameraAvailable?: boolean;
  updatesAvailable?: boolean;
  [key: string]: unknown;
}

declare global {
  interface Window {
    TurnloomNative?: TurnloomNative;
    __turnloomNativeQrResult?: (requestId: string, value: string) => void;
    __turnloomNativeQrError?: (requestId: string, code: string, message: string) => void;
    __turnloomNativeHttpResult?: (requestId: string, responseJson: string) => void;
    __turnloomNativeAttachmentsResult?: (requestId: string, resultJson: string) => void;
    __turnloomNativeUpdateEvent?: (requestId: string, eventJson: string) => void;
    __turnloomBack?: () => boolean;
  }
}

const memoryFallback = new Map<string, string>();
let fallbackUsed = false;

function host(): (Window & typeof globalThis) | typeof globalThis {
  return typeof window === 'undefined' ? globalThis : window;
}

function bridge(): TurnloomNative | null {
  const target = host() as Window & typeof globalThis;
  return target.TurnloomNative ?? null;
}

export function isNativeBridgeAvailable(): boolean {
  return !!bridge();
}

export function isMemoryFallbackUsed(): boolean {
  return fallbackUsed;
}

// ---------------------------------------------------------------------------
// Secure storage / small native services
// ---------------------------------------------------------------------------

export function secureGet(key: string): string | null {
  const n = bridge();
  if (n && typeof n.secureGet === 'function') {
    try { return n.secureGet(key); } catch { return null; }
  }
  fallbackUsed = true;
  return memoryFallback.has(key) ? (memoryFallback.get(key) as string) : null;
}

export function secureSet(key: string, value: string): boolean {
  const n = bridge();
  if (n && typeof n.secureSet === 'function') {
    try { return Boolean(n.secureSet(key, value)); } catch { return false; }
  }
  fallbackUsed = true;
  memoryFallback.set(key, value);
  return true;
}

export function secureRemove(key: string): boolean {
  const n = bridge();
  if (n && typeof n.secureRemove === 'function') {
    try { return Boolean(n.secureRemove(key)); } catch { return false; }
  }
  fallbackUsed = true;
  return memoryFallback.delete(key);
}

export function haptic(kind: HapticKind): void {
  const n = bridge();
  if (!n || typeof n.haptic !== 'function') return;
  try { n.haptic(kind); } catch { /* cosmetic only */ }
}

export function openExternalUrl(value: string): boolean {
  const url = safeExternalUrl(value);
  if (!url) return false;
  const native = bridge();
  if (native) {
    try { return native.openExternalUrl?.(url) === true; } catch { return false; }
  }
  return typeof window !== 'undefined' && window.open(url, '_blank', 'noopener,noreferrer') !== null;
}

export function setLightBars(): void {
  const n = bridge();
  if (!n || typeof n.setLightBars !== 'function') return;
  try { n.setLightBars(); } catch { /* cosmetic only */ }
}

function fallbackAppInfo(): NativeAppInfo {
  return {
    label: APP_IDENTITY.label,
    version: APP_IDENTITY.versionName,
    versionCode: APP_IDENTITY.versionCode,
    packageName: APP_IDENTITY.applicationId,
    cameraAvailable: false,
    updatesAvailable: false,
  };
}

export function getAppInfo(): string {
  const n = bridge();
  if (n && typeof n.getAppInfo === 'function') {
    try {
      const raw = n.getAppInfo();
      if (typeof raw === 'string' && raw.length > 0) return raw;
    } catch { /* fall through */ }
  }
  return JSON.stringify(fallbackAppInfo());
}

export function getAppInfoObject(): NativeAppInfo {
  try {
    const parsed = JSON.parse(getAppInfo()) as NativeAppInfo;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* ignore */ }
  return fallbackAppInfo();
}

/** Capability claims are read from the real native implementation only. */
export function hasNativeCamera(): boolean {
  const n = bridge();
  return Boolean(n && typeof n.scanQr === 'function' && getAppInfoObject().cameraAvailable === true);
}

export function hasNativeHttp(): boolean {
  const n = bridge();
  return Boolean(n && typeof n.request === 'function' && typeof n.cancelRequest === 'function');
}

export function hasNativeUpdater(): boolean {
  const n = bridge();
  return Boolean(
    n && typeof n.downloadUpdate === 'function' && typeof n.cancelUpdate === 'function' &&
    typeof n.installUpdate === 'function' && getAppInfoObject().updatesAvailable === true,
  );
}

// ---------------------------------------------------------------------------
// Camera QR scan: success / cancel / error are three distinct outcomes
// ---------------------------------------------------------------------------

type QrListener = (requestId: string, result: QrScanResult) => void;
interface PendingScan {
  resolve: (result: QrScanResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}
const qrListeners = new Set<QrListener>();
const pendingScans = new Map<string, PendingScan>();
let qrSeq = 0;

export function onQrResult(listener: QrListener): () => void {
  qrListeners.add(listener);
  return () => { qrListeners.delete(listener); };
}

function settleScan(requestId: string, result: QrScanResult): void {
  const pending = pendingScans.get(requestId);
  if (pending) {
    if (pending.timer !== null) clearTimeout(pending.timer);
    pendingScans.delete(requestId);
    pending.resolve(result);
  }
  for (const listener of Array.from(qrListeners)) {
    try { listener(requestId, result); } catch { /* isolate listeners */ }
  }
}

export function deliverQrResult(requestId: string, value: string): void {
  const raw = typeof value === 'string' ? value : '';
  settleScan(requestId, raw
    ? { status: 'success', value: raw }
    : { status: 'cancelled', message: '已取消扫码' });
}

export function deliverQrError(requestId: string, code: string, message: string): void {
  settleScan(requestId, {
    status: 'error',
    code: String(code || 'scan-error'),
    message: String(message || '相机扫码未成功'),
  });
}

export function requestQrScan(timeoutMs = 120_000): Promise<QrScanResult> {
  const n = bridge();
  if (!n || typeof n.scanQr !== 'function' || !hasNativeCamera()) {
    return Promise.resolve({ status: 'error', code: 'camera-unavailable', message: '此设备暂时无法使用扫码，请用下方地址和访问码连接' });
  }
  qrSeq += 1;
  const requestId = `qr-${Date.now()}-${qrSeq}`;
  return new Promise<QrScanResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingScans.delete(requestId);
      resolve({ status: 'error', code: 'scan-timeout', message: '扫码超时，请重新扫描或手动输入' });
    }, timeoutMs);
    pendingScans.set(requestId, { resolve, timer });
    try {
      n.scanQr(requestId);
    } catch {
      settleScan(requestId, { status: 'error', code: 'scan-error', message: '无法启动相机，请使用手动连接' });
    }
  });
}

// ---------------------------------------------------------------------------
// Native HTTP executor: requestId callbacks, cancellation and stale guards
// ---------------------------------------------------------------------------

export interface NativeRequestHandle {
  requestId: string;
  promise: Promise<NativeHttpResult>;
  cancel: () => void;
}

interface PendingHttp {
  resolve: (result: NativeHttpResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}
const pendingRequests = new Map<string, PendingHttp>();
let httpSeq = 0;

/** Accept only absolute http(s) /api/* URLs without userinfo or fragment. */
export function isAllowedApiUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password || url.hash) return false;
    if (!url.pathname.startsWith('/api/')) return false;
    if (url.pathname.includes('..') || url.pathname.includes('\\')) return false;
    return true;
  } catch {
    return false;
  }
}

function settleHttp(requestId: string, result: NativeHttpResult): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) return; // stale callback after timeout/cancel/generation change
  if (pending.timer !== null) clearTimeout(pending.timer);
  pendingRequests.delete(requestId);
  pending.resolve(result);
}

/** Native entry point. responseJson is a JSON string, never a Response object. */
export function deliverHttpResult(requestId: string, responseJson: string): void {
  let parsed: Partial<NativeHttpResult> = {};
  try {
    const value: unknown = JSON.parse(responseJson);
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Partial<NativeHttpResult>;
  } catch { /* malformed bridge payload */ }
  const status = typeof parsed.status === 'number' && Number.isFinite(parsed.status) ? Math.trunc(parsed.status) : 0;
  settleHttp(requestId, {
    status,
    body: typeof parsed.body === 'string' ? parsed.body : '',
    ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
  });
}

export function cancelNativeRequest(requestId: string): void {
  const n = bridge();
  if (n && typeof n.cancelRequest === 'function') {
    try { n.cancelRequest(requestId); } catch { /* settle locally regardless */ }
  }
  settleHttp(requestId, { status: 0, body: '', error: 'cancelled' });
}

export function cancelAllNativeRequests(): void {
  for (const requestId of Array.from(pendingRequests.keys())) cancelNativeRequest(requestId);
}

/** Start one native HTTP request. `timeoutMs` is also enforced in JS. */
export function nativeHttpRequest(options: NativeHttpRequest): NativeRequestHandle {
  httpSeq += 1;
  const requestId = `http-${Date.now()}-${httpSeq}`;
  if (!hasNativeHttp() || !isAllowedApiUrl(options.url)) {
    return {
      requestId,
      promise: Promise.resolve({ status: 0, body: '', error: hasNativeHttp() ? 'invalid-api-url' : 'transport-unavailable' }),
      cancel: () => {},
    };
  }
  const payload = JSON.stringify({
    url: options.url,
    method: options.method,
    headers: options.headers,
    ...(typeof options.body === 'string' ? { body: options.body } : {}),
    ...(typeof options.timeoutMs === 'number' ? { timeoutMs: options.timeoutMs } : {}),
  });
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
  const promise = new Promise<NativeHttpResult>((resolve) => {
    const timer = setTimeout(() => {
      const n = bridge();
      if (n?.cancelRequest) { try { n.cancelRequest(requestId); } catch { /* ignore */ } }
      settleHttp(requestId, { status: 0, body: '', error: 'timeout' });
    }, timeoutMs + 2_000);
    pendingRequests.set(requestId, { resolve, timer });
    const n = bridge();
    try {
      n?.request?.(requestId, payload);
    } catch {
      settleHttp(requestId, { status: 0, body: '', error: 'transport-error' });
    }
  });
  return { requestId, promise, cancel: () => cancelNativeRequest(requestId) };
}

// ---------------------------------------------------------------------------
// Explicit update download / progress / cancel / installer handoff
// ---------------------------------------------------------------------------

type UpdateListener = (requestId: string, event: NativeUpdateEvent) => void;
const updateListeners = new Set<UpdateListener>();
let updateSeq = 0;
let activeUpdateRequestId = '';

export function onUpdateEvent(listener: UpdateListener): () => void {
  updateListeners.add(listener);
  return () => { updateListeners.delete(listener); };
}

export function deliverUpdateEvent(requestId: string, eventJson: string): void {
  let parsed: Partial<NativeUpdateEvent> = {};
  try {
    const value: unknown = JSON.parse(eventJson);
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Partial<NativeUpdateEvent>;
  } catch {
    parsed = { state: 'error', message: '更新状态无法识别' };
  }
  const state = parsed.state;
  if (state !== 'downloading' && state !== 'ready' && state !== 'error' && state !== 'cancelled' && state !== 'permission-required') return;
  const event: NativeUpdateEvent = { state };
  if (typeof parsed.received === 'number' && Number.isFinite(parsed.received)) event.received = Math.max(0, parsed.received);
  if (typeof parsed.total === 'number' && Number.isFinite(parsed.total)) event.total = Math.max(0, parsed.total);
  if (typeof parsed.message === 'string') event.message = parsed.message;
  if (state !== 'downloading' && requestId === activeUpdateRequestId) activeUpdateRequestId = '';
  for (const listener of Array.from(updateListeners)) {
    try { listener(requestId, event); } catch { /* isolate listeners */ }
  }
}

/** Explicit user action only; never starts an install. */
export function startUpdateDownload(options: NativeUpdateOptions): string | null {
  const n = bridge();
  if (!hasNativeUpdater() || !isAllowedApiUrl(options.url)) return null;
  if (activeUpdateRequestId) cancelUpdate();
  updateSeq += 1;
  const requestId = `update-${Date.now()}-${updateSeq}`;
  activeUpdateRequestId = requestId;
  const payload = JSON.stringify({
    url: options.url,
    token: options.token,
    sha256: options.sha256,
    versionCode: options.versionCode,
    packageName: options.packageName,
  });
  try {
    n?.downloadUpdate?.(requestId, payload);
  } catch {
    activeUpdateRequestId = '';
    deliverUpdateEvent(requestId, JSON.stringify({ state: 'error', message: '无法开始下载' }));
  }
  return requestId;
}

export function cancelUpdate(): void {
  const n = bridge();
  if (n?.cancelUpdate) { try { n.cancelUpdate(); } catch { /* report locally regardless */ } }
  if (activeUpdateRequestId) {
    const requestId = activeUpdateRequestId;
    activeUpdateRequestId = '';
    deliverUpdateEvent(requestId, JSON.stringify({ state: 'cancelled', message: '下载已暂停' }));
  }
}

/** Android system installer still requires the user's own confirmation. */
export function installUpdate(): boolean {
  const n = bridge();
  if (!n?.installUpdate) return false;
  try { n.installUpdate(); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Attachment picker: a native Promise callback or a real browser file input
// ---------------------------------------------------------------------------

export type AttachmentKind = 'image' | 'file';
interface PendingAttachmentPick {
  resolve: (result: NativeAttachmentResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}
const pendingAttachmentPicks = new Map<string, PendingAttachmentPick>();
let attachmentSeq = 0;

export function hasNativeAttachmentPicker(): boolean {
  const n = bridge();
  return Boolean(n && typeof n.pickAttachments === 'function');
}

function settleAttachmentPick(requestId: string, result: NativeAttachmentResult): void {
  const pending = pendingAttachmentPicks.get(requestId);
  if (!pending) return;
  if (pending.timer !== null) clearTimeout(pending.timer);
  pendingAttachmentPicks.delete(requestId);
  pending.resolve(result);
}

/** Native entry point. resultJson is a JSON string with dataUrl items. */
export function deliverAttachmentsResult(requestId: string, resultJson: string): void {
  let parsed: Partial<NativeAttachmentResult> = {};
  try {
    const value: unknown = JSON.parse(resultJson);
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Partial<NativeAttachmentResult>;
  } catch { /* malformed bridge payload */ }
  const status = parsed.status === 'cancelled' || parsed.status === 'error' ? parsed.status : 'success';
  const items = Array.isArray(parsed.items)
    ? parsed.items.filter((item): item is NativeAttachmentItem => Boolean(
      item && typeof item === 'object' && typeof item.name === 'string' &&
      typeof item.mimeType === 'string' && typeof item.dataUrl === 'string',
    )).map((item) => ({
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: Number(item.sizeBytes) || 0,
      dataUrl: item.dataUrl,
    }))
    : [];
  settleAttachmentPick(requestId, {
    status,
    items,
    ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

/** Browser fallback: a genuine OS file input, not a fabricated picker result. */
function browserPick(kind: AttachmentKind): Promise<NativeAttachmentResult> {
  if (typeof document === 'undefined') {
    return Promise.resolve({ status: 'error', items: [], error: 'picker-unavailable' });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = kind === 'image' ? 'image/jpeg,image/png,image/webp' : '';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const finish = (result: NativeAttachmentResult): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      if (!files.length) { finish({ status: 'cancelled', items: [] }); return; }
      Promise.all(files.map(async (file) => ({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        dataUrl: await readFileAsDataUrl(file),
      }))).then(
        (items) => finish({ status: 'success', items }),
        () => finish({ status: 'error', items: [], error: 'read-failed' }),
      );
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function pickAttachments(kind: AttachmentKind, timeoutMs = 180_000): Promise<NativeAttachmentResult> {
  const n = bridge();
  if (!n || typeof n.pickAttachments !== 'function') return browserPick(kind);
  attachmentSeq += 1;
  const requestId = `attach-${Date.now()}-${attachmentSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAttachmentPicks.delete(requestId);
      resolve({ status: 'error', items: [], error: 'picker-timeout' });
    }, timeoutMs);
    pendingAttachmentPicks.set(requestId, { resolve, timer });
    try {
      n.pickAttachments?.(requestId, kind);
    } catch {
      settleAttachmentPick(requestId, { status: 'error', items: [], error: 'picker-error' });
    }
  });
}

// ---------------------------------------------------------------------------
// Hardware back key
// ---------------------------------------------------------------------------

let backHandler: (() => boolean) | null = null;

export function registerBackHandler(handler: (() => boolean) | null): void {
  backHandler = handler;
}

export function handleNativeBack(): boolean {
  if (!backHandler) return false;
  try { return Boolean(backHandler()); } catch { return false; }
}

/** Java callbacks are idempotent and may be installed before/after injection. */
export function installNativeBridgeCallbacks(): void {
  const target = host() as Window & typeof globalThis;
  if (typeof target === 'undefined') return;
  (target as Window).__turnloomNativeQrResult = (requestId, value) => deliverQrResult(requestId, value);
  (target as Window).__turnloomNativeQrError = (requestId, code, message) => deliverQrError(requestId, code, message);
  (target as Window).__turnloomNativeAttachmentsResult = (requestId, resultJson) => deliverAttachmentsResult(requestId, resultJson);
  (target as Window).__turnloomNativeHttpResult = (requestId, responseJson) => deliverHttpResult(requestId, responseJson);
  (target as Window).__turnloomNativeUpdateEvent = (requestId, eventJson) => deliverUpdateEvent(requestId, eventJson);
  (target as Window).__turnloomBack = () => handleNativeBack();
}

installNativeBridgeCallbacks();

export const nativeBridge = {
  secureGet, secureSet, secureRemove, haptic, scanQr: requestQrScan,
  getAppInfo, setLightBars, getAppInfoObject,
  isNativeBridgeAvailable, isMemoryFallbackUsed,
  hasNativeCamera, hasNativeHttp, hasNativeUpdater,
  onQrResult, deliverQrResult, deliverQrError, requestQrScan,
  isAllowedApiUrl, nativeHttpRequest, cancelNativeRequest, cancelAllNativeRequests, deliverHttpResult,
  onUpdateEvent, deliverUpdateEvent, startUpdateDownload, cancelUpdate, installUpdate,
  registerBackHandler, handleNativeBack, installNativeBridgeCallbacks,
  hasNativeAttachmentPicker, deliverAttachmentsResult, pickAttachments,
};

export default nativeBridge;
