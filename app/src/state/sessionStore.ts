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
  activeMachine, machineSummaries, applyHarnessChoice, harnessProbeOrder, explicitAfterFallback,
  type PersistedMachine, type MachineRegistry, type MachineSummary,
} from '../lib/machineRegistry';
import {
  discoverHarnesses, verifyHarness, setActiveRequestScope, getActiveGeneration,
  getActiveScope, getCurrentTarget, type ConnectionTarget, type RequestContext,
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
  /** 持久化里要尝试的入口；校验通过前 `harnessId` 为空，这个字段仍保留选择。 */
  harnessDefaultId: string;
  /** 当前入口是用户在设备页亲手选的（true），还是规则挑的（false）。 */
  harnessExplicit: boolean;
  scope: string;
  generation: number;
  online: boolean;
  error: string;
  /** 设备页专用：切换另一台电脑失败的原因；不污染全局连接态。 */
  switchError: string;
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
  harnesses: [], machines: [], harnessId: '', harnessName: '', harnessToken: '', harnessDefaultId: '', harnessExplicit: false,
  scope: '', generation: 0, online: false, error: '', switchError: '',
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
  sessionStore.setState({ status, online: false, error: message, switchError: '' });
}
/**
 * Drop a failure sentence that no longer applies, without touching the
 * connection state: entering 「添加一台电脑」 is a clean slate, and the old
 * machine's error has nothing to say about the new pairing.
 */
export function clearConnectionError(): void {
  const state = sessionStore.getState();
  if (!state.error && !state.switchError) return;
  sessionStore.setState({ error: '', switchError: '' });
}

/**
 * How a failed verification attempt is recorded. Cold start / foreground retry
 * speak for the whole app (`setConnectionError`); a machine switch must not —
 * the current machine was never probed, so it keeps its known state and the
 * failure belongs to the device page alone.
 */
type FailureReporter = (message: string) => void;
const reportConnectionFailure: FailureReporter = (message) => setConnectionError(message);

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
      harnessDefaultId: '', harnessExplicit: false,
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
    harnessDefaultId: machine.defaultHarnessId,
    harnessExplicit: machine.harnessExplicit === true,
    ...harnessPatch(null, 'revalidate', getActiveGeneration()),
    online: false, error: '', switchError: '', offlineCacheEnabled: cacheEnabled,
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
  const isCurrent = machineKey(machine) === machineKey({ machineId: state.machineId, serverUrl: state.serverUrl });
  if (isCurrent && state.status === 'ready') return true;
  const attempt = ++transitionSeq;
  const previous = state;
  const previousTarget = getCurrentTarget();
  sessionStore.setState({ status: 'reconnecting', error: '', switchError: '', online: false, machines: machineSummaries(registry) });
  // Switching machines is not a connection loss. If B cannot be verified, A was
  // never probed and keeps exactly what it had: status, online, request scope
  // and the generation the shell is keyed on. Recording this through
  // `setConnectionError` would leave the whole app in `error` — and then
  // `currentRequestContext()` is null, so the current machine cannot send a
  // single request until the user taps 重试; A's card would read "离线" for a
  // machine nothing has talked to.
  const reportFailure: FailureReporter = isCurrent
    ? reportConnectionFailure
    : (message) => {
      if (attempt !== transitionSeq) return;
      restoreSession(previous, previousTarget);
      sessionStore.setState({ switchError: message });
    };
  return revalidateMachine(machine, attempt, 'reconnecting', reportFailure);
}

/** Put the session back exactly as it stood before the switch attempt. */
function restoreSession(previous: SessionState, target: ConnectionTarget): void {
  // Same scope, new generation: `setActiveRequestScope` always bumps it, and
  // requests built from the restored context must be current again.
  setActiveRequestScope(previous.scope || 'unpaired', target);
  sessionStore.setState({
    status: previous.status,
    machineId: previous.machineId, machineName: previous.machineName,
    serverUrl: previous.serverUrl, machineToken: previous.machineToken,
    harnesses: previous.harnesses, machines: previous.machines,
    harnessId: previous.harnessId, harnessName: previous.harnessName, harnessToken: previous.harnessToken,
    harnessDefaultId: previous.harnessDefaultId,
    harnessExplicit: previous.harnessExplicit,
    scope: previous.scope || 'unpaired',
    generation: getActiveGeneration(),
    online: previous.online,
    error: previous.error,
  });
}

