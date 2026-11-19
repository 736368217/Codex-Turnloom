/**
 * Verified machine connection state.
 *
 * A persisted session is only a candidate on cold start: nothing is marked
 * verified until machine discovery and the selected harness health check both
 * succeed. Each harness has its own token/request scope; caches and late
 * responses from the previous harness can never become the new harness's data.
 */

import { createStore, useStore } from './store';
import { secureGet, secureSet, secureRemove, cancelAllNativeRequests } from '../lib/nativeBridge';
import { tabStore, closeDetail } from './tabStore';
import { closeSheet } from './sheetStore';
import { APP_IDENTITY } from '../theme/optionATokens';
import {
  normalizeDiscovery, connectionErrorMessage,
  type Harness, type MachinePairing,
} from '../lib/machinePairing';
import {
  parseRegistry, serializeRegistry, upsertMachine, removeMachine, machineKey,
  activeMachine, machineSummaries,
  type PersistedMachine, type MachineRegistry, type MachineSummary,
} from '../lib/machineRegistry';
import {
  discoverHarnesses, verifyHarness, setActiveRequestScope, getActiveGeneration,
  getActiveScope, type RequestContext,
} from '../lib/turnloomApi';

// The key keeps its historical name on purpose: QA harnesses
// (capture / check-redesign / check-pinned-group) seed `turnloom.machine.v2`.
// The stored value is shape-versioned and a legacy single object still parses.
const STORAGE_KEY = 'turnloom.machine.v2';
const CACHE_PREFIX = 'turnloom.cache.v2.';

export type ConnectionStatus = 'unpaired' | 'checking' | 'connecting' | 'ready' | 'error' | 'reconnecting';

export type { PersistedMachine, MachineSummary } from '../lib/machineRegistry';

export interface SessionState {
  status: ConnectionStatus;
  machineId: string;
  machineName: string;
  serverUrl: string;
  machineToken: string;
  harnesses: Harness[];
  /** All paired machines for the device card; only the active one is verified live. */
  machines: MachineSummary[];
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
  harnesses: [], machines: [], harnessId: '', harnessName: '', harnessToken: '',
  scope: '', generation: 0, online: false, error: '',
  appVersion: APP_IDENTITY.versionName, appVersionCode: APP_IDENTITY.versionCode,
  packageName: APP_IDENTITY.applicationId,
  cameraAvailable: false, updatesAvailable: false,
  lastSyncAt: null, offlineCacheEnabled: true, revalidatedAt: null,
});

/** Monotonic id: a connection attempt interrupted by a newer one is ignored. */
let transitionSeq = 0;

function readRegistry(): MachineRegistry | null {
  try { return parseRegistry(secureGet(STORAGE_KEY)); } catch { return null; }
}

function persistRegistry(registry: MachineRegistry): void {
  try { secureSet(STORAGE_KEY, serializeRegistry(registry)); } catch { /* secure storage is best effort */ }
}

function readPersisted(): PersistedMachine | null {
  return activeMachine(readRegistry());
}

function machinePinned(machine: PersistedMachine): void {
  authorizeNativeOrigin(machine.serverUrl);
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
    // Disabling the offline cache must not leave another machine's threads behind.
    for (const machine of readRegistry()?.machines || []) {
      for (const h of machine.harnesses) secureRemove(cacheKeyFor(scopeFor(machine.machineId, h.id), 'threads'));
    }
  }
}
export function markSynced(): void { sessionStore.setState({ lastSyncAt: Date.now() }); }
export function setConnectionError(message: string, status: ConnectionStatus = 'error'): void {
  sessionStore.setState({ status, online: false, error: message });
}

