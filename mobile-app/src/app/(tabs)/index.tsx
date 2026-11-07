/**
 * 「对话」Tab（默认首屏）：先选终端 → 开始聊天。
 * v5：布局改用 NativeWind className；卡片/文字/按钮用 React Native Reusables
 * 复制式组件（src/components/ui/*）；快捷胶囊排已按简报删除。
 */
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { ThumbPromptBar } from '@/components/ThumbPromptBar';
import { Button, Card, Text } from '@/components/ui/rnr';
import {
  BUILTIN_TERMINALS,
  useTerminalSelection,
  type TerminalOption,
} from '@/services/appState';
import { savePairing } from '@/services/pairing';
import { getTurnloomClient, AuthRequiredError } from '@/services/turnloomClient';
import type { Message, MessagesResponse } from '@/services/types';

const client = getTurnloomClient();

/** 轻量冷启动页：不是配对大卡片，只有「选一个终端进入」+ 一个文字入口。 */
function TerminalPicker({ onChoose }: { onChoose: (option: TerminalOption) => void }) {
  return (
    <View className="gap-3 pt-3">
      <Text className="text-[28px] font-bold text-[#1C1C1E]">选择终端</Text>
      <Text className="text-[13px] leading-[19px] text-[#8E8E93]">
        选好之后直接进入聊天，之后可在「终端」页随时修改或切换。
      </Text>
      {BUILTIN_TERMINALS.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => onChoose({ ...item })}
          className="min-h-[68px] flex-row items-center gap-3 rounded-2xl border border-[#E5E5EA] bg-white p-4 active:opacity-80">
          <View className="h-[9px] w-[9px] rounded-full bg-[#34C759]" />
          <View className="flex-1 gap-[3px]">
            <Text className="text-[16px] font-semibold text-[#1C1C1E]">{item.name}</Text>
            <Text className="text-[12px] text-[#8E8E93]" numberOfLines={1}>
              {item.url}
            </Text>
          </View>
          <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={20} tintColor="#8E8E93" />
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/monitors')}
        className="min-h-[44px] items-center justify-center active:opacity-80">
        <Text className="text-[14px] font-semibold text-[#007AFF]">扫码添加其他终端</Text>
      </Pressable>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { terminal, checking, choose } = useTerminalSelection();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<MessagesResponse['status']>({});
  const [threadId, setThreadId] = useState('');
  const [connected, setConnected] = useState(false);
  const [machineName, setMachineName] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [authGate, setAuthGate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const pulse = useSharedValue(0.6);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1400 }), -1, true);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const config = await client.load();
      if (!config) {
        setConnected(false);
        setMessages([]);
        return;
      }
      setMachineName(config.machineName || new URL(config.serverUrl).host);
      const health = await client.getHealth();
      setConnected(Boolean(health?.ok));
      setReadOnly(health?.allowWrite === false);
      const threads = await client.getThreads({ limit: 1 });
      const first = threads.status !== 304 ? threads.data?.threads?.[0] : undefined;
      const id = first?.id || '';
      setThreadId(id);
      if (!id || !/^[0-9a-fA-F-]{20,}$/.test(id)) {
        setMessages([]);
        setStatus({});
        setAuthGate(false);
        return;
      }
      const response = await client.getMessages(id, { limit: 60 });
      setMessages(response.messages || []);
      setStatus(response.status || {});
      setAuthGate(false);
    } catch (caught) {
      if (caught instanceof AuthRequiredError) {
        setAuthGate(true);
        setConnected(false);
      } else {
        setConnected(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (terminal) void load();
  }, [terminal, load]);

  useFocusEffect(
    useCallback(() => {
      if (terminal) void load(true);
      return undefined;
    }, [terminal, load])
  );

  useEffect(() => client.onAuthRequired(() => setAuthGate(true)), []);

  const handleChoose = useCallback(
    async (option: TerminalOption) => {
      try {
        await savePairing({ serverUrl: option.url, token: option.token, machineName: option.name });
        await client.refreshConfig();
        if (option.token) await client.exchangeAuthSession(option.token).catch(() => undefined);
      } catch {
        /* 配对失败仍进入界面，由顶部状态点与错误提示反馈 */
      }
      await choose(option);
    },
    [choose]
  );

  const busy = Boolean(status?.thinking || status?.queueLength || status?.interactionRequired);

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isUser = item.role === 'user';
    return (
      <View className={isUser ? 'items-end' : 'items-start'}>
        <Card
          className={`max-w-[88%] gap-1 p-[12px] ${isUser
            ? 'rounded-[20px] rounded-br-[7px] border-[#007AFF]/20 bg-[#007AFF]'
            : 'rounded-[20px] rounded-bl-[7px] bg-white/95'}`}>
          <Text className={`text-[11px] font-bold ${isUser ? 'text-white/75' : 'text-[#8E8E93]'}`}>
            {item.title || (isUser ? '我' : '代理')}
          </Text>
          <Text className={`text-[14px] leading-5 ${isUser ? 'text-white' : 'text-[#1C1C1E]'}`} selectable>
            {item.content || ''}
          </Text>
          <Text className={`self-end text-[10px] ${isUser ? 'text-white/60' : 'text-[#8E8E93]'}`}>#{index + 1}</Text>
        </Card>
      </View>
    );
  }, []);

  if (checking) {
    return (
      <View className="flex-1 items-center justify-center bg-transparent">
        <ActivityIndicator color={OptionA.blue} />
      </View>
    );
  }

  if (!terminal) {
    return (
      <ScrollView className="flex-1 bg-transparent" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 72, paddingBottom: 112 }}>
        <TerminalPicker onChoose={(option) => void handleChoose(option)} />
      </ScrollView>
    );
  }

  return (
    <View className="flex-1 bg-transparent">
      {/* Option A · iOS 大标题 + 玻璃机器状态栏 */}
      <View className="px-5 pb-3" style={{ paddingTop: insets.top + 10 }}>
        <Text className="text-[11px] font-bold uppercase tracking-[2px] text-[#8E8E93]">
          Codex-Turnloom
        </Text>
        <Text className="mt-1 text-[30px] font-bold leading-[34px] tracking-[-1px] text-[#1C1C1E]">
          会话总控
        </Text>
        <Text className="mt-1 text-[12px] text-[#8E8E93]">
          日光 · 苹果雾白 · 远程指挥你的电脑
        </Text>
        <View className="mt-3 flex-row items-center gap-2 rounded-full border border-white/90 bg-white/60 px-3 py-2">
          <Animated.View className="h-2 w-2 rounded-full bg-[#34C759]" style={pulseStyle} />
          <Text className="flex-1 text-[12px] font-semibold text-[#248A3D]" numberOfLines={1}>
            {connected ? '电脑已连接' : '电脑离线'}
          </Text>
          <Text className="text-[11px] text-[#8E8E93]" numberOfLines={1}>
            {machineName || terminal.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="管理终端"
            onPress={() => router.push('/(tabs)/monitors')}
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/80 px-[10px] active:opacity-80">
            <Text className="text-[13px] font-semibold text-[#007AFF]">管理</Text>
          </Pressable>
        </View>
      </View>

      {authGate ? (
        <Card className="mx-4 mb-[6px] flex-row items-center gap-2 bg-[#EFEFF4] p-[10px]">
          <Text className="flex-1 text-[12px] text-[#8E8E93]">需要访问码，请到「终端」页重新输入</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/monitors')}>
            <Text className="text-[13px] font-semibold text-[#007AFF]">去处理</Text>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={13} tintColor="#007AFF" />
          </Pressable>
        </Card>
      ) : null}
      {error ? <Text className="px-4 pb-[6px] text-[12px] text-[#D70015]">{error}</Text> : null}
      {loading && messages.length === 0 ? (
        <View className="items-center justify-center p-6">
          <ActivityIndicator color={OptionA.blue} />
        </View>
      ) : null}

      {/* 中部聊天主区：flex-1 占满可用高度，是首屏主角。 */}
      <View className="min-h-0 flex-1">
        <FlashList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item, index) => `${item.turnId || 'm'}-${item.lineNumber ?? index}-${index}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />
          }
          ListEmptyComponent={
            loading ? null : (
              <View className="items-center py-7">
                <Text className="text-[15px] font-semibold text-[#1C1C1E]">
                  {error ? '暂时无法加载消息' : '还没有消息'}
                </Text>
                <Text className="mt-2 text-center text-[13px] text-[#8E8E93]">
                  {error ? '下拉刷新重试，或到「终端」页检查连接' : '在下方输入指令开始聊天，或到「会话」页选择已有对话'}
                </Text>
              </View>
            )
          }
        />
      </View>

      {/* 底部拇指舱：输入 + 发送 / 红色中断（无快捷胶囊排）。 */}
      <ThumbPromptBar
        busy={busy}
        readOnly={readOnly}
        sending={sending}
        onSend={async (message) => {
          setSending(true);
          setError('');
          try {
            await client.sendMessage({ message, threadId: threadId || null, mode: busy ? 'queue' : 'start' });
            await load(true);
          } catch (caught) {
            if (caught instanceof AuthRequiredError) throw caught;
            setError(caught instanceof Error ? caught.message : String(caught));
          } finally {
            setSending(false);
          }
        }}
        onInterrupt={async () => {
          if (!threadId) return;
          try {
            await client.interrupt(threadId);
            await load(true);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}
      />

      {/* 无会话时的兜底引导按钮位于聊天空态之后，不是首屏常驻低频按钮。 */}
      {!loading && !messages.length && !error ? (
        <Button variant="secondary" onPress={() => router.push('/(tabs)/threads')} className="mx-4 mb-1">
          <Text className="text-[15px] font-semibold text-[#1C1C1E]">从会话列表选择</Text>
        </Button>
      ) : null}
    </View>
  );
}
