/**
 * (tabs) group layout — 方案 A（微信/QQ 模型）。
 * 底栏只有 3 个一级页：对话(会话列表) / 终端 / 设置。
 * 聊天是全屏二级详情页 `app/thread/[id].tsx`（在 Stack 内，不在 Tabs 内），
 * 因此天然不带底栏；点列表行 router.push 进入，左上系统返回键回列表。
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
        <Tabs.Screen name="monitors" options={{ title: '终端' }} />
        <Tabs.Screen name="settings" options={{ title: '设置' }} />
      </Tabs>
    </DaylightBackdrop>
  );
}
