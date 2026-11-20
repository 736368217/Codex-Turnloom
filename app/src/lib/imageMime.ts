/**
 * Pure MIME evidence for an image whose bytes arrive without a content type.
 * No default: a JPEG labelled `image/png` breaks in some WebViews, and this
 * project would rather show "图片 N 张" than a broken picture.
 */

export function imageMimeFromBytes(base64: string): string {
  const head = String(base64 || '').replace(/^\s+/, '');
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  return '';
}

export function imageMimeFromName(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  switch ((match?.[1] || '').toLowerCase()) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return '';
  }
}

/** Bytes first (they cannot lie), then the server's field, then the file name. */
export function resolveImageMime(input: { bodyBase64?: string; mimeType?: string; name?: string }): string {
  const declared = String(input.mimeType || '').toLowerCase();
  return imageMimeFromBytes(String(input.bodyBase64 || ''))
    || (/^image\/[a-z0-9.+-]+$/.test(declared) ? declared : '')
    || imageMimeFromName(String(input.name || ''));
}
