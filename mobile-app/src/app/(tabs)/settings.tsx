import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Text } from '@/components/ui/rnr';
import { DEMO_MODE, useTerminalSelection } from '@/services/appState';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { terminal, health, connectionState, requestAuth, refreshHealth, remove } = useTerminalSelection();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reconnect = async () => {
    setError('');
    try { await refreshHealth(); setMessage('连接已更新'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '连接失败'); }
  };
  const unpair = async () => {
    if (!terminal || pending) return;
    setPending(true);
    setError('');
    try {
      await remove(terminal.id);
      setConfirming(false);
      router.replace('/(tabs)/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '解除配对失败');
    } finally {
      setPending(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32 + insets.bottom, gap: 12 }} showsVerticalScrollIndicator={false}>
      <Text className="text-[28px] font-bold text-[#1C1C1E]">设置</Text>
      <Text className="text-[13px] font-semibold text-[#6D6D72]">当前电脑</Text>
      <Card className="gap-1 p-4">
        <Text className="text-[16px] font-semibold text-[#1C1C1E]">{terminal?.machineName || '未连接电脑'}</Text>
        <Text className="text-[13px] text-[#6D6D72]">{connectionState === 'online' ? '已连接' : connectionState === 'checking' ? '正在连接' : '离线'}</Text>
        <Pressable accessibilityRole="button" disabled={!terminal || DEMO_MODE} onPress={requestAuth} className="min-h-[44px] justify-center border-t border-[#E5E5EA] mt-2 disabled:opacity-40"><Text className="text-[14px] font-semibold text-[#0065D1]">修改访问码</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!terminal} onPress={() => void reconnect()} className="min-h-[44px] justify-center border-t border-[#E5E5EA] disabled:opacity-40"><Text className="text-[14px] font-semibold text-[#0065D1]">重新连接</Text></Pressable>
      </Card>
      <Text className="text-[13px] font-semibold text-[#6D6D72]">权限</Text>
      <Card className="gap-1 p-4">
        <Text className="text-[15px] font-semibold text-[#1C1C1E]">{health ? health.allowWrite === false ? '只读模式' : '可发送与审批' : '尚未确认'}</Text>
        <Text className="text-[13px] text-[#6D6D72]">{health ? '权限由当前电脑的服务端决定。' : '连接电脑后显示当前权限。'}</Text>
      </Card>
      <Text className="text-[13px] font-semibold text-[#6D6D72]">关于</Text>
      <Card className="gap-1 p-4">
        <Text className="text-[15px] font-semibold text-[#1C1C1E]">Codex-Turnloom · 原生版</Text>
        <Text className="text-[13px] text-[#6D6D72]">配置版本 {Constants.expoConfig?.version || '未知'}；安装版本以系统应用信息为准。</Text>
      </Card>
      {!DEMO_MODE && terminal ? confirming ? (
        <Card className="gap-2 p-4">
          <Text className="text-[14px] text-[#1C1C1E]">解除 {terminal.machineName || '当前电脑'} 的配对？</Text>
          <Text className="text-[13px] text-[#6D6D72]">只删除本机连接信息，不影响电脑上的会话。</Text>
          <View className="flex-row gap-2">
            <Pressable accessibilityRole="button" disabled={pending} onPress={() => setConfirming(false)} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#EFEFF4]"><Text className="font-semibold text-[#1C1C1E]">取消</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={pending} onPress={() => void unpair()} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#FDECEC]"><Text className="font-semibold text-[#D70015]">确认解除</Text></Pressable>
          </View>
        </Card>
      ) : <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} className="min-h-[48px] items-center justify-center rounded-xl bg-white"><Text className="text-[14px] font-semibold text-[#D70015]">解除这台电脑的配对</Text></Pressable> : null}
      {error ? <Text accessibilityRole="alert" className="text-[13px] text-[#D70015]">{error}</Text> : null}
      {message ? <Text className="text-[13px] text-[#16713A]">{message}</Text> : null}
    </ScrollView>
  );
}
