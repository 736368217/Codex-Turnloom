import type { ThreadSummary } from './turnloomApi';

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/**
 * The list's second line is a sentence the human wrote — never an identifier.
 * A missing preview leaves the line empty; showing a thread id (or a path) there is
 * the bug this exists to prevent. It used to be hidden by the fixture inventing
 * previews, so it only showed up on a real device.
 */
export function previewOfThread(thread: ThreadSummary): string {
  const raw = String(thread.preview || '').trim();
  if (!raw) return '';
  const id = String(thread.id || '').trim();
  if (id && raw === id) return '';
  if (UUID_LIKE.test(raw) || (UUID_PREFIX.test(raw) && raw.length <= 40)) return '';
  if (/^(?:[a-zA-Z]:[\\/]|\/|~[\\/]|\.{1,2}[\\/])/.test(raw)) return '';
  return raw;
}

export function titleOfThread(thread: ThreadSummary): string {
  const explicit = String(thread.title || thread.name || '').trim();
  if (explicit) return explicit;
  const preview = previewOfThread(thread);
  if (preview) return preview;
  return '未命名会话';
}