async function revalidateMachine(
  machine: PersistedMachine,
  attempt: number,
  status: 'checking' | 'reconnecting',
  reportFailure: FailureReporter = reportConnectionFailure,
): Promise<boolean> {
  setActiveRequestScope('revalidate');
  sessionStore.setState({ status, error: '', switchError: '', online: false });
  authorizeNativeOrigin(machine.serverUrl);
  const discovered = await discoverHarnesses(
    { serverUrl: machine.serverUrl, machineToken: machine.machineToken }, 'revalidate',
  );
  if (attempt !== transitionSeq) return false;
  if (!discovered.ok) {
    // 401 = 机器访问码已轮换。先用本地保存的服务码自愈，避免用户被迫重新扫码。
    // 自愈沿用本次 attempt：它换了 transitionSeq 的话，下面这条失败就该被当成
    // 「过期结果」丢掉，切换失败反而留在 error 态。
    if (discovered.status === 401 && await recoverWithSavedHarnesses(machine, attempt)) return true;
    reportFailure(connectionErrorMessage(discovered.status, discovered.error));
    return false;
  }
  const normalized = normalizeDiscovery(discovered.data, manualPairingFor(machine));
  if (!normalized.ok) { reportFailure(normalized.error); return false; }
  // Discovery tokens are authoritative; never reuse an obsolete persisted token.
  // 候选顺序：显式选择 > PI > 电脑端默认 > 第一个。从**持久化的 machine** 展开，
  // 只把 harness 列表换成这次发现的结果——电脑端的 `defaultHarnessId` 只是候选，
  // 不能覆盖用户在设备页亲手点过的入口；显式入口若已消失，就退回规则并记为非显式。
  const updated = applyHarnessChoice({
    ...machine,
    machineId: normalized.machine.machineId,
    machineName: normalized.machine.machineName || machine.machineName,
    serverUrl: machine.serverUrl,
    machineToken: machine.machineToken,
    harnesses: normalized.machine.harnesses,
  }, normalized.machine.harnesses);
  return activateMachine(
    updated, updated.defaultHarnessId, true, attempt, reportFailure, updated.harnessExplicit === true,
  );
}

/**
 * 401 自愈：手机里存的机器访问码可能已被电脑端轮换（例如清掉了旧机器码）。
 * 此时不该让用户「忘记这台电脑 → 重新扫码」才能恢复。发现失败但本地已保存的
 * harness 列表仍在时，直接用保存的服务访问码逐个探活，能通就继续用。
 *
 * 传入调用方的 attempt 时，自愈属于同一次切换/重校验：它不另起一代，
 * 调用方随后仍要拿到「这次尝试失败了」的结论（否则失败分支会被当成过期结果）。
 */
export async function recoverWithSavedHarnesses(
  machine: PersistedMachine,
  attempt: number = ++transitionSeq,
): Promise<boolean> {
  const saved = machine.harnesses.filter((item) => item && item.token);
  if (!saved.length) return false;
  setActiveRequestScope('revalidate');
  const explicit = machine.harnessExplicit === true;
  const preferredId = machine.defaultHarnessId;
  // 探活顺序同样是「显式/规则首选优先」，但保留全部兜底项：首选死了也必须能恢复。
  for (const harness of harnessProbeOrder(saved, { explicit, preferredId })) {
    const scope = scopeFor(machine.machineId, harness.id);
    const health = await verifyHarness({ origin: machine.serverUrl, token: harness.token }, scope);
    if (attempt !== transitionSeq) return false;
    if (!health.ok) continue;
    // 只有探通的正是原来的显式选择时才保留「显式」；退到兜底项就写回 false，
    // 不能让一次救急把兜底伪装成用户选择、从此粘死。
    const stillExplicit = explicitAfterFallback({ explicit, preferredId }, harness.id);
    return activateMachine(
      { ...machine, defaultHarnessId: harness.id, harnessExplicit: stillExplicit },
      harness.id, true, attempt, reportConnectionFailure, stillExplicit,
    );
  }
  return false;
}

