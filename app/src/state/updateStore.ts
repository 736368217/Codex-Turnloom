/**
 * App-update state machine (2.4.2): one check, one sheet, two actions.
 *
 * The 2.4.1 bug this replaces: the only automatic check lived in `UpdatePanel`'s
 * mount effect, and `UpdatePanel` only mounts inside the settings sheet — so a
 * cold start never checked at all, and the sheet stacked four rows (check /
 * download / cancel / install) for one decision.
 *
 * Shape now:
 *   - `AppRoot` starts exactly one boot check (silent while unpaired) and one
 *     foreground check. A confirmed new version opens the sheet by itself,
 *     unless the user postponed that version in this process.
 *   - The sheet offers 「立即更新」/「稍后」. Download → verify → the native
 *     installer is opened once, without a second tap.
 *   - Settings keeps a single version row reading 已是最新 · HH:mm / 有更新 X /
 *     检查失败. A check that never got an answer can never read 已是最新.
 */
import { createStore, useStore } from './store';
import type { AppUpdateInfo } from '../lib/turnloomApi';
import {
  cancelUpdate, hasNativeUpdater, installUpdate, isPublicUpdateUrl, onUpdateEvent, startUpdateDownload,
} from '../lib/nativeBridge';
import { absoluteApkUrl } from '../lib/appUpdate';
import { runUpdateCheck, type UpdateCheckOutcome } from '../lib/updateChannel';
import { currentRequestContext, sessionStore } from './sessionStore';
import { openSheet, sheetStore } from './sheetStore';

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'current' | 'unavailable' | 'error' | 'downloading' | 'ready' | 'cancelled';
export type UpdateSource = 'public' | 'server' | null;

export const updateStore = createStore({
  state: 'idle' as UpdatePhase,
  message: '',
  release: null as AppUpdateInfo | null,
  progress: { received: 0, total: 0 },
  // A check that lands on the same answer as the last one still has to look like it
  // ran; the version row prints this timestamp so "已是最新" never reads as a dead row.
  lastCheckedAt: 0,
  requestId: '',
  // Which leg answered the last check. The row refuses to claim "已是最新" without one.
  source: null as UpdateSource,
  host: '',
  publicError: '',
  /** The native installer still needs a tap (unknown-sources permission / user cancelled). */
  needsInstallConfirm: false,
  /** 稍后 in this process: that versionCode must not re-open the sheet by itself. */
  dismissedVersionCode: 0,
  /** A new version was found while another sheet was open; open it once that closes. */
  autoOpenPending: false,
});
export const setState = (state: UpdatePhase) => updateStore.setState({ state });
export const setMessage = (message: string) => updateStore.setState({ message });
export const setRelease = (release: AppUpdateInfo | null) => updateStore.setState({ release });
export const setProgress = (progress: { received: number; total: number }) => updateStore.setState({ progress });
export const setRequestId = (requestId: string) => updateStore.setState({ requestId });
export const setChannel = (channel: { source: UpdateSource; host: string; publicError: string }) => updateStore.setState(channel);
export const useUpdate = () => useStore(updateStore);

// ---------------------------------------------------------------------------
// Automatic prompt rules
// ---------------------------------------------------------------------------

/** False until the workbench is usable: an unpaired cold start checks silently. */
let autoPromptAllowed = false;
let bootCheckStarted = false;
let readyCheckDone = false;
let checking = false;
let rerunRequested = false;
let installerLaunchedFor = '';
/**
 * `setActiveRequestScope()` cancels every in-flight native request when a machine
 * revalidation moves from discovery to health. A public manifest request that
 * starts in that window dies as `status 0` and the popup never happens (the
 * foreground race found by the 2.4.2 gate). Background checks therefore wait for
 * the session to settle instead of joining that cancellation window.
 */
let waitingForSettle = false;

function sessionSettled(): boolean {
  const status = sessionStore.getState().status;
  return status === 'ready' || status === 'error' || status === 'unpaired';
}

sessionStore.subscribe(() => {
  if (!waitingForSettle || !sessionSettled()) return;
  waitingForSettle = false;
  void checkForUpdates({ manual: false });
});

