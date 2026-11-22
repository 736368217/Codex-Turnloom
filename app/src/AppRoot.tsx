import { useEffect, useState } from 'react';
import AppShell from './components/AppShell';
import ConnectScreen from './screens/ConnectScreen';
import { getAppInfoObject, installNativeBridgeCallbacks, setLightBars } from './lib/nativeBridge';
import {
  hydrateSession, revalidatePersisted, setNativeCapabilities,
  sessionStore, useSessionState, type PersistedMachine,
} from './state/sessionStore';
import { closeAddMachine, useTabState } from './state/tabStore';
import { setNetworkStateHandler, setUnauthorizedHandler } from './lib/turnloomApi';
import { reportNetworkResult } from './state/offlineStore';
import { allowUpdatePrompt, beginBootUpdateCheck, checkForUpdates } from './state/updateStore';

let booted = false;
/** 冷启动宽限：先给画布底色，等配对信息与首轮校验落地，绝不先闪连接页。 */
const BOOT_GRACE_MS = 260;

function candidate(): PersistedMachine | null {
  const s = sessionStore.getState();
  if (!s.serverUrl || !s.machineToken || !s.harnesses.length) return null;
  return { machineId: s.machineId, machineName: s.machineName, serverUrl: s.serverUrl,
    machineToken: s.machineToken, harnesses: s.harnesses,
    // `harnessId` is empty until a verification succeeds; a retry must
    // re-resolve the stored choice, not the desktop default.
    defaultHarnessId: s.harnessId || s.harnessDefaultId || s.harnesses[0].id,
    harnessExplicit: s.harnessExplicit };
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
  const { addMachine } = useTabState();
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

  // 启动自检 (2.4.2)：未配对时只默默查公网清单，绝不弹层；工作台就绪后
  // 发现新版本由 updateStore 自己弹出唯一一张 sheet（同一版本「稍后」后不再弹）。
  useEffect(() => {
    if (!bootReady) return;
    const ready = usable && session.status === 'ready';
    // Every pass sets the flag in both directions: after 「忘记这台电脑」 the
    // connect screen must not inherit a pending auto-prompt.
    allowUpdatePrompt(ready);
    beginBootUpdateCheck(ready);
  }, [bootReady, usable, session.status]);

  // 回到前台再查一次：新版本可以再弹，同版本被「稍后」挡掉。
  useEffect(() => {
    if (!bootReady) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForUpdates({ manual: false });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [bootReady]);
  // 「添加一台电脑」是工作台之上的全屏路由：配对页自带 Konsta <App>，
  // 嵌进 AppShell 会叠两层壳，也看不见相机。配对成功后回到设备页。
  // 取消/失败返回时，如果旧电脑被这次尝试置成了 error，就按旧电脑重新校验，
  // 不能让「加一台没加成」把当前会话留在断线态。
  const leaveAddMachine = () => {
    closeAddMachine();
    const state = sessionStore.getState();
    if (state.status !== 'ready' && state.machineId) retrySaved();
  };
  if (usable && addMachine) {
    return <ConnectScreen mode="add" onBack={leaveAddMachine} onPaired={closeAddMachine} />;
  }
  if (usable) return <AppShell key={`${session.scope}-${session.generation}`} />;
  // 宽限期内、或本地已有配对记录但状态还没落地：只给画布底色。
  if (!bootReady || bootSaved) return <div className="tl-app" style={{ background: '#F2F2F7' }} />;
  return <ConnectScreen onRevalidate={retrySaved} />;
}