/** Pair from a canonical QR or manual URL+code; persist only after verification. */
export async function connectWithPairing(pairing: MachinePairing): Promise<boolean> {
  const attempt = ++transitionSeq;
  const discoveryScope = `pairing-${attempt}-${Date.now()}`;
  setActiveRequestScope(discoveryScope);
  sessionStore.setState({ status: 'connecting', error: '', switchError: '', online: false });
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
  // 新配对走同一条规则：用户还没选过 → PI > 电脑端默认 > 第一个。
  const machine = applyHarnessChoice({
    ...normalized.machine,
    serverUrl: pairing.serverUrl,
    machineToken: pairing.machineToken,
  }, normalized.machine.harnesses);
  return activateMachine(machine, machine.defaultHarnessId, false, attempt, reportConnectionFailure, false);
}

async function activateMachine(
  machine: PersistedMachine,
  harnessId: string,
  revalidated: boolean,
  attempt: number,
  reportFailure: FailureReporter = reportConnectionFailure,
  explicit = false,
): Promise<boolean> {
  const harness = machine.harnesses.find((item) => item.id === harnessId) || machine.harnesses[0];
  if (!harness) {
    if (attempt === transitionSeq) reportFailure('这台机器没有可用服务，请检查桌面端配置');
    return false;
  }
  const scope = scopeFor(machine.machineId, harness.id);
  const health = await verifyHarness({ origin: machine.serverUrl, token: harness.token }, scope);
  const expectedScope = getActiveScope();
  const expectedGeneration = getActiveGeneration();
  if (attempt !== transitionSeq || expectedScope !== scope) return false;
  if (!health.ok) {
    reportFailure(connectionErrorMessage(health.status, health.error));
    return false;
  }
  if (sessionStore.getState().scope !== scope) {
    closeDetail();
    closeSheet();
    tabStore.setState({ threadsQuery: '', threadsFilter: 'all' });
  }
  const registry = upsertMachine(readRegistry(), { ...machine, defaultHarnessId: harness.id, harnessExplicit: explicit });
  persistRegistry(registry);
  machinePinned(machine);
  sessionStore.setState({
    status: 'ready',
    machineId: machine.machineId, machineName: machine.machineName,
    serverUrl: machine.serverUrl, machineToken: machine.machineToken,
    harnesses: machine.harnesses, machines: machineSummaries(registry),
    harnessDefaultId: harness.id,
    harnessExplicit: explicit,
    ...harnessPatch(harness, expectedScope, expectedGeneration),
    online: true, error: '', switchError: '',
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
  sessionStore.setState({ status: 'reconnecting', error: '', switchError: '', online: false });
  const machine: PersistedMachine = {
    machineId: state.machineId, machineName: state.machineName,
    serverUrl: state.serverUrl, machineToken: state.machineToken,
    harnesses: state.harnesses, defaultHarnessId: harness.id, harnessExplicit: true,
  };
  // 设备页点选 = 用户显式选择：从此优先级高于「PI 优先」规则。
  const ok = await activateMachine(machine, harness.id, false, attempt, reportConnectionFailure, true);
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
    switchError: '',
    ...(paired ? {} : { harnesses: [], machines: [], serverUrl: '', machineToken: '', harnessDefaultId: '', harnessExplicit: false }),
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
      harnesses: [], machines: [], harnessDefaultId: '', harnessExplicit: false, ...harnessPatch(null, 'unpaired', getActiveGeneration()),
      online: false, error: '', switchError: '', lastSyncAt: null, revalidatedAt: null,
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
    harnessDefaultId: next.defaultHarnessId,
    harnessExplicit: next.harnessExplicit === true,
    ...harnessPatch(null, 'revalidate', getActiveGeneration()),
    online: false, error: '', switchError: '', lastSyncAt: null,
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
