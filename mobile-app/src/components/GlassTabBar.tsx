/**
 * 底部毛玻璃导航栏（方案 A · 微信/QQ 模型）。
 * 3 个一级 Tab 与 (tabs)/_layout.tsx 的 Tabs.Screen name 一一对应；
 * 聊天详情页不在 Tabs 内，因此该栏不会出现在聊天页。
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

export type TabRouteName = 'index' | 'monitors' | 'settings';

type TabMeta = {
  label: string;
  ios: 'bubble.left.and.bubble.right.fill' | 'desktopcomputer' | 'gearshape.fill';
  android: 'chat' | 'desktop_windows' | 'settings';
};

const TAB_META: Record<TabRouteName, TabMeta> = {
  index: { label: '对话', ios: 'bubble.left.and.bubble.right.fill', android: 'chat' },
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
      className="absolute bottom-0 left-0 right-0 overflow-hidden"
      style={{
        paddingBottom: Math.max(insets.bottom, 8),
        paddingHorizontal: 12,
        paddingTop: 6,
        backgroundColor: 'rgba(255,255,255,0.62)',
        borderTopWidth: 0.5,
        borderTopColor: 'rgba(255,255,255,0.9)',
        shadowColor: '#101E3C',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        elevation: 8,
      }}>
      <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} className="overflow-hidden rounded-[26px] bg-white/55">
        <View className="flex-row items-center justify-around px-[6px] py-[6px]">
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
                className={`min-h-[44px] flex-1 items-center justify-center gap-[2px] rounded-[20px] py-[4px] active:opacity-80 ${focused ? 'bg-[#007AFF]/10' : ''}`}>
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
