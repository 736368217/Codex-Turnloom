/**
 * 「设置」Tab：访问码说明、只读模式、关于。
 * v5：NativeWind className + React Native Reusables 复制式 Card/Button/Text。
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui/rnr';
import { getTurnloomClient } from '@/services/turnloomClient';

const client = getTurnloomClient();

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [paired, setPaired] = useState(false);

  useEffect(() => {
    let alive = true;
    void client.load().then(async (config) => {
      if (!alive) return;
      setPaired(Boolean(config?.serverUrl));
      if (!config) return;
      try {
        const health = await client.getHealth();
        if (alive) setReadOnly(health?.allowWrite === false);
      } catch {
        if (alive) setReadOnly(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const clearPairing = useCallback(async () => {
    await client.signOut();
    setPaired(false);
    setMessage('已清除配对信息，请到「终端」页重新添加');
  }, []);

  return (
    <ScrollView
      className="flex-1 bg-transparent"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: 120, gap: 10 }}
      showsVerticalScrollIndicator={false}>
      <Text className="pb-[6px] text-[28px] font-bold text-[#1C1C1E]">设置</Text>

      <Text className="mb-2 text-[13px] font-semibold uppercase tracking-[0.6px] text-[#8E8E93]">连接</Text>
      <Card className="gap-2 p-4">
        <Text className="text-[15px] font-semibold text-[#1C1C1E]">当前服务</Text>
        <Text className="text-[14px] text-[#8E8E93]">{paired ? '已配对终端' : '未配对'}</Text>
        <Text className="text-[12px] leading-[18px] text-[#8E8E93]">
          访问码将作为 x-access-token 请求头发送，只保存在本机。
        </Text>
      </Card>

      <Text className="mb-2 text-[13px] font-semibold uppercase tracking-[0.6px] text-[#8E8E93]">权限</Text>
      <Card className="gap-2 p-4">
        <Text className="text-[15px] font-semibold text-[#1C1C1E]">{readOnly ? '只读模式' : '写入权限'}</Text>
        <Text className="text-[12px] leading-[18px] text-[#8E8E93]">
          {readOnly
            ? '服务端处于只读模式，发送、中断、审批已禁用。'
            : '可发送消息、中断运行中的任务，并处理待审批项。'}
        </Text>
      </Card>

      <Text className="mb-2 text-[13px] font-semibold uppercase tracking-[0.6px] text-[#8E8E93]">关于</Text>
      <Card className="gap-2 p-4">
        <Text className="text-[15px] font-semibold text-[#1C1C1E]">会话总控 · 原生版</Text>
        <Text className="text-[12px] leading-[18px] text-[#8E8E93]">
          浅色界面，中文优先。终端与会话数据均来自本机服务，不经过云端账号。
        </Text>
        <Text className="text-[12px] leading-[18px] text-[#8E8E93]">版本 1.19.0-native</Text>
      </Card>

      <Button variant="secondary" onPress={() => void clearPairing()}>
        <Text className="text-[15px] font-semibold text-[#1C1C1E]">清除配对</Text>
      </Button>
      {message ? (
        <View className="py-[6px]">
          <Text className="text-[13px] text-[#248A3D]">{message}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
