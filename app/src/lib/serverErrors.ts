/**
 * Failure text that never hides what the host actually said.
 *
 * The host answers 4xx with a human sentence ("Invalid image: dimensions
 * must be ...", "当前模型不支持图片 ..."). The first client release only let
 * `^[a-z0-9._:-]{1,80}$` through, so every sentence with a space or a Chinese
 * character collapsed into `HTTP-400` — the user could not tell a bad image
 * from a dead network. This module is pure so Node tests can lock the rule.
 */

export interface ApiFailure {
  status: number;
  error: string;
  offline: boolean;
}

/** Strip control characters and bound what a single error line may show. */
export function cleanServerMessage(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  // A server must never echo a credential; drop anything that looks like one.
  if (/(?:access[_-]?token|token|authorization|bearer|password)\s*[:=]/i.test(cleaned)) return '';
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}…` : cleaned;
}

/** Read `error` / `message` from a JSON error body without trusting its shape. */
export function serverMessage(payload: unknown, status: number, transportError?: string): string {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const candidate = cleanServerMessage(body.error) || cleanServerMessage(body.message);
  if (candidate) return candidate;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status === 0) return cleanServerMessage(transportError) || 'OFFLINE';
  return `HTTP-${status}`;
}

/** Stable English host messages we can translate once, in one place. */
function localizedHostMessage(message: string): string {
  const text = message.toLowerCase();
  if (/invalid image: dimensions/.test(text)) {
    return '图片尺寸超出电脑端限制（单边 ≤4096px、且 ≤12MP）。App 已自动压缩；若仍失败请先裁剪后再发。';
  }
  if (/invalid image: image data is too small/.test(text)) return '这张图片已损坏或内容为空，请重新选择。';
  if (/invalid image/.test(text)) return '电脑端无法识别这张图片，请换成 JPEG / PNG / WebP 后重试。';
  if (/unsupported image format/.test(text)) return '图片格式不支持：仅支持 JPEG / PNG / WebP。';
  if (/image is too large/.test(text)) return '单张图片超过电脑端上限（5MB），请压缩后再发。';
  if (/too many images/.test(text)) return '最多发送 4 张图片，请先移除一些。';
  if (/request body too large/.test(text)) return '发送内容超过电脑端上限，请减少图片或附件后再试。';
  if (/thread not found/.test(text)) return '这个会话已不存在，请返回列表刷新后再试。';
  return '';
}

/**
 * One user-facing sentence for a failed API call.
 *
 * Rules: 401 always wins (it changes what the user must do), a timeout is not
 * "offline", and a host sentence is preferred over a bare status code.
 */
export function actionableMessage(result: ApiFailure): string {
  const host = cleanServerMessage(result.error);
  if (result.status === 401) return '连接已失效，请重新配对这台机器。';
  if (result.status === 0) {
    if (/timeout/i.test(host)) return '请求超时，电脑端没有在时限内响应。草稿已保留，请检查网络后重试。';
    if (/tls/i.test(host)) return '与电脑端的安全连接失败（证书或时钟异常）。请检查系统时间后重试。';
    return '连接中断，草稿已保留。请检查网络与桌面端服务后重试。';
  }
  if (result.status === 403) return '电脑端当前不允许写入，请在桌面端开启写入后重试。';
  if (result.status === 404) return '服务或请求已不存在，请刷新后重试。';
  if (result.status === 413) return '发送内容超过电脑端上限，请减少图片或附件后再试。';
  const localized = localizedHostMessage(host);
  if (localized) return localized;
  if (result.status === 400) {
    if (host && !/^HTTP-400$/.test(host)) return host;
    return '电脑端没有接受这次请求（HTTP-400），请检查图片或内容后重试。';
  }
  if (result.status === 409) {
    return host && !/^HTTP-409$/.test(host) ? host : '请求状态已变化，请刷新后重新核对。';
  }
  if (result.status >= 500) {
    return host && !/^HTTP-5/.test(host) ? `电脑端服务出错：${host}` : '电脑端服务出错，请检查桌面端状态后重试。';
  }
  return host && !/^HTTP-\d+$/.test(host) ? host : '请求未成功，请重试。';
}

/** A host sentence that is worth showing verbatim (never a bare status). */
export function isReadableHostMessage(message: string): boolean {
  const text = cleanServerMessage(message);
  return Boolean(text) && !/^(?:HTTP-\d+|unauthorized|forbidden|not-found|rate-limited|OFFLINE)$/i.test(text);
}
