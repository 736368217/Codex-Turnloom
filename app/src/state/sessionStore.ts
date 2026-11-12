/**
 * Verified machine connection state.
 *
 * A persisted session is only a candidate on cold start: nothing is marked
 * verified until machine discovery and the selected harness health check both
 * succeed. Each harness has its own token/request scope; caches and late
 * responses from the previous harness can never become the new harness's data.
 */

import { createStore, useStore } from './store';
import { secureGet, secureSet, secureRemove } from '../lib/nativeBridge';
import { tabStore, closeDetail } from './tabStore';
import { closeSheet } from './sheetStore';
import { APP_IDENTITY } from '../theme/optionATokens';
import {
  normalizeBaseUrl, normalizeDiscovery, connectionErrorMessage,
  type Harness, type MachinePairing,
} from '../lib/machinePairing';
import {
  discoverHarnesses, verifyHarness, setActiveRequestScope, getActiveGeneration,
  getActiveScope, type RequestContext,
} from '../lib/turnloomApi';

const STORAGE_KEY = 'turnloom.machine.v2';
const CACHE_PREFIX = 'turnloom.cache.v2.';

export type ConnectionStatus = 'unpaired' | 'checking' | 'connecting' | 'ready' | 'error' | 'reconnecting';

export interface PersistedMachine {
  machineId: string;
  machineName: string;
  serverUrl: string;
  machineToken: string;
  harnesses: Harness[];
  defaultHarnessId: string;
}

export interface SessionState {
  status: ConnectionStatus;
  machineId: string;
  machineName: string;
  serverUrl: string;
  machineToken: string;
  harnesses: Harness[];
  harnessId: string;
  harnessName: string;
  harnessToken: string;
  scope: string;
  generation: number;
  online: boolean;
  error: string;
  appVersion: string;
  appVersionCode: number;
  packageName: string;
  cameraAvailable: boolean;
  updatesAvailable: boolean;
  lastSyncAt: number | null;
  offlineCacheEnabled: boolean;
  revalidatedAt: number | null;
}

export const sessionStore = createStore<SessionState>({
  status: 'unpaired',
  machineId: '', machineName: '', serverUrl: '', machineToken: '',
  harnesses: [], harnessId: '', harnessName: '', harnessToken: '',
  scope: '', generation: 0, online: false, error: '',
  appVersion: APP_IDENTITY.versionName, appVersionCode: APP_IDENTITY.versionCode,
  packageName: APP_IDENTITY.applicationId,
  cameraAvailable: false, updatesAvailable: false,
  lastSyncAt: null, offlineCacheEnabled: true, revalidatedAt: null,
});

/** Monotonic id: a connection attempt interrupted by a newer one is ignored. */
let transitionSeq = 0;

function readPersisted(): PersistedMachine | null {
  try {
    const raw = secureGet(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedMachine>;
    const serverUrl = normalizeBaseUrl(String(value.serverUrl || ''));
    const machineToken = typeof value.machineToken === 'string' ? value.machineToken.trim() : '';
    if (!serverUrl || !machineToken || !Array.isArray(value.harnesses) || value.harnesses.length === 0) return null;
    const harnesses = value.harnesses.filter((item): item is Harness =>
      Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.token === 'string'));
    if (harnesses.length === 0) return null;
    const defaultHarnessId = harnesses.some((h) => h.id === value.defaultHarnessId)
      ? String(value.defaultHarnessId) : harnesses[0].id;
    return {
      machineId: String(value.machineId || ''),
      machineName: String(value.machineName || '我的机器'),
      serverUrl, machineToken, harnesses, defaultHarnessId,
    };
  } catch {
    return null;
  }
}

function persist(machine: PersistedMachine): void {
  try { secureSet(STORAGE_KEY, JSON.stringify(machine)); } catch { /* secure storage is best effort */ }
}
function authorizeNativeOrigin(serverUrl: string): void {
  try { secureSet('turnloom.serverUrl', serverUrl); } catch { /* browser fallback and native bridge both fail closed */ }
}

export function scopeFor(machineId: string, harnessId: string): string {
  return `${machineId}::${harnessId}`;
}