/** Open the update sheet if a confirmed new version is waiting and nothing else is open. */
function maybeAutoOpen(): void {
  if (!autoPromptAllowed) return;
  const s = updateStore.getState();
  if (s.state !== 'available' || !s.release) return;
  // A version the user already postponed stays quiet for the rest of this process;
  // a later, higher versionCode is a new answer and may prompt again.
  if (s.release.versionCode <= s.dismissedVersionCode) return;
  if (sheetStore.getState().sheet === 'update') return;
  if (sheetStore.getState().sheet !== null) {
    // Never stack on top of diagnostics / a link sheet. The host flushes this
    // when its current sheet closes.
    updateStore.setState({ autoOpenPending: true });
    return;
  }
  updateStore.setState({ autoOpenPending: false });
  openSheet('update');
}

/** Called by the sheet host after it closed whatever was open. */
export function flushPendingUpdatePrompt(): void {
  if (!updateStore.getState().autoOpenPending) return;
  if (sheetStore.getState().sheet !== null) return;
  maybeAutoOpen();
}

/** AppRoot turns this on once the workbench (not only the connect screen) is up. */
export function allowUpdatePrompt(allowed: boolean): void {
  autoPromptAllowed = allowed;
  if (allowed) maybeAutoOpen();
  // Unpairing unmounts the sheet host; a leftover "open when it closes" intention
  // must not fire onto the connect screen later.
  else if (updateStore.getState().autoOpenPending) updateStore.setState({ autoOpenPending: false });
}

/**
 * One boot check, then one more once the paired workbench is ready (the second
 * pass is the only one that can use the computer fallback).
 */
