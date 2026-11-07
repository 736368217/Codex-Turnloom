/**
 * (tabs) group layout: JS Tabs navigator with a custom BlurView tab bar.
 * Four entries: Home / Threads / Monitors / Settings, active #007AFF.
 *
 * Option A v6：整组套 DaylightBackdrop（日光雾白渐变），让 BlurView 玻璃
 * 在 Android 上也有可折射的底色；四个 Tab 视觉统一。
 */
import { Tabs } from 'expo-router/tabs';

import { GlassTabBar } from '@/components/GlassTabBar';
import { DaylightBackdrop } from '@/components/DaylightBackdrop';

export default function TabsLayout() {
  return (
    <DaylightBackdrop>
      <Tabs
        tabBar={(props) => <GlassTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: 'transparent' },
        }}>
        <Tabs.Screen name="index" options={{ title: '对话' }} />
        <Tabs.Screen name="threads" options={{ title: '会话' }} />
        <Tabs.Screen name="monitors" options={{ title: '终端' }} />
        <Tabs.Screen name="settings" options={{ title: '设置' }} />
      </Tabs>
    </DaylightBackdrop>
  );
}
