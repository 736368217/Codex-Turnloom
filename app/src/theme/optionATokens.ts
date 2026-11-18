/**
 * Option A / Cupertino Daylight Glass visual tokens.
 * SINGLE_APP_CONTRACT.md section 4 is the single source of truth.
 * Values here are literal strings so they can also be inlined as inline
 * styles when Tailwind arbitrary values are not appropriate.
 */

export const COLORS = {
  canvas: '#F2F2F7',
  surface: '#FFFFFF',
  fillSecondary: '#EFEFF4',
  separator: '#E5E5EA',
  labelPrimary: '#1C1C1E',
  labelSecondary: '#636366',
  blue: '#007AFF',
  green: '#34C759',
  red: '#FF3B30',
  actionBlue: '#0062CC',
  actionGreen: '#1F7A35',
  actionRed: '#B4231B',
  diffAddBg: '#E8F8EE',
  diffAddFg: '#1E7E34',
  diffDelBg: '#FDECEC',
  diffDelFg: '#C82333',
  sheetHandle: '#C7C7CC',
} as const;

export const GLASS = {
  nav: 'rgba(255,255,255,.82)',
  navBackdrop: 'blur(20px) saturate(180%)',
  thumb: 'rgba(255,255,255,.85)',
  thumbBackdrop: 'blur(24px) saturate(180%)',
  sheet: 'rgba(255,255,255,.95)',
  sheetBackdrop: 'blur(40px) saturate(180%)',
} as const;

export const RADIUS = {
  card: 16,
  sheet: 24,
} as const;

export const CARD_SHADOW = '0 1px 3px rgba(0,0,0,.04)';

export const SHEET_HANDLE = {
  width: 36,
  height: 6,
} as const;

export const PRESS = {
  scale: 0.98,
  opacity: 0.8,
  durationMs: 150,
} as const;

/** Minimum tappable hit area (contract section 7.6). */
export const MIN_TAP_SIZE = 44;

/** Light mode is hard-locked; there is no dark variant anywhere in the app. */
export const THEME_LOCK = 'light' as const;

/** App identity displayed by normal screens; internal build labels are omitted. */
export const APP_IDENTITY = {
  label: 'Codex-Turnloom',
  applicationId: 'com.codex.turnloom.app',
  namespace: 'com.codex.turnloom.app',
  versionName: '2.1.2',
  versionCode: 83,
  entry: 'file:///android_asset/public/index.html',
} as const;

export const OPTION_A_TOKENS = {
  colors: COLORS,
  glass: GLASS,
  radius: RADIUS,
  cardShadow: CARD_SHADOW,
  sheetHandle: SHEET_HANDLE,
  press: PRESS,
  minTapSize: MIN_TAP_SIZE,
  themeLock: THEME_LOCK,
  identity: APP_IDENTITY,
} as const;

export default OPTION_A_TOKENS;
