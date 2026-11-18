/**
 * Shrink a picked photo before it becomes an upload.
 *
 * Phone cameras produce 4000–8000 px photos; the host rejects anything above
 * 4096 px per side or 12 MP, and a base64 copy of a 5 MB photo is what made
 * the send time out over a relay. Resizing to 2048 px on the long edge keeps
 * the photo readable for the model and turns the upload into a few hundred KB.
 *
 * The geometry is pure so tests can pin it; the canvas part is a thin adapter
 * and always falls back to the untouched attachment.
 */

import type { SendAttachment } from './chatContract';
import { plainBase64 } from './chatContract';

export const UPLOAD_MAX_EDGE = 2048;
export const UPLOAD_JPEG_QUALITY = 0.85;
/** Already inside the edge budget and small enough: re-encoding only loses quality. */
export const UPLOAD_SKIP_BYTES = 900 * 1024;

export interface FittedSize {
  width: number;
  height: number;
  /** True when the source had to shrink. */
  scaled: boolean;
}

/** Longest edge becomes `maxEdge`; never upscale and never round to zero. */
export function fitWithin(width: number, height: number, maxEdge: number = UPLOAD_MAX_EDGE): FittedSize {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const edge = Math.max(16, Math.round(Number(maxEdge) || UPLOAD_MAX_EDGE));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { width: w, height: h, scaled: false };
  const longest = Math.max(w, h);
  if (longest <= edge) return { width: w, height: h, scaled: false };
  const ratio = edge / longest;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}

/** A local preview URL, then the already-read base64, in that order. */
export function imageSourceUrl(attachment: Pick<SendAttachment, 'dataUrl' | 'data' | 'mimeType'>): string {
  if (attachment.dataUrl) return attachment.dataUrl;
  const data = plainBase64(attachment.data);
  return data ? `data:${attachment.mimeType || 'image/jpeg'};base64,${data}` : '';
}

export function jpegName(name: string): string {
  const value = String(name || 'image').trim() || 'image';
  return /\.(?:jpe?g)$/i.test(value) ? value : value.replace(/\.[a-z0-9]{1,8}$/i, '') + '.jpg';
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-decode-failed'));
    image.src = source;
  });
}

/**
 * Downscale one image attachment to the upload budget.
 *
 * Returns the original attachment whenever the environment cannot decode or
 * encode (Node tests, an old WebView, an exotic image) — the send path then
 * behaves exactly as before instead of losing the user's file.
 */
export async function compressImageForUpload(
  attachment: SendAttachment,
  options: { maxEdge?: number; quality?: number; skipBytes?: number } = {},
): Promise<SendAttachment> {
  if (attachment.kind !== 'image') return attachment;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return attachment;
  const source = imageSourceUrl(attachment);
  if (!source) return attachment;
  const maxEdge = options.maxEdge ?? UPLOAD_MAX_EDGE;
  const quality = options.quality ?? UPLOAD_JPEG_QUALITY;
  const skipBytes = options.skipBytes ?? UPLOAD_SKIP_BYTES;
  let image: HTMLImageElement;
  try {
    image = await loadImage(source);
  } catch {
    return attachment;
  }
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const target = fitWithin(width, height, maxEdge);
  const smallEnough = Number(attachment.sizeBytes) > 0 && Number(attachment.sizeBytes) <= skipBytes;
  // A JPEG already inside both budgets is left alone; a PNG inside them still
  // gets re-encoded because PNG screenshots are the biggest uploads we see.
  if (!target.scaled && smallEnough && /^image\/jpe?g$/i.test(attachment.mimeType)) return attachment;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) return attachment;
    context.drawImage(image, 0, 0, target.width, target.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const data = plainBase64(dataUrl);
    if (!data) return attachment;
    return {
      ...attachment,
      name: jpegName(attachment.name),
      mimeType: 'image/jpeg',
      sizeBytes: Math.floor(data.length * 3 / 4),
      data,
      dataUrl: imageSourceUrl(attachment),
    };
  } catch {
    return attachment;
  }
}

/** Compress every image in the tray; non-images pass through untouched. */
export async function compressAttachmentsForUpload(
  attachments: SendAttachment[],
  options: { maxEdge?: number; quality?: number } = {},
): Promise<SendAttachment[]> {
  const output: SendAttachment[] = [];
  for (const attachment of attachments) {
    output.push(attachment.kind === 'image' ? await compressImageForUpload(attachment, options) : attachment);
  }
  return output;
}
