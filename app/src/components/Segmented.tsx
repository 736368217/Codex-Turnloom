import type { ReactNode } from 'react';
import { Segmented, SegmentedButton } from 'konsta/react';
import { COLORS } from '../theme/optionATokens';
import { haptic } from '../lib/nativeBridge';
import type { TabState } from '../state/tabStore';

/** Generic Konsta Segmented wrapper for thread status filters. */
export function FilterSegmented<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Segmented strong rounded className="!bg-[#EFEFF4]" style={{ width: '100%' }}>
      {options.map((option) => (
        <SegmentedButton
          key={option.key}
          strong rounded
          active={value === option.key}
          className="tl-press"
          style={{ minHeight: 44, color: value === option.key ? COLORS.blue : COLORS.labelSecondary, fontWeight: 600, fontSize: 13 }}
          onClick={() => { haptic('selection'); onChange(option.key); }}
        >
          {option.label}
        </SegmentedButton>
      ))}
    </Segmented>
  );
}

/** Small inset-group wrapper used by screens, with a section label. */
export function InsetGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={{ margin: '0 16px 12px' }}>
      {title && <div className="tl-section-title" style={{ padding: '6px 4px 8px' }}>{title}</div>}
      <div className="tl-card" style={{ background: COLORS.surface, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

export type ThreadFilter = TabState['threadsFilter'];
