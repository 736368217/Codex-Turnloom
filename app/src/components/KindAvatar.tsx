/**
 * Source identity mark (2.4.0): one 20-24px rounded square per platform.
 * The letters come from `lib/platforms` so the list, chat, device cards and
 * settings can never drift apart. Monochrome by design (UI_SPEC single accent).
 */
import { KIND_LABEL, kindMark } from '../lib/platforms';

export default function KindAvatar({
  kind,
  size = 24,
  label,
  className,
}: {
  kind?: string;
  size?: number;
  /** Fallback name used only when the kind has no registered mark. */
  label?: string;
  className?: string;
}) {
  const key = String(kind || '').toLowerCase();
  const mark = kindMark(key) || String(label || '').slice(0, 2).toUpperCase();
  if (!mark) return null;
  const name = KIND_LABEL[key] || label || mark;
  return (
    <span
      className={`tl-kindavatar${className ? ` ${className}` : ''}`}
      data-kind={key || 'other'}
      role="img"
      aria-label={`来源 ${name}`}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: size <= 20 ? 6 : 7,
        fontSize: size <= 20 ? 9 : 10,
      }}
    >
      {mark}
    </span>
  );
}
