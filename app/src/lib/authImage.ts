/**
 * Authenticated image bytes for the Android WebView.
 *
 * The WebView intercepts every remote subresource and answers it empty, and the
 * native HTTP bridge decodes bodies as UTF-8 — so an `<img src="http://…">` can
 * never load a photo. The bridge therefore returns `bodyBase64` for image
 * responses (native side, 2.3.0); this module turns that into a `data:` URL,
 * keeping the access token in the request header and never in a URL.
 *
 * Without the native field the call resolves to '' and the caller renders its
 * honest fallback (a count/name line), never a broken image.
 */

import { nativeHttpRequest, hasNativeHttp } from './nativeBridge';
import { getBaseUrl, getCurrentTarget } from './turnloomApi';
import { resolveImageMime } from './imageMime';

const CACHE_LIMIT = 24;
const CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Chromium silently drops a `data:` URL near 2 MB, which would show as a blank
 * image rather than an error. Beyond this budget we render nothing and the
 * caller keeps its "图片 N 张" fallback (Rhea, 2026-11-20).
 */
export const MAX_INLINE_IMAGE_CHARS = 1_500_000;

interface CacheEntry { dataUrl: string; at: number }
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/** Absolute URL for a paired-machine path, or '' when it cannot be loaded. */
export function absoluteImageUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^data:image\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) {
    const base = getBaseUrl();
    return base ? `${base.replace(/\/+$/, '')}${value}` : '';
  }
  return '';
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(blob);
  });
}

async function browserLoad(url: string): Promise<string> {
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return '';
    const blob = await response.blob();
    return await readAsDataUrl(blob);
  } catch {
    return '';
  }
}

async function load(url: string, mimeType: string, name: string): Promise<string> {
  if (!hasNativeHttp()) return browserLoad(url);
  const token = getCurrentTarget().token;
  const handle = nativeHttpRequest({
    url,
    method: 'GET',
    headers: token ? { 'x-access-token': token } : {},
    timeoutMs: 15_000,
  });
  const result = await handle.promise;
  if (result.status < 200 || result.status >= 300) return '';
  const base64 = String(result.bodyBase64 || '').replace(/\s/g, '');
  if (!base64 || base64.length > MAX_INLINE_IMAGE_CHARS) return '';
  // The envelope carries no content type: the bytes are the best evidence, the
  // server's field is the second, the file name the last. Nothing else is used.
  const mime = resolveImageMime({ bodyBase64: base64, mimeType, name });
  return mime ? `data:${mime};base64,${base64}` : '';
}

export function clearImageCache(): void {
  cache.clear();
  inflight.clear();
}

/** Resolve an image URL to a `data:` URL (cached 5 min, at most 24 entries). */
export async function fetchImageDataUrl(raw: string, mimeType = '', name = ''): Promise<string> {
  const url = absoluteImageUrl(raw);
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.dataUrl;
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = load(url, mimeType, name)
    .then((dataUrl) => {
      if (dataUrl) {
        cache.set(url, { dataUrl, at: Date.now() });
        while (cache.size > CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      }
      return dataUrl;
    })
    .finally(() => { inflight.delete(url); });
  inflight.set(url, task);
  return task;
}

export const authImage = { absoluteImageUrl, fetchImageDataUrl, clearImageCache, resolveImageMime };
export default authImage;
