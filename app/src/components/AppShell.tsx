import { useEffect, useRef } from 'react';
import { App } from 'konsta/react';
import { motion, AnimatePresence } from 'motion/react';
import GlassTabBar from './GlassTabBar';
import CupertinoSheetHost from './CupertinoSheetHost';
import ThreadsScreen from '../screens/ThreadsScreen';
import DevicesScreen from '../screens/DevicesScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ChatDetailScreen from '../screens/ChatDetailScreen';
import { useTabState, closeDetail, setActiveTab, tabStore } from '../state/tabStore';
import { COLORS } from '../theme/optionATokens';
import { haptic, registerBackHandler } from '../lib/nativeBridge';
import { backFromSheet } from '../state/sheetStore';
import { useSessionState, currentRequestContext, retryPersistedSession } from '../state/sessionStore';
import { revalidateForForeground, refreshThreads } from '../state/dataStore';
import { startBridgeWatch } from '../state/bridgeWatch';

/** App chrome. This subtree is mounted only after verified machine pairing. */
export default function AppShell() {
  const { activeTab, detailThreadId, detailTitle, composing } = useTabState();
  const session = useSessionState();

  const inDetail = composing || detailThreadId !== null;

  useEffect(() => {
    const context = currentRequestContext();
    // Same-scope foreground revalidation keeps live messages and the attachment tray.
    if (context) revalidateForForeground(context);
  }, [session.scope, session.generation]);

  // 「这台电脑还在吗」的 3 秒心跳。设备页自己不请求任何东西，所以没有它，
  // 卡片上的「在线」只在用户碰巧触发一次失败请求时才翻（QA 1 号缺陷）。
  useEffect(() => startBridgeWatch(), [session.scope, session.generation]);

  useEffect(() => { haptic('selection'); }, [activeTab]);

  // 2.4.0: the list's bottom "refresh" button is gone; entering the list (from
  // another tab or back from a detail) is the refresh gesture instead. The first
  // mount is already covered by revalidateForForeground above.
  const listVisited = useRef(false);
  useEffect(() => {
    if (activeTab !== 'threads' || inDetail) return;
    if (!listVisited.current) { listVisited.current = true; return; }
    const context = currentRequestContext();
    if (context) void refreshThreads(context);
  }, [activeTab, inDetail, session.scope, session.generation]);

  useEffect(() => {
    const handler = (): boolean => {
      const state = tabStore.getState();
      if (backFromSheet()) { haptic('selection'); return true; }
      if (state.composing || state.detailThreadId !== null) { closeDetail(); haptic('selection'); return true; }
      if (state.activeTab !== 'threads') { setActiveTab('threads'); haptic('selection'); return true; }
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
            <div className="tl-conn-banner" role={session.error ? 'alert' : 'status'}>
              <span>
                {/* session.error carries the server's own reason (401 → access
                    code changed, 403/5xx → host error). Showing the generic
                    "offline" line for a 401 told the user to check Wi-Fi when
                    the real fix was re-pairing. */}
                {session.error
                  || (session.status === 'checking' || session.status === 'reconnecting'
                    ? '正在重新连接电脑…（先显示上次缓存）'
                    : '离线：显示上次缓存的内容')}
              </span>
              <button type="button" className="tl-press" onClick={() => { haptic('selection'); retryPersistedSession(); }}>重试</button>
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            {inDetail ? (
              <motion.div key="detail" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18, ease: 'easeOut' }} style={{ height: '100%', width: '100%' }}>
                <ChatDetailScreen threadId={(detailThreadId as string) || ''} title={detailTitle} newThread={composing} />
              </motion.div>
            ) : (
              <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease: 'easeOut' }} style={{ height: '100%', width: '100%' }}>
                {activeTab === 'threads' && <ThreadsScreen />}
                {activeTab === 'devices' && <DevicesScreen />}
                {activeTab === 'settings' && <SettingsScreen />}
              </motion.div>
            )}
          </AnimatePresence>
          {!inDetail && <GlassTabBar activeTab={activeTab} />}
        </div>
        <CupertinoSheetHost />
      </div>
    </App>
  );
}
