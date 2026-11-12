import { useEffect } from 'react';
import { App } from 'konsta/react';
import { motion, AnimatePresence } from 'motion/react';
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
import { backFromSheet } from '../state/sheetStore';
import { useSessionState, currentRequestContext } from '../state/sessionStore';
import { refreshAll, resetForScope } from '../state/dataStore';

/** App chrome. This subtree is mounted only after verified machine pairing. */
export default function AppShell() {
  const { activeTab, detailThreadId, detailTitle } = useTabState();
  const session = useSessionState();
  const inDetail = detailThreadId !== null;

  useEffect(() => {
    const context = currentRequestContext();
    if (context) { resetForScope(context); void refreshAll(context); }
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
        </div>
        <CupertinoSheetHost />
      </div>
    </App>
  );
}
