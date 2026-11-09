import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PairingSheet, type PairingSheetHandle } from '@/components/PairingSheet';
import { Card, Text } from '@/components/ui/rnr';
import { OptionA } from '@/constants/optionA';
import { DEMO_MODE, useTerminalSelection } from '@/services/appState';
import type { QRParseResult, StoredTerminal } from '@/services/pairing';

export default function TerminalsScreen() {
  const insets = useSafeAreaInsets();
  const { terminals, terminal, connectionState, connect, select, update, remove, refreshHealth } = useTerminalSelection();
  const pairingRef = useRef<PairingSheetHandle>(null);
  const [editingId, setEditingId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); setMessage(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  };
  const beginEdit = (entry: StoredTerminal) => {
    setEditingId(entry.id);
    setConfirmId('');
    setName(entry.machineName);
    setUrl(entry.serverUrl);
    setToken(entry.token);
    setError('');
  };
  const onPaired = async (result: QRParseResult) => {
    await connect(result);
    setMessage('电脑已连接');
    setError('');
  };

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32 + insets.bottom, gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-[28px] font-bold text-[#1C1C1E]">终端</Text>
          <Pressable testID="add-terminal" accessibilityRole="button" accessibilityLabel="添加电脑" disabled={DEMO_MODE || busy} onPress={() => pairingRef.current?.present()} className="min-h-[44px] justify-center rounded-xl bg-[#0065D1] px-4 disabled:opacity-40">
            <Text className="text-[14px] font-semibold text-white">添加</Text>
          </Pressable>
        </View>
        {terminal ? (
          <Card className="gap-3 p-4">
            <View className="flex-row items-center gap-3">
              <View className={`h-[10px] w-[10px] rounded-full ${connectionState === 'online' ? 'bg-[#248A3D]' : 'bg-[#D70015]'}`} />
              <View className="flex-1">
                <Text className="text-[16px] font-semibold text-[#1C1C1E]" numberOfLines={1}>{terminal.machineName || '当前电脑'}</Text>
                <Text className="text-[13px] text-[#6D6D72]">{connectionState === 'online' ? '当前使用 · 已连接' : connectionState === 'checking' ? '正在检查连接' : '当前使用 · 离线'}</Text>
              </View>
              {connectionState === 'checking' ? <ActivityIndicator color={OptionA.blue} /> : null}
            </View>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(refreshHealth, '连接已更新')} className="min-h-[44px] items-center justify-center rounded-xl bg-[#EFEFF4] disabled:opacity-40">
              <Text className="text-[14px] font-semibold text-[#1C1C1E]">测试连接</Text>
            </Pressable>
          </Card>
        ) : null}
        <Text className="text-[13px] font-semibold text-[#6D6D72]">已保存的电脑 · {terminals.length}</Text>
        {terminals.map((entry) => {
          const active = entry.id === terminal?.id;
          return (
            <Card key={entry.id} className="gap-3 p-4">
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Text className="text-[15px] font-semibold text-[#1C1C1E]" numberOfLines={1}>{entry.machineName || '未命名电脑'}</Text>
                  <Text className="text-[13px] text-[#6D6D72]" numberOfLines={1}>{entry.serverUrl}</Text>
                </View>
                {active ? <Text className="text-[13px] font-semibold text-[#16713A]">当前</Text> : (
                  <Pressable accessibilityRole="button" accessibilityLabel={`切换到 ${entry.machineName || '电脑'}`} disabled={busy} onPress={() => void run(() => select(entry.id), '已切换电脑')} className="min-h-[44px] justify-center rounded-xl bg-[#E5F1FF] px-3 disabled:opacity-40"><Text className="text-[13px] font-semibold text-[#0065D1]">切换</Text></Pressable>
                )}
              </View>
              {editingId === entry.id ? (
                <View className="gap-2">
                  <TextInput accessibilityLabel="电脑名称" value={name} onChangeText={setName} placeholder="电脑名称" placeholderTextColor="#6D6D72" editable={!busy} className="min-h-[44px] rounded-xl bg-[#EFEFF4] px-3 text-[15px] text-[#1C1C1E]" />
                  <TextInput accessibilityLabel="服务地址" value={url} onChangeText={setUrl} placeholder="服务地址" placeholderTextColor="#6D6D72" autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} className="min-h-[44px] rounded-xl bg-[#EFEFF4] px-3 text-[15px] text-[#1C1C1E]" />
                  <TextInput accessibilityLabel="访问码" value={token} onChangeText={setToken} placeholder="访问码" placeholderTextColor="#6D6D72" secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} className="min-h-[44px] rounded-xl bg-[#EFEFF4] px-3 text-[15px] text-[#1C1C1E]" />
                  <View className="flex-row gap-2">
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setEditingId('')} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#EFEFF4]"><Text className="font-semibold text-[#1C1C1E]">取消</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(async () => { await update(entry.id, { serverUrl: url, token, machineName: name }); setEditingId(''); setToken(''); }, '电脑信息已保存')} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#0065D1] disabled:opacity-40"><Text className="font-semibold text-white">保存</Text></Pressable>
                  </View>
                </View>
              ) : confirmId === entry.id ? (
                <View className="gap-2">
                  <Text className="text-[13px] text-[#6D6D72]">解除配对只移除这台电脑的连接信息，不删除电脑上的会话。</Text>
                  <View className="flex-row gap-2">
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmId('')} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#EFEFF4]"><Text className="font-semibold text-[#1C1C1E]">取消</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(async () => { await remove(entry.id); setConfirmId(''); }, '已解除配对')} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#FDECEC] disabled:opacity-40"><Text className="font-semibold text-[#D70015]">确认解除</Text></Pressable>
                  </View>
                </View>
              ) : !DEMO_MODE ? (
                <View className="flex-row gap-2">
                  <Pressable accessibilityRole="button" accessibilityLabel={`编辑 ${entry.machineName || '电脑'}`} disabled={busy} onPress={() => beginEdit(entry)} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#EFEFF4]"><Text className="text-[14px] font-semibold text-[#1C1C1E]">编辑</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`解除 ${entry.machineName || '电脑'} 的配对`} disabled={busy} onPress={() => setConfirmId(entry.id)} className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#FDECEC]"><Text className="text-[14px] font-semibold text-[#D70015]">解除配对</Text></Pressable>
                </View>
              ) : null}
            </Card>
          );
        })}
        {!DEMO_MODE ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => pairingRef.current?.present()} className="min-h-[48px] items-center justify-center rounded-xl bg-[#0065D1] disabled:opacity-40"><Text className="text-[15px] font-semibold text-white">扫码或手动添加电脑</Text></Pressable> : null}
        {error ? <Text accessibilityRole="alert" className="text-[13px] text-[#D70015]">{error}</Text> : null}
        {message ? <Text className="text-[13px] text-[#16713A]">{message}</Text> : null}
      </ScrollView>
      <PairingSheet ref={pairingRef} onPaired={onPaired} />
    </View>
  );
}
