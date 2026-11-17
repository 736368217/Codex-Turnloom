import { useEffect } from 'react';
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
  const saved = hydrateSession();
  if (saved) void revalidatePersisted(saved);
}

// 同步读一次已配对信息：否则首帧 harnesses 为空，会闪一下连接页。
// hydrateSession 只读安全存储，不触发网络，放在模块初始化里是安全的。
const bootSaved = hydrateSession();

export default function AppRoot() {
  const session = useSessionState();
  useEffect(() => {
    bootstrap();
    const onVisible = () => {
      // SessionStore alone owns transition sequencing. Never feed it a React
      // lifecycle counter; reinstall/foreground/camera all have different lifetimes.
      const state = sessionStore.getState();
      if (document.visibilityState === 'visible' && (state.status === 'ready' || state.status === 'error')) retrySaved();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // 已配对过就先进入工作台读缓存，后台再校验；只有从未配对才停在连接页。
  const usable = session.harnesses.length > 0;
  // 首帧还没读完配对信息时，什么都不渲染（白底交给 App 外壳），绝不先闪连接页。
  if (!usable && bootSaved) return null;
  return usable
    ? <AppShell key={`${session.scope}-${session.generation}`} />
    : <ConnectScreen onRevalidate={retrySaved} />;
}
