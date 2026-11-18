/** Explicit public web URLs only; never file/data/intent or credential URLs. */
export function safeExternalUrl(value: string): string | null {
  try {
    if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null;
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
