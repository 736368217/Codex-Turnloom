/**
 * Option A glass tab bar: BlurView `systemChromeMaterialLight` intensity 85,
 * four iOS-style entries, active tint #007AFF. Rendered via a custom `tabBar`
 * on the JS Tabs navigator so BlurView (not a native tab bar) owns the glass.
 */
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/tabs';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_INTENSITY, GLASS_TINT, OptionA } from '@/constants/optionA';

export type TabIconName = 'home' | 'threads' | 'monitors' | 'settings';

const TAB_META: Record<string, { label: string; icon: string }> = {
  index: { label: 'Home', icon: '⌂' },
  threads: { label: 'Project · Threads', icon: '☰' },
  monitors: { label: 'Monitors', icon: '◉' },
  settings: { label: 'Settings', icon: '⚙' },
};

function metaFor(routeName: string) {
  return TAB_META[routeName] ?? { label: routeName, icon: '○' };
}

export function GlassTabBar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((route) => descriptors[route.key]);

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} style={styles.blur}>
        <View style={styles.row}>
          {routes.map((route, index) => {
            const focused = state.index === index;
            const meta = metaFor(route.name);
            const color = focused ? OptionA.blue : OptionA.inkSoft;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityLabel={meta.label}
                accessibilityState={{ selected: focused }}
                onPress={() => {
                  void Haptics.selectionAsync();
                  navigateToTab(route.key);
                }}
                style={({ pressed }) => [
                  styles.tab,
                  { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
                ]}>
                <Text style={[styles.icon, { color }]}>{meta.icon}</Text>
                <Text style={[styles.label, { color }]} numberOfLines={1}>
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OptionA.separator,
    overflow: 'hidden',
  },
  blur: {
    backgroundColor: OptionA.glass,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  icon: {
    fontSize: 19,
    lineHeight: 22,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
