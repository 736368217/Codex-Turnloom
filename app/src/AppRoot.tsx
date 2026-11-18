import { useEffect, useState } from 'react';
import AppShell from './components/AppShell';
import ConnectScreen from './screens/ConnectScreen';
import { getAppInfoObject, installNativeBridgeCallbacks, setLightBars } from './lib/nativeBridge';
import {
  hydrateSession, revalidatePersisted, setNativeCapabilities,
  sessionStore, useSessionState, type PersistedMachine,
} from './state/sessionStore';
import { setNetworkStateHandler, setUnauthorizedHandler } from './lib/turnloomApi';
import { reportNetworkResult } from './state/offlineStore';

let booted = false;
/** 冷启动宽限：先给画布底色，等配对信息与首轮校验落地，绝不先闪连接页。 */
const BOOT_GRACE_MS = 260;

function candidate(): PersistedMachine | null {
  const s = sessionStore.getState();
  if (!s.serverUrl || !s.machineToken || !s.harnesses.length) return null;
  return { machineId: s.machineId, machineName: s.machineName, serverUrl: s.serverUrl,
    machineToken: s.machineToken, harnesses: s.harnesses,
    defaultHarnessId: s.harnessId || s.harnesses.find(h => h.defaultHarness)?.id || s.harnesses[0].id };
}
function retrySaved(): void {
  const saved = candidate();
  if (saved) void revalidatePersisted(saved);
}

// 同步读一次已配对信息：hydrateSession 只读安全存储、不触发网络，可在模块初始化执行。
const bootSaved = hydrateSession();

function bootstrap(): void {
  if (booted) return;
  booted = true;
  installNativeBridgeCallbacks();
  setLightBars();
  const info = getAppInfoObject();
  setNativeCapabilities(info);
  setNetworkStateHandler(reportNetworkResult);
  setUnauthorizedHandler(() => {
    if (sessionStore.getState().status === 'ready') retrySaved();
  });
  const saved = candidate() || bootSaved;
  if (saved) void revalidatePersisted(saved);
}

export default function AppRoot() {
  const session = useSessionState();
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    bootstrap();
    const timer = setTimeout(() => setBootReady(true), BOOT_GRACE_MS);
    const onVisible = () => {
      // SessionStore alone owns transition sequencing. Never feed it a React
      // lifecycle counter; reinstall/foreground/camera all have different lifetimes.
      const state = sessionStore.getState();
      if (document.visibilityState === 'visible' && (state.status === 'ready' || state.status === 'error')) retrySaved();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 已配对过就先进入工作台读缓存，后台再校验。
  const usable = session.harnesses.length > 0;
  if (usable) return <AppShell key={`${session.scope}-${session.generation}`} />;
  // 宽限期内、或本地已有配对记录但状态还没落地：只给画布底色。
  if (!bootReady || bootSaved) return <div className="tl-app" style={{ background: '#F2F2F7' }} />;
  return <ConnectScreen onRevalidate={retrySaved} />;
}
