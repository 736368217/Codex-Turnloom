/**
 * (tabs) group layout: JS Tabs navigator with a custom BlurView tab bar.
 * Four entries: Home / Project·Threads / Monitors / Settings, active #007AFF.
 */
import { Tabs } from 'expo-router/tabs';
import { View } from 'react-native';

import { GlassTabBar } from '@/components/GlassTabBar';
import { OptionA } from '@/constants/optionA';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: OptionA.canvas },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="threads" options={{ title: 'Project · Threads' }} />
      <Tabs.Screen name="monitors" options={{ title: 'Monitors' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
