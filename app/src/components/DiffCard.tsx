import { useState } from 'react';
import { ChevronDown, ChevronRight, FileDiff } from 'lucide-react';
import { COLORS } from '../theme/optionATokens';
import { cardStyle } from './ui';

export interface DiffLine {
  type: 'add' | 'del' | 'context' | 'meta';
  text: string;
}

/** Parse a unified diff string into light-mode add/del/context lines. */
export function parseDiff(raw: string): DiffLine[] {
  const lines = String(raw || '').split('\n');
  const out: DiffLine[] = [];
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      out.push({ type: 'meta', text: line });
    } else if (line.startsWith('+')) {
      out.push({ type: 'add', text: line });
    } else if (line.startsWith('-')) {
      out.push({ type: 'del', text: line });
    } else {
      out.push({ type: 'context', text: line });
    }
  }
  return out;
}

/** Light diff card (contract section 4 diff tokens), collapsible. */
export default function DiffCard({
  path = 'workspace',
  lines,
  defaultOpen = true,
}: {
  path?: string;
  lines: DiffLine[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const adds = lines.filter((l) => l.type === 'add').length;
  const dels = lines.filter((l) => l.type === 'del').length;

  return (
    <div className="tl-card" style={{ ...cardStyle, margin: '0 16px 12px', overflow: 'hidden' }}>
      <button
        type="button"
        className="tl-press"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          minHeight: 52,
          padding: '8px 14px',
          border: 0,
          background: 'transparent',
          textAlign: 'left',
          color: COLORS.labelPrimary,
        }}
      >
        <FileDiff size={17} color={COLORS.blue} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {path}
        </span>
        <span style={{ fontSize: 11, color: COLORS.diffAddFg }}>+{adds}</span>
        <span style={{ fontSize: 11, color: COLORS.diffDelFg }}>-{dels}</span>
        {open ? <ChevronDown size={16} color={COLORS.labelSecondary} /> : <ChevronRight size={16} color={COLORS.labelSecondary} />}
      </button>
      {open && (
        <div className="tl-selectable" style={{ borderTop: `.5px solid ${COLORS.separator}`, paddingBottom: 6 }}>
          {lines.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 13, color: COLORS.labelSecondary }}>暂无差异内容</div>
          ) : lines.map((line, index) => (
            <div
              key={index}
              className={`tl-diff-line ${line.type === 'add' ? 'tl-diff-add' : line.type === 'del' ? 'tl-diff-del' : ''}`}
              style={line.type === 'meta'
                ? { color: COLORS.labelSecondary, background: COLORS.fillSecondary }
                : line.type === 'context' ? { color: COLORS.labelPrimary } : undefined}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