export function beginBootUpdateCheck(workbenchReady: boolean): void {
  if (!bootCheckStarted) {
    bootCheckStarted = true;
    void checkForUpdates({ manual: false });
    return;
  }
  if (workbenchReady && !readyCheckDone) {
    readyCheckDone = true;
    void checkForUpdates({ manual: false });
  }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export interface UpdateCheckOptions {
  /** A row tap: surfaces failures and holds 检查中 long enough to be seen. */
  manual?: boolean;
}

export async function checkForUpdates(options: UpdateCheckOptions = {}): Promise<UpdateCheckOutcome | null> {
  const manual = options.manual === true;
  if (checking) {
    // A boot check racing the ready check must not be lost; run one more pass.
    if (!manual) rerunRequested = true;
    return null;
  }
  const before = updateStore.getState();
  // Never disturb a download or a verified package.
  if (before.state === 'downloading' || before.state === 'ready') return null;
  // A background tick while the user is looking at the sheet would flash 检查中.
  if (!manual && sheetStore.getState().sheet === 'update') return null;
  // Do not start a public manifest request inside a machine revalidation: the
  // next scope switch cancels it, which used to hide a real new version.
  if (!manual && !sessionSettled()) {
    waitingForSettle = true;
    return null;
  }

  checking = true;
  updateStore.setState({ state: 'checking', message: '正在检查新版本…' });
  const startedAt = Date.now();
  let outcome: UpdateCheckOutcome | null = null;
  try {
    const session = sessionStore.getState();
    outcome = await runUpdateCheck({
      installed: { versionCode: session.appVersionCode, packageName: session.packageName },
      serverContext: currentRequestContext(),
    });
  } catch {
    outcome = null;
  } finally {
    checking = false;
  }

  if (!outcome) {
    updateStore.setState({
      state: 'error', message: '检查更新失败，请稍后重试', release: null,
      lastCheckedAt: Date.now(), source: null,
    });
  } else {
    if (manual) {
      // A manual tap that returns the same answer must still be visible as a check.
      const elapsed = Date.now() - startedAt;
      if (elapsed < 500) await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
    }
    updateStore.setState({
      lastCheckedAt: Date.now(),
      source: outcome.source,
      host: outcome.host,
      publicError: outcome.publicError,
    });
    if (outcome.state === 'error') {
      // Never downgrade a confirmed update to 检查失败: the release is still actionable.
      const keep = !manual && ['available', 'ready', 'cancelled', 'downloading'].includes(before.state) && before.release
        ? before : null;
      if (keep) {
        updateStore.setState({ state: keep.state, message: keep.message, release: keep.release });
      } else {
        updateStore.setState({ state: 'error', message: outcome.message, release: null });
      }
    } else {
      updateStore.setState({ state: outcome.state, message: outcome.message, release: outcome.release });
      if (outcome.state === 'available' && !manual) maybeAutoOpen();
    }
  }

  if (rerunRequested) {
    rerunRequested = false;
    void checkForUpdates({ manual: false });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Download / install
// ---------------------------------------------------------------------------

/** 「立即更新」: one tap starts the download; a verified package opens the installer. */
export function startUpdate(): void {
  const release = updateStore.getState().release;
  if (!release) {
    void checkForUpdates({ manual: true });
    return;
  }
  if (!hasNativeUpdater()) {
    updateStore.setState({ state: 'error', message: '此设备暂不支持在应用内下载安装包' });
    return;
  }
  const context = currentRequestContext();
  const isPublic = isPublicUpdateUrl(release.apkUrl);
  // A public CDN download needs no paired machine; a computer-hosted one does.
  if (!isPublic && !context) {
    updateStore.setState({ state: 'error', message: '这份安装包由电脑端提供，请先连接电脑再下载' });
    return;
  }
  const url = absoluteApkUrl(context ? context.target.origin : '', release.apkUrl);
  if (!url) {
    updateStore.setState({ state: 'error', message: '安装包地址无效，请重新检查更新' });
    return;
  }
  const id = startUpdateDownload({
    // The machine token never travels to R2: a public download carries none.
    url,
    token: isPublic ? '' : (context ? context.target.token : ''),
    sha256: release.sha256,
    versionCode: release.versionCode,
    packageName: release.packageName,
  });
  if (!id) {
    updateStore.setState({ state: 'error', message: '无法开始下载，请稍后重试' });
    return;
  }
  installerLaunchedFor = '';
  updateStore.setState({
    requestId: id,
    state: 'downloading',
    message: '正在下载安装包…',
    progress: { received: 0, total: 0 },
    needsInstallConfirm: false,
  });
}

function launchInstallerOnce(): void {
  const current = updateStore.getState();
  if (!current.requestId || installerLaunchedFor === current.requestId) return;
  installerLaunchedFor = current.requestId;
  if (!installUpdate()) {
    updateStore.setState({ state: 'ready', needsInstallConfirm: true, message: '无法打开系统安装界面，请稍后重试。' });
  }
}

/** The sheet's 「继续安装」 after the system asked for permission / the user cancelled. */
export function continueInstall(): void {
  if (!updateStore.getState().release) return;
  installerLaunchedFor = '';
  updateStore.setState({ needsInstallConfirm: false, message: '正在打开系统安装界面…' });
  launchInstallerOnce();
}

export function cancelDownload(): void {
  cancelUpdate();
}

/** 「稍后」 or a swipe-down on the update sheet: same version stays quiet this process. */
export function dismissUpdatePrompt(): void {
  const s = updateStore.getState();
  if (s.release && (s.state === 'available' || s.state === 'downloading' || s.state === 'cancelled')) {
    updateStore.setState({ dismissedVersionCode: s.release.versionCode, autoOpenPending: false });
  } else {
    updateStore.setState({ autoOpenPending: false });
  }
}

onUpdateEvent((id, event) => {
  const current = updateStore.getState();
  if (!current.requestId || current.requestId !== id) return;
  if (event.state === 'downloading') {
    updateStore.setState({
      state: 'downloading',
      message: '正在下载安装包…',
      progress: { received: event.received || 0, total: event.total || 0 },
    });
  } else if (event.state === 'ready') {
    updateStore.setState({ state: 'ready', needsInstallConfirm: false, message: '安装包已校验，正在打开系统安装界面…' });
    // One download = at most one installer launch, even if the event repeats.
    launchInstallerOnce();
  } else if (event.state === 'permission-required') {
    installerLaunchedFor = '';
    updateStore.setState({ state: 'ready', needsInstallConfirm: true, message: '请允许安装此来源的应用，然后回到这里继续。' });
  } else if (event.state === 'cancelled') {
    updateStore.setState({ state: 'cancelled', message: '下载已取消，已下载的部分会保留。' });
  } else if (event.message === 'install-cancelled' || event.message === 'install-permission-denied') {
    installerLaunchedFor = '';
    updateStore.setState({ state: 'ready', needsInstallConfirm: true, message: '尚未安装，安装包已保留。' });
  } else {
    updateStore.setState({ state: 'error', message: '下载或校验失败，请重试。' });
  }
});