export function cacheKeyFor(scope: string, kind: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(scope)}.${kind}`;
}

export function selectedHarness(state: SessionState = sessionStore.getState()): Harness | null {
  return state.harnesses.find((item) => item.id === state.harnessId) || null;
}

function harnessPatch(harness: Harness | null, scope: string, generation: number): Partial<SessionState> {
  return {
    harnessId: harness?.id || '', harnessName: harness?.name || '',
    harnessToken: harness?.token || '', scope, generation,
  };
}

export function currentRequestContext(): RequestContext | null {
  const state = sessionStore.getState();
  if (state.status !== 'ready' || !state.serverUrl || !state.harnessToken || !state.scope) return null;
  return {
    target: { origin: state.serverUrl, token: state.harnessToken },
    scope: state.scope, generation: state.generation,
  };
}

export function useSessionState(): SessionState { return useStore(sessionStore); }

export function setNativeCapabilities(info: {
  version?: string; versionCode?: number; packageName?: string;
  cameraAvailable?: boolean; updatesAvailable?: boolean;
}): void {
  sessionStore.setState({
    ...(typeof info.version === 'string' && info.version ? { appVersion: info.version } : {}),
    ...(typeof info.versionCode === 'number' && info.versionCode > 0 ? { appVersionCode: info.versionCode } : {}),
    ...(typeof info.packageName === 'string' && info.packageName ? { packageName: info.packageName } : {}),
    cameraAvailable: info.cameraAvailable === true,
    updatesAvailable: info.updatesAvailable === true,
  });
}

export function setOnline(online: boolean): void { sessionStore.setState({ online }); }
export function setOfflineCacheEnabled(enabled: boolean): void {
  try { secureSet('turnloom.offlineCache.v2', enabled ? 'true' : 'false'); } catch { /* best effort */ }
  sessionStore.setState({ offlineCacheEnabled: enabled });
  if (!enabled) {
    const state = sessionStore.getState();
    for (const h of state.harnesses) secureRemove(cacheKeyFor(scopeFor(state.machineId, h.id), 'threads'));
  }
}
export function markSynced(): void { sessionStore.setState({ lastSyncAt: Date.now() }); }
export function setConnectionError(message: string, status: ConnectionStatus = 'error'): void {
  sessionStore.setState({ status, online: false, error: message });
}

/** Hydrate a persisted candidate, but leave the app locked until verified. */
export function hydrateSession(): PersistedMachine | null {
  transitionSeq += 1;
  const machine = readPersisted();
  const cacheEnabled = secureGet('turnloom.offlineCache.v2') !== 'false';
  if (!machine) {
    setActiveRequestScope('unpaired');
    sessionStore.setState({
      status: 'unpaired', offlineCacheEnabled: cacheEnabled,
      ...harnessPatch(null, 'unpaired', getActiveGeneration()),
    });
    return null;
  }
  setActiveRequestScope('revalidate');
  sessionStore.setState({
    status: 'checking',
    machineId: machine.machineId, machineName: machine.machineName,
    serverUrl: machine.serverUrl, machineToken: machine.machineToken,
    harnesses: machine.harnesses,
    ...harnessPatch(null, 'revalidate', getActiveGeneration()),
    online: false, error: '', offlineCacheEnabled: cacheEnabled,
  });
  return machine;
}

function manualPairingFor(machine: PersistedMachine): MachinePairing {
  return {
    protocol: 'codex-turnloom', version: 2, source: 'manual',
    machineId: '', machineName: machine.machineName,
    serverUrl: machine.serverUrl, machineToken: machine.machineToken,
    discoverPath: '/api/harnesses',
  };
}

/** Revalidate the machine + default harness on every cold/foreground start. */
export async function revalidatePersisted(machine: PersistedMachine): Promise<boolean> {
  const attempt = ++transitionSeq;
  setActiveRequestScope('revalidate');
  sessionStore.setState({ status: 'checking', error: '', online: false });
  authorizeNativeOrigin(machine.serverUrl);
  const discovered = await discoverHarnesses(
    { serverUrl: machine.serverUrl, machineToken: machine.machineToken }, 'revalidate',
  );
  if (attempt !== transitionSeq) return false;
  if (!discovered.ok) {
    setConnectionError(connectionErrorMessage(discovered.status, discovered.error));
    return false;
  }
  const normalized = normalizeDiscovery(discovered.data, manualPairingFor(machine));
  if (!normalized.ok) { setConnectionError(normalized.error); return false; }
  // Discovery tokens are authoritative; never reuse an obsolete persisted token.
  const updated: PersistedMachine = {
    ...normalized.machine,
    serverUrl: machine.serverUrl,
    machineToken: machine.machineToken,
  };
  const selected = updated.harnesses.find((item) => item.id === machine.defaultHarnessId) ||
    updated.harnesses.find((item) => item.id === updated.defaultHarnessId) || updated.harnesses[0];
  updated.defaultHarnessId = selected.id;
  return activateMachine(updated, selected.id, true, attempt);
}

/** Pair from a canonical QR or manual URL+code; persist only after verification. */
export async function connectWithPairing(pairing: MachinePairing): Promise<boolean> {
  const attempt = ++transitionSeq;
  const discoveryScope = `pairing-${attempt}-${Date.now()}`;
  setActiveRequestScope(discoveryScope);
  sessionStore.setState({ status: 'connecting', error: '', online: false });
  authorizeNativeOrigin(pairing.serverUrl);
  const discovered = await discoverHarnesses(
    { serverUrl: pairing.serverUrl, machineToken: pairing.machineToken }, discoveryScope,
  );
  if (attempt !== transitionSeq) return false;
  if (!discovered.ok) {
    setConnectionError(connectionErrorMessage(discovered.status, discovered.error));
    return false;
  }
  const normalized = normalizeDiscovery(discovered.data, pairing);
  if (!normalized.ok) { setConnectionError(normalized.error); return false; }
  const machine: PersistedMachine = {
    ...normalized.machine,
    serverUrl: pairing.serverUrl,
    machineToken: pairing.machineToken,
  };
  return activateMachine(machine, machine.defaultHarnessId, false, attempt);
}

async function activateMachine(
  machine: PersistedMachine,
  harnessId: string,
  revalidated: boolean,
  attempt: number,
): Promise<boolean> {
  const harness = machine.harnesses.find((item) => item.id === harnessId) || machine.harnesses[0];
  if (!harness) {
    if (attempt === transitionSeq) setConnectionError('这台机器没有可用服务，请检查桌面端配置');
    return false;
  }
  const scope = scopeFor(machine.machineId, harness.id);
  const health = await verifyHarness({ origin: machine.serverUrl, token: harness.token }, scope);
  const expectedScope = getActiveScope();
  const expectedGeneration = getActiveGeneration();
  if (attempt !== transitionSeq || expectedScope !== scope) return false;
  if (!health.ok) {
    setConnectionError(connectionErrorMessage(health.status, health.error));
    return false;
  }
  if (sessionStore.getState().scope !== scope) {
    closeDetail();
    closeSheet();
    tabStore.setState({ threadsQuery: '', threadsFilter: 'all' });
  }
  persist({ ...machine, defaultHarnessId: harness.id });
  sessionStore.setState({
    status: 'ready',
    machineId: machine.machineId, machineName: machine.machineName,
    serverUrl: machine.serverUrl, machineToken: machine.machineToken,
    harnesses: machine.harnesses,
    ...harnessPatch(harness, expectedScope, expectedGeneration),
    online: true, error: '',
    ...(revalidated ? { revalidatedAt: Date.now() } : {}),
  });
  return true;
}

/** Switch between discovered Codex/Pi harnesses and isolate all request state. */
export async function switchHarness(harnessId: string): Promise<boolean> {
  const state = sessionStore.getState();
  if (state.status !== 'ready' && state.status !== 'error' && state.status !== 'reconnecting') return false;
  const harness = state.harnesses.find((item) => item.id === harnessId);
  if (!harness) return false;
  if (harness.id === state.harnessId && state.status === 'ready') return true;
  const attempt = ++transitionSeq;
  sessionStore.setState({ status: 'reconnecting', error: '', online: false });
  const machine: PersistedMachine = {
    machineId: state.machineId, machineName: state.machineName,
    serverUrl: state.serverUrl, machineToken: state.machineToken,
    harnesses: state.harnesses, defaultHarnessId: harness.id,
  };
  const ok = await activateMachine(machine, harness.id, false, attempt);
  if (!ok && attempt === transitionSeq && sessionStore.getState().status !== 'error') {
    setConnectionError('切换服务未完成，请重试或重新配对');
  }
  return ok;
}

export function unpair(): void {
  transitionSeq += 1;
  const previous = sessionStore.getState();
  for (const h of previous.harnesses) secureRemove(cacheKeyFor(scopeFor(previous.machineId, h.id), 'threads'));
  closeDetail();
  closeSheet();
  secureRemove(STORAGE_KEY);
  secureRemove('turnloom.serverUrl');
  setActiveRequestScope('unpaired');
  sessionStore.setState({
    status: 'unpaired', machineId: '', machineName: '', serverUrl: '', machineToken: '',
    harnesses: [], ...harnessPatch(null, 'unpaired', getActiveGeneration()),
    online: false, error: '', lastSyncAt: null, revalidatedAt: null,
  });
}

export function isVerified(): boolean { return sessionStore.getState().status === 'ready'; }
export function useVerifiedSession(): SessionState { return useSessionState(); }
export const SESSION_STORAGE_KEYS = { machine: STORAGE_KEY, cachePrefix: CACHE_PREFIX } as const;

export default sessionStore;
