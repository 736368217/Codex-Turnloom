/**
 * Copy text from the WebView. Android's WebView has no reliable
 * `navigator.clipboard` (and it needs a secure context), so fall back to the
 * selection-based command, which works inside a user gesture.
 */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
