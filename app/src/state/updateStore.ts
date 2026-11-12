import { createStore, useStore } from './store';
import type { AppUpdateInfo } from '../lib/turnloomApi';
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'current' | 'unavailable' | 'error' | 'downloading' | 'ready' | 'cancelled';
export const updateStore = createStore({ state: 'idle' as UpdatePhase, message: '', release: null as AppUpdateInfo | null, progress: { received: 0, total: 0 }, requestId: '' });
export const setState = (state: UpdatePhase) => updateStore.setState({ state });
export const setMessage = (message: string) => updateStore.setState({ message });
export const setRelease = (release: AppUpdateInfo | null) => updateStore.setState({ release });
export const setProgress = (progress: { received: number; total: number }) => updateStore.setState({ progress });
export const setRequestId = (requestId: string) => updateStore.setState({ requestId });
export const useUpdate = () => useStore(updateStore);

// Remains subscribed when settings is unmounted by Tab or foreground changes.
import { onUpdateEvent } from '../lib/nativeBridge';
onUpdateEvent((id, event) => {
  const current = updateStore.getState();
  if (!current.requestId || current.requestId !== id) return;
  if (event.state === 'downloading') {
    updateStore.setState({ state: 'downloading', message: '正在下载安装包…', progress: { received: event.received || 0, total: event.total || 0 } });
  } else if (event.state === 'ready') {
    updateStore.setState({ state: 'ready', message: '安装包已校验，可打开系统安装界面。' });
  } else if (event.state === 'permission-required') {
    updateStore.setState({ state: 'ready', message: '请允许安装此来源的应用，然后返回继续。' });
  } else if (event.state === 'cancelled') {
    updateStore.setState({ state: 'cancelled', message: '下载已暂停，已下载部分会保留。' });
  } else if (event.message === 'install-cancelled' || event.message === 'install-permission-denied') {
    updateStore.setState({ state: 'ready', message: '尚未安装。安装包已保留，可再次打开系统安装界面。' });
  } else {
    updateStore.setState({ state: 'error', message: '下载或校验失败，请重新检查更新后重试。' });
  }
});
