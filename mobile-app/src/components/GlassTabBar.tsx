/**
 * 底部毛玻璃导航栏（IA v4 + v5）。
 * 四个 Tab 与 (tabs)/_layout.tsx 的 Tabs.Screen name 一一对应。
 * v5：容器/行/Tab 改用 NativeWind className；文字用 Reusables 复制式 Text；
 * 图标仍是 expo-symbols 真字体图标（非 Unicode）。
 */
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/tabs';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_INTENSITY, GLASS_TINT, OptionA } from '@/constants/optionA';
import { Text } from '@/components/ui/rnr';

export type TabRouteName = 'index' | 'threads' | 'monitors' | 'settings';

type TabMeta = {
  label: string;
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

export function GlassTabBar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((route) => descriptors[route.key]);

  return (
    <View
      className="absolute bottom-0 left-0 right-0 overflow-hidden border-t border-[#E5E5EA]"
      style={{ paddingBottom: Math.max(insets.bottom, 8), borderTopWidth: 0.5 }}>
      <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} className="bg-white/85">
        <View className="flex-row items-center justify-around px-[6px] pt-[6px]">
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
                className="min-h-[44px] flex-1 items-center justify-center gap-[2px] active:opacity-80">
                <SymbolView
                  name={{ ios: meta.ios, android: meta.android, web: meta.android }}
                  size={21}
                  tintColor={color}
                  style={{ width: 22, height: 22 }}
                />
                <Text className="text-[10px] font-semibold" style={{ color }} numberOfLines={1}>
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
