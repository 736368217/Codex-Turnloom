/**
 * 底部导航栏（方案 A · 微信/QQ 模型）。
 * 3 个一级 Tab，与 (tabs)/_layout.tsx 的 Tabs.Screen name 一一对应；
 * 聊天详情不在 Tabs 内，因此不会出现此栏。
 *
 * V9 重做（用户反馈「好几个白色方框叠加在一起」）：
 * 之前是「外层半透明白 + 内层 BlurView(bg-white/55) + 选中项再叠 bg」三层，
 * 且外层方形、内层 26px 圆角，在 Android 上 expo-blur 并不做真模糊，
 * 只是又叠一个半透明白矩形 —— 于是肉眼看到的就是多个白框嵌套。
 *
 * 现在只保留 **一层** 表面：
 * - 整条栏 = 一个接近实色的白底 + 顶部 0.5px 发丝线 + 阴影，圆角只在外层做一次；
 * - 不再用 BlurView（Android 无真实模糊，纯属多叠一层白）；
 * - 选中态只改图标/文字颜色 + 图标下一个小胶囊，**不再给整个 tab 铺背景块**。
 */
import type { BottomTabBarProps } from 'expo-router/tabs';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
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
      style={{
        // 只有这一层表面：接近实色的白，杜绝「白块套白块」。
        backgroundColor: '#FCFCFD',
        borderTopWidth: 0.5,
        borderTopColor: 'rgba(60,60,67,0.14)',
        paddingBottom: Math.max(insets.bottom, 6),
        paddingTop: 6,
        paddingHorizontal: 8,
        shadowColor: '#101E3C',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 6,
      }}>
      <View className="flex-row items-stretch">
        {routes.map((route, index) => {
          const focused = state.index === index;
          const meta = metaFor(route.name);
          const color = focused ? OptionA.blue : '#9A9AA0';
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={meta.label}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                void Haptics.selectionAsync();
                navigateToTab(route.key);
              }}
              className="flex-1 items-center justify-center gap-[3px] py-[5px] active:opacity-60">
              <SymbolView
                name={{ ios: meta.ios, android: meta.android, web: meta.android }}
                size={22}
                tintColor={color}
                style={{ width: 24, height: 24 }}
              />
              <Text className="text-[10px] font-semibold" style={{ color }} numberOfLines={1}>
                {meta.label}
              </Text>
              {/* 选中标识：图标下方一个小点，不再铺整块背景 */}
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: focused ? OptionA.blue : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
