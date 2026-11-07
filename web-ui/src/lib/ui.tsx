import type { ReactNode } from 'react';

/** Shared press feedback — the visual constitution requires it everywhere. */
export const PRESS =
  'active:scale-[0.98] active:opacity-80 transition-all duration-150 select-none';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function StatusPill({
  label,
  tone = 'blue',
}: {
  label: string;
  tone?: 'blue' | 'green' | 'gray' | 'red' | 'amber';
}): ReactNode {
  const tones: Record<string, string> = {
    blue: 'bg-[#007AFF]/10 text-[#007AFF]',
    green: 'bg-[#34C759]/12 text-[#248A3D]',
    gray: 'bg-[#EFEFF4] text-[#8E8E93]',
    red: 'bg-[#FF3B30]/12 text-[#D70015]',
    amber: 'bg-[#FF9F0A]/12 text-[#B26200]',
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight ${tones[tone]}`}
    >
      {label}
    </span>
  );
}

export function relativeTime(value?: number | string | null): string {
  if (!value) return '';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN');
}

export function truncate(value: string, max = 140): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * iOS HIG: every interactive target must be at least 44×44px. For icon-only
 * buttons the visual circle stays 32–40px, and a transparent ::after overlay
 * expands the hit area without changing the layout (no structural changes).
 */
export const HIT_AREA_44 =
  'relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]';