/** Hydrate a persisted candidate, but leave the app locked until verified. */
export function hydrateSession(): PersistedMachine | null {
  transitionSeq += 1;
  const registry = readRegistry();
  const machine = activeMachine(registry);
  const cacheEnabled = secureGet('turnloom.offlineCache.v2') !== 'false';
  if (!machine) {
    setActiveRequestScope('unpaired');
    sessionStore.setState({
      status: 'unpaired', offlineCacheEnabled: cacheEnabled, machines: machineSummaries(registry),
      ...harnessPatch(null, 'unpaired', getActiveGeneration()),
    });
    return null;
  }
  setActiveRequestScope('revalidate');
  sessionStore.setState({
    status: 'checking',
    machineId: machine.machineId, machineName: machine.machineName,
    serverUrl: machine.serverUrl, machineToken: machine.machineToken,
    harnesses: machine.harnesses, machines: machineSummaries(registry),
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
  return revalidateMachine(machine, ++transitionSeq, 'checking');
}

/**
 * Switch to another paired machine. The machine was already verified when it
 * was paired, but its addresses/tokens may have rotated since, so this runs the
 * same discovery + health gate as a foreground revalidation.
 */
export async function switchMachine(id: string): Promise<boolean> {
  const registry = readRegistry();
  const machine = registry?.machines.find((item) => machineKey(item) === id) || null;
  if (!machine) return false;
  const state = sessionStore.getState();
  if (machineKey(machine) === machineKey({ machineId: state.machineId, serverUrl: state.serverUrl })
    && state.status === 'ready') return true;
  const attempt = ++transitionSeq;
  sessionStore.setState({ status: 'reconnecting', error: '', online: false, machines: machineSummaries(registry) });
  return revalidateMachine(machine, attempt, 'reconnecting');
}

async function revalidateMachine(
  machine: PersistedMachine,
  attempt: number,
  status: 'checking' | 'reconnecting',
): Promise<boolean> {
  setActiveRequestScope('revalidate');
  sessionStore.setState({ status, error: '', online: false });
  authorizeNativeOrigin(machine.serverUrl);
  const discovered = await discoverHarnesses(
    { serverUrl: machine.serverUrl, machineToken: machine.machineToken }, 'revalidate',
  );
  if (attempt !== transitionSeq) return false;
  if (!discovered.ok) {
    // 401 = 机器访问码已轮换。先用本地保存的服务码自愈，避免用户被迫重新扫码。
    if (discovered.status === 401 && await recoverWithSavedHarnesses(machine)) return true;
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

/**
 * 401 自愈：手机里存的机器访问码可能已被电脑端轮换（例如清掉了旧机器码）。
 * 此时不该让用户「忘记这台电脑 → 重新扫码」才能恢复。发现失败但本地已保存的
 * harness 列表仍在时，直接用保存的服务访问码逐个探活，能通就继续用。
 */
export async function recoverWithSavedHarnesses(machine: PersistedMachine): Promise<boolean> {
  const saved = machine.harnesses.filter((item) => item && item.token);
  if (!saved.length) return false;
  const attempt = ++transitionSeq;
  setActiveRequestScope('revalidate');
  for (const harness of saved) {
    const scope = scopeFor(machine.machineId, harness.id);
    const health = await verifyHarness({ origin: machine.serverUrl, token: harness.token }, scope);
    if (attempt !== transitionSeq) return false;
    if (!health.ok) continue;
    return activateMachine({ ...machine, defaultHarnessId: harness.id }, harness.id, true, attempt);
  }
  return false;
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
  const registry = upsertMachine(readRegistry(), { ...machine, defaultHarnessId: harness.id });
  persistRegistry(registry);
  machinePinned(machine);
  sessionStore.setState({
    status: 'ready',
    machineId: machine.machineId, machineName: machine.machineName,
    serverUrl: machine.serverUrl, machineToken: machine.machineToken,
    harnesses: machine.harnesses, machines: machineSummaries(registry),
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

/**
 * 连接过程中主动停止：取消在途请求、作废本次尝试，界面立刻回到可操作状态。
 * 已配对的电脑保留（可直接重试或改地址），从未连接过则回到未配对。
 */
export function stopConnecting(message = '已停止连接。'): void {
  const state = sessionStore.getState();
  if (state.status !== 'checking' && state.status !== 'connecting' && state.status !== 'reconnecting') return;
  transitionSeq += 1;
  cancelAllNativeRequests();
  const paired = Boolean(state.machineId || state.harnesses.length);
  sessionStore.setState({
    status: paired ? 'error' : 'unpaired',
    online: false,
    error: message,
    ...(paired ? {} : { harnesses: [], machines: [], serverUrl: '', machineToken: '' }),
  });
}

export function unpair(): void {
  const state = sessionStore.getState();
  forgetMachine(machineKey({ machineId: state.machineId, serverUrl: state.serverUrl }));
}

/**
 * Forget one paired machine (the active one by default). Its thread cache is
 * removed; when other machines remain, the most recently used one becomes
 * active instead of dropping the user back to the pairing screen.
 */
export function forgetMachine(id?: string): void {
  transitionSeq += 1;
  const previous = sessionStore.getState();
  const registry = readRegistry();
  const targetKey = id || machineKey({ machineId: previous.machineId, serverUrl: previous.serverUrl });
  const target = registry?.machines.find((item) => machineKey(item) === targetKey) || null;
  for (const h of target?.harnesses || previous.harnesses) {
    secureRemove(cacheKeyFor(scopeFor(target?.machineId || previous.machineId, h.id), 'threads'));
  }
  closeDetail();
  closeSheet();

  const remaining = registry ? removeMachine(registry, targetKey) : null;
  const next = activeMachine(remaining);
  if (!remaining || !next) {
    secureRemove(STORAGE_KEY);
    secureRemove('turnloom.serverUrl');
    setActiveRequestScope('unpaired');
    sessionStore.setState({
      status: 'unpaired', machineId: '', machineName: '', serverUrl: '', machineToken: '',
      harnesses: [], machines: [], ...harnessPatch(null, 'unpaired', getActiveGeneration()),
      online: false, error: '', lastSyncAt: null, revalidatedAt: null,
    });
    return;
  }

  persistRegistry(remaining);
  if (targetKey !== registry?.activeMachineId) {
    // A non-active machine was forgotten: the current session stays untouched.
    sessionStore.setState({ machines: machineSummaries(remaining) });
    return;
  }
  machinePinned(next);
  setActiveRequestScope('revalidate');
  sessionStore.setState({
    status: 'checking',
    machineId: next.machineId, machineName: next.machineName,
    serverUrl: next.serverUrl, machineToken: next.machineToken,
    harnesses: next.harnesses, machines: machineSummaries(remaining),
    ...harnessPatch(null, 'revalidate', getActiveGeneration()),
    online: false, error: '', lastSyncAt: null,
  });
  void revalidatePersisted(next);
}

export function isVerified(): boolean { return sessionStore.getState().status === 'ready'; }
export function useVerifiedSession(): SessionState { return useSessionState(); }
export const SESSION_STORAGE_KEYS = { machine: STORAGE_KEY, cachePrefix: CACHE_PREFIX } as const;

export default sessionStore;

/** 断连/未就绪时的“重试”入口：按已保存的机器重新校验，不需要用户重新扫码。 */
export function retryPersistedSession(): void {
  const machine = readPersisted();
  if (machine) void revalidatePersisted(machine);
}
