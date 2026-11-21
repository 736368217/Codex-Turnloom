/**
 * User-visible preferences (2.4.0): text size, default list view, haptics.
 *
 * These are presentation prefs, not connection state: they never belong to a
 * machine scope and must survive switching computers. Storage is the same
 * secure slot the app already uses for local settings.
 */
import { secureGet, secureSet, setHapticsEnabled } from '../lib/nativeBridge';
import { createStore, useStore } from './store';

export type TextSize = 's' | 'm' | 'l';
export type DefaultView = 'time' | 'project';

export interface PrefsState {
  textSize: TextSize;
  defaultView: DefaultView;
  haptics: boolean;
}

const STORAGE_KEY = 'turnloom.prefs.v1';

function isTextSize(value: unknown): value is TextSize {
  return value === 's' || value === 'm' || value === 'l';
}

function read(): PrefsState {
  const fallback: PrefsState = { textSize: 'm', defaultView: 'time', haptics: true };
  try {
    const raw = secureGet(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PrefsState> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      textSize: isTextSize(parsed.textSize) ? parsed.textSize : fallback.textSize,
      defaultView: parsed.defaultView === 'project' || parsed.defaultView === 'time' ? parsed.defaultView : fallback.defaultView,
      haptics: typeof parsed.haptics === 'boolean' ? parsed.haptics : fallback.haptics,
    };
  } catch {
    return fallback;
  }
}

const initial = read();
export const prefsStore = createStore<PrefsState>(initial);

/** The root attribute is the single switch for the three scaled text roles. */
export function applyTextSize(size: TextSize): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.dataset.textSize = size;
}

function persist(next: PrefsState): void {
  try { secureSet(STORAGE_KEY, JSON.stringify(next)); } catch { /* best effort */ }
}

// Haptics is the one pref the native boundary reads, so apply it on load.
setHapticsEnabled(initial.haptics);
applyTextSize(initial.textSize);

export function setTextSize(textSize: TextSize): void {
  const next = { ...prefsStore.getState(), textSize };
  prefsStore.setState({ textSize });
  applyTextSize(textSize);
  persist(next);
}

export function setDefaultView(defaultView: DefaultView): void {
  const next = { ...prefsStore.getState(), defaultView };
  prefsStore.setState({ defaultView });
  persist(next);
}

export function setHaptics(haptics: boolean): void {
  const next = { ...prefsStore.getState(), haptics };
  prefsStore.setState({ haptics });
  setHapticsEnabled(haptics);
  persist(next);
}

export function usePrefs(): PrefsState { return useStore(prefsStore); }

export const TEXT_SIZE_LABEL: Record<TextSize, string> = { s: '小', m: '标准', l: '大' };
export const DEFAULT_VIEW_LABEL: Record<DefaultView, string> = { time: '按时间', project: '按项目' };
