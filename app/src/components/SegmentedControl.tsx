/**
 * iOS segmented control (2.2.6): a grey rail with a white thumb that slides
 * between equal-width options.
 *
 * Why not the previous pill strip: the human reads "按时间 / 按项目" as one
 * two-state switch, not as two independent tags. The thumb carries the state
 * (220ms transform), the labels only fade (160ms), and the whole control keeps
 * a 44px tap band while drawing a 36px rail — the App Store shape.
 *
 * `tl-filter-chip` / `is-active` stay on the buttons as QA hooks: the existing
 * screenshot and pinned-group scripts select them, and renaming a hook is not
 * worth a broken evidence run.
 */
import type { CSSProperties, KeyboardEvent } from 'react';
import { haptic } from '../lib/nativeBridge';

export interface SegmentedOption<T extends string> {
  key: T;
  label: string;
}

export default function SegmentedControl<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label?: string;
}) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.key === value));

  const move = (event: KeyboardEvent<HTMLButtonElement>, delta: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = (activeIndex + delta + options.length) % options.length;
    const buttons = (event.currentTarget.parentElement as HTMLElement | null)?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    haptic('selection');
    onChange(options[next].key);
    buttons?.[next]?.focus();
  };

  const vars = {
    '--tl-seg-index': activeIndex,
    '--tl-seg-count': options.length,
  } as CSSProperties;

  return (
    <div className="tl-segmented" role="tablist" aria-label={label} style={vars}>
      <span className="tl-segmented-thumb" aria-hidden="true" />
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`tl-segmented-item tl-filter-chip${active ? ' is-active' : ''}`}
            onClick={() => { haptic('selection'); onChange(option.key); }}
            onKeyDown={(event) => move(event, event.key === 'ArrowRight' ? 1 : -1)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
