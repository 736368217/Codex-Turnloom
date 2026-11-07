/**
 * 底部毛玻璃导航栏（信息架构 v4）。
 * 四个 Tab 与 (tabs)/_layout.tsx 的 Tabs.Screen name 一一对应：
 *   index=对话 / threads=会话 / monitors=终端 / settings=设置
 * 图标使用真实字体图标（iOS SF Symbols、Android/Web Material Symbols），
 * 不再使用 Unicode 字符，避免部分机型出现方框。
 */
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/tabs';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_INTENSITY, GLASS_TINT, OptionA } from '@/constants/optionA';

/** route key 必须与 _layout.tsx 的 Tabs.Screen name 完全一致，否则会 fallback 成英文 route 名。 */
export type TabRouteName = 'index' | 'threads' | 'monitors' | 'settings';

type TabMeta = {
  label: string;
  /** iOS 走 SF Symbols，Android / Web 走 Material Symbols 字体图标。 */
  ios: 'bubble.left.and.bubble.right.fill' | 'list.bullet' | 'desktopcomputer' | 'gearshape.fill';
  android: 'chat' | 'list_alt' | 'desktop_windows' | 'settings';
};

const TAB_META: Record<TabRouteName, TabMeta> = {
  index: { label: '对话', ios: 'bubble.left.and.bubble.right.fill', android: 'chat' },
  threads: { label: '会话', ios: 'list.bullet', android: 'list_alt' },
  monitors: { label: '终端', ios: 'desktopcomputer', android: 'desktop_windows' },
  settings: { label: '设置', ios: 'gearshape.fill', android: 'settings' },
};

function metaFor(routeName: string): TabMeta {
  return TAB_META[routeName as TabRouteName] ?? TAB_META.index;
}

function TabIcon({ meta, color }: { meta: TabMeta; color: string }) {
  return (
    <SymbolView
      name={{ ios: meta.ios, android: meta.android, web: meta.android }}
      size={21}
      tintColor={color}
      style={styles.icon}
    />
  );
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
                <TabIcon meta={meta} color={color} />
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
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  icon: {
    width: 22,
    height: 22,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
