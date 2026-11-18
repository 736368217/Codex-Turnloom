import { useEffect, useState } from 'react';
import { App } from 'konsta/react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X } from 'lucide-react';
import GlassTabBar from './GlassTabBar';
import CupertinoSheetHost from './CupertinoSheetHost';
import HomeScreen from '../screens/HomeScreen';
import ThreadsScreen from '../screens/ThreadsScreen';
import MonitorsScreen from '../screens/MonitorsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ChatDetailScreen from '../screens/ChatDetailScreen';
import { useTabState, closeDetail, setActiveTab, tabStore } from '../state/tabStore';
import { COLORS } from '../theme/optionATokens';
import { haptic, registerBackHandler } from '../lib/nativeBridge';
import { backFromSheet, openSheet } from '../state/sheetStore';
import { useSessionState, currentRequestContext, retryPersistedSession } from '../state/sessionStore';
import { revalidateForForeground } from '../state/dataStore';
import { getPublicAppUpdate } from '../lib/turnloomApi';

/** App chrome. This subtree is mounted only after verified machine pairing. */
export default function AppShell() {
  const { activeTab, detailThreadId, detailTitle } = useTabState();
  const session = useSessionState();

  // 进入应用先自动查一次更新；有更新就弹层，用户可稍后或去设置里装。
  const [updateOffer, setUpdateOffer] = useState<{ versionName: string; versionCode: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!session.serverUrl) return;
    void (async () => {
      const result = await getPublicAppUpdate(session.serverUrl);
      if (cancelled || !result.ok) return;
      const code = Number(result.data?.versionCode || 0);
      if (code > Number(session.appVersionCode || 0)) {
        setUpdateOffer({ versionName: String(result.data?.versionName || ''), versionCode: code });
      }
    })();
    return () => { cancelled = true; };
  }, [session.serverUrl, session.generation]);
  const inDetail = detailThreadId !== null;

  useEffect(() => {
    const context = currentRequestContext();
    // Same-scope foreground revalidation keeps live messages and the attachment tray.
    if (context) revalidateForForeground(context);
  }, [session.scope, session.generation]);

  useEffect(() => { haptic('selection'); }, [activeTab]);

  useEffect(() => {
    const handler = (): boolean => {
      const state = tabStore.getState();
      if (backFromSheet()) { haptic('selection'); return true; }
      if (state.detailThreadId !== null) { closeDetail(); haptic('selection'); return true; }
      if (state.activeTab !== 'home') { setActiveTab('home'); haptic('selection'); return true; }
      return false;
    };
    registerBackHandler(handler);
    return () => registerBackHandler(null);
  }, []);

  return (
    <App theme="ios" dark={false} safeAreas>
      <div className="tl-app" style={{ background: COLORS.canvas }}>
        <div data-vaul-drawer-wrapper="" style={{ height: '100%', width: '100%', background: COLORS.canvas }}>
          {session.status !== 'ready' && (
            <div className="tl-conn-banner" role="status">
              <span>
                {session.status === 'checking' || session.status === 'reconnecting'
                  ? '正在重新连接电脑…（先显示上次缓存）'
                  : '离线：显示上次缓存的内容'}
              </span>
              <button type="button" className="tl-press" onClick={() => { haptic('selection'); retryPersistedSession(); }}>重试</button>
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            {inDetail ? (
              <motion.div key="detail" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18, ease: 'easeOut' }} style={{ height: '100%', width: '100%' }}>
                <ChatDetailScreen threadId={detailThreadId as string} title={detailTitle} />
              </motion.div>
            ) : (
              <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease: 'easeOut' }} style={{ height: '100%', width: '100%' }}>
                {activeTab === 'home' && <HomeScreen />}
                {activeTab === 'threads' && <ThreadsScreen />}
                {activeTab === 'monitors' && <MonitorsScreen />}
                {activeTab === 'settings' && <SettingsScreen />}
              </motion.div>
            )}
          </AnimatePresence>
          {!inDetail && <GlassTabBar activeTab={activeTab} />}
          {updateOffer && (
            <div className="tl-confirm-backdrop" role="dialog" aria-modal="true" aria-label="发现新版本">
              <div className="tl-confirm-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Download size={18} color={COLORS.blue} />
                  <div className="tl-confirm-title" style={{ flex: 1 }}>发现新版本 {updateOffer.versionName}</div>
                  <button type="button" className="tl-press" aria-label="稍后再说" onClick={() => setUpdateOffer(null)} style={{ width: 44, height: 44, marginRight: -8, border: 0, background: 'transparent', color: COLORS.labelSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={16} />
                  </button>
                </div>
                <div className="tl-confirm-note">当前 {session.appVersion}，可升级到 {updateOffer.versionName}。</div>
                <div className="tl-confirm-actions">
                  <button type="button" className="tl-confirm-cancel" onClick={() => setUpdateOffer(null)}>稍后</button>
                  <button type="button" className="tl-confirm-ok" onClick={() => { haptic('success'); setUpdateOffer(null); setActiveTab('settings'); openSheet('update'); }}>去更新</button>
                </div>
              </div>
            </div>
          )}
        </div>
        <CupertinoSheetHost />
      </div>
    </App>
  );
}
