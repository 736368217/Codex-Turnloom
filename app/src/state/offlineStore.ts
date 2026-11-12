/** Online/offline badge state, sourced from real native HTTP results only. */
import { createStore, useStore } from './store';

export interface OfflineState {
  booted: boolean;
  offlineBadgeVisible: boolean;
  lastNetworkOkAt: number | null;
  lastNetworkFailAt: number | null;
  consecutiveFailures: number;
}

export const offlineStore = createStore<OfflineState>({
  booted: false,
  offlineBadgeVisible: true,
  lastNetworkOkAt: null,
  lastNetworkFailAt: null,
  consecutiveFailures: 0,
});

export function reportNetworkResult(ok: boolean): void {
  const now = Date.now();
  offlineStore.setState((prev) => ({
    booted: true,
    offlineBadgeVisible: !ok,
    lastNetworkOkAt: ok ? now : prev.lastNetworkOkAt,
    lastNetworkFailAt: ok ? prev.lastNetworkFailAt : now,
    consecutiveFailures: ok ? 0 : prev.consecutiveFailures + 1,
  }));
}

export function markBooted(): void {
  offlineStore.setState({ booted: true });
}

export function useOfflineState(): OfflineState { return useStore(offlineStore); }
export default offlineStore;

/** Global, non-secret defaults for the connection screen. */
export const APP_SETUP_DEFAULTS = {
  serverUrl: '',
  machineAccessCode: '',
  machineLabel: '',
} as const;
