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
  return session.status === 'ready'
    ? <AppShell key={`${session.scope}-${session.generation}`} />
    : <ConnectScreen onRevalidate={retrySaved} />;
}
