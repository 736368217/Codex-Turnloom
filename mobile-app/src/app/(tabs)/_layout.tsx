/**
 * (tabs) group layout — 方案 A（微信/QQ 模型）。
 * 底栏只有 3 个一级页：对话(会话列表) / 终端 / 设置。
 * 聊天是全屏二级详情页 `app/thread/[id].tsx`（在 Stack 内，不在 Tabs 内），
 * 因此天然不带底栏；点列表行 router.push 进入，左上系统返回键回列表。
 *
 * 冷启动「选终端」是单一任务：未配对时整组不渲染底栏（与 Web 端一致），
 * 避免用户在还没连上电脑时看到点了没反应的 Tab。
 */
import { Tabs } from 'expo-router/tabs';

import { GlassTabBar } from '@/components/GlassTabBar';
import { DaylightBackdrop } from '@/components/DaylightBackdrop';
import { useTerminalSelection } from '@/services/appState';

export default function TabsLayout() {
  const { terminal, checking } = useTerminalSelection();
  const showTabBar = !checking && Boolean(terminal);

  return (
    <DaylightBackdrop>
      <Tabs
        tabBar={(props) => (showTabBar ? <GlassTabBar {...props} /> : null)}
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
