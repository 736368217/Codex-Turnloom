/**
 * Option A · Cupertino Daylight Glass — single source of truth for light-only tokens.
 * Mirrors docs/option-a/AGENTS.md §2.1. There is deliberately NO dark palette:
 * app.json pins `userInterfaceStyle: "light"` and every screen uses these values.
 */
export const OptionA = {
  canvas: '#F2F2F7',
  card: '#FFFFFF',
  fill: '#EFEFF4',
  separator: '#E5E5EA',
  drag: '#C7C7CC',
  ink: '#1C1C1E',
  inkSoft: '#8E8E93',
  blue: '#007AFF',
  green: '#34C759',
  red: '#FF3B30',
  greenInk: '#248A3D',
  redInk: '#D70015',
  diffAdd: '#E8F8EE',
  diffAddInk: '#1E7E34',
  diffDel: '#FDECEC',
  diffDelInk: '#C82333',
  glass: 'rgba(255,255,255,0.82)',
} as const;

export type OptionAColor = (typeof OptionA)[keyof typeof OptionA];

/** NativeWind class fragments reused by screens and primitives. */
export const A = {
  screen: 'flex-1 bg-[#F2F2F7]',
  card: 'bg-white rounded-2xl border border-[#E5E5EA]/70',
  fill: 'bg-[#EFEFF4] rounded-2xl border border-[#E5E5EA]',
  separator: 'border-[#E5E5EA]',
  ink: 'text-[#1C1C1E]',
  soft: 'text-[#8E8E93]',
  press: 'active:opacity-80 active:scale-[0.98]',
  dragHandle: 'h-1.5 w-9 rounded-full bg-[#C7C7CC]',
} as const;

/** BlurView constants from the constitution (§2.1 / track B spec). */
export const GLASS_TINT = 'systemChromeMaterialLight' as const;
export const GLASS_INTENSITY = 85;
export const THUMB_GLASS_INTENSITY = 90;
