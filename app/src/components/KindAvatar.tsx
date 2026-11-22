/**
 * Source identity mark (2.4.0; light chip 2.4.2).
 *
 * One 20-24px rounded square per platform, shared by the conversation list,
 * the chat header, the device cards and the non-active machine card so the
 * four surfaces can never drift apart.
 *
 * 2.4.2: the dark systemGray5 block with white `CX`/`PI` letters is gone — it
 * read as a foreign object on the Cupertino surface. The mark is now a light
 * chip with a single ink glyph (background luminance 0.841 against ink
 * #1C1C1E is 14.4:1). Codex gets Lucide `Terminal` (a caret and an underscore,
 * a boxed terminal at 20px would be a square inside a square) and PI gets
 * Lucide `Pi`. Unknown platforms keep the two-letter fallback from
 * `lib/platforms`, so a new harness is never an empty block.
 */
import type { ReactElement } from 'react';
import { Pi, Terminal } from 'lucide-react';
import { KIND_LABEL, kindMark } from '../lib/platforms';

const GLYPHS: Record<string, ReactElement> = {
  codex: <Terminal size={14} />,
  pi: <Pi size={14} />,
  pidesk: <Pi size={14} />,
};

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
  const glyph = GLYPHS[key];
  const mark = kindMark(key) || String(label || '').slice(0, 2).toUpperCase();
  if (!glyph && !mark) return null;
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
      {glyph ?? mark}
    </span>
  );
}
