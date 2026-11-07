/**
 * 「对话」Tab（默认首屏）：先选终端 → 开始聊天。
 * 顶部只有一行「终端名 + 状态点 + 管理入口」；会话列表已迁到 threads Tab，
 * 扫码/新增/引擎/修改全部收进 monitors（终端）Tab，首屏不再有低频按钮。
 * 中部为聊天/任务流主区，底部为拇指输入舱（含红色「中断」）。
 */
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
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
import { EmptyState, PrimaryButton } from '@/components/ui';
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
    <View style={pickerStyles.wrap}>
      <Text style={pickerStyles.title}>选择终端</Text>
      <Text style={pickerStyles.hint}>选好之后直接进入聊天，之后可在「终端」页随时修改或切换。</Text>
      {BUILTIN_TERMINALS.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => onChoose({ ...item })}
          style={({ pressed }) => [pickerStyles.row, pressed && pickerStyles.pressed]}>
          <View style={pickerStyles.dot} />
          <View style={pickerStyles.copy}>
            <Text style={pickerStyles.name}>{item.name}</Text>
            <Text style={pickerStyles.url} numberOfLines={1}>
              {item.url}
            </Text>
          </View>
          <Text style={pickerStyles.chevron}>›</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/monitors')}
        style={({ pressed }) => [pickerStyles.textButton, pressed && pickerStyles.pressed]}>
        <Text style={pickerStyles.textButtonLabel}>扫码添加其他终端</Text>
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
      <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
        <View style={[styles.messageCard, isUser && styles.messageCardUser]}>
          <Text style={styles.messageRole}>{item.title || (isUser ? '我' : '代理')}</Text>
          <Text style={styles.messageText} selectable>
            {item.content || ''}
          </Text>
          <Text style={styles.messageIndex}>#{index + 1}</Text>
        </View>
      </View>
    );
  }, []);

  if (checking) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={OptionA.blue} />
      </View>
    );
  }

  if (!terminal) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.pickerContent}>
        <TerminalPicker onChoose={(option) => void handleChoose(option)} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      {/* 顶部：一行终端状态 + 一个管理入口，没有扫码/新建/分段器/状态大胶囊。 */}
      <View style={[styles.topRow, { paddingTop: insets.top + 8 }]}>
        <Animated.View style={[styles.statusDot, pulseStyle]} />
        <Text style={styles.terminalName} numberOfLines={1}>
          {machineName || terminal.name}
        </Text>
        <Text style={styles.statusLabel} numberOfLines={1}>
          {connected ? '已连接' : '离线'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="管理终端"
          onPress={() => router.push('/(tabs)/monitors')}
          style={({ pressed }) => [styles.manageButton, pressed && styles.pressed]}>
          <Text style={styles.manageLabel}>管理</Text>
        </Pressable>
      </View>

      {authGate ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>需要访问码，请到「终端」页重新输入</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/monitors')}>
            <Text style={styles.noticeLink}>去处理 ›</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && messages.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={OptionA.blue} />
        </View>
      ) : null}

      {/* 中部聊天主区：flex:1 占满可用高度，是首屏主角。 */}
      <View style={styles.chatArea}>
        <FlashList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item, index) => `${item.turnId || 'm'}-${item.lineNumber ?? index}-${index}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.chatContent}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />
          }
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                title={error ? '暂时无法加载消息' : '还没有消息'}
                hint={error ? '下拉刷新重试，或到「终端」页检查连接' : '在下方输入指令开始聊天，或到「会话」页选择已有对话'}
              />
            )
          }
        />
      </View>

      {/* 底部拇指舱：快捷胶囊 + 输入 + 发送 / 红色中断。 */}
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
        onQuickPrompt={(prompt) => void prompt}
      />

      {/* 无会话时的兜底引导按钮位于聊天空态之后，不是首屏常驻低频按钮。 */}
      {!loading && !messages.length && !error ? (
        <PrimaryButton label="从会话列表选择" tone="neutral" onPress={() => router.push('/(tabs)/threads')} style={styles.fallbackButton} />
      ) : null}
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  wrap: { gap: 12, paddingTop: 12 },
  title: { fontSize: 28, fontWeight: '700', color: OptionA.ink },
  hint: { fontSize: 13, lineHeight: 19, color: OptionA.inkSoft },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    padding: 16,
    borderRadius: 16,
    backgroundColor: OptionA.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
  },
  dot: { width: 9, height: 9, borderRadius: 999, backgroundColor: OptionA.green },
  copy: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: '600', color: OptionA.ink },
  url: { fontSize: 12, color: OptionA.inkSoft },
  chevron: { fontSize: 22, color: OptionA.inkSoft },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 14, fontWeight: '600', color: OptionA.blue },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OptionA.canvas },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  pickerContent: { paddingHorizontal: 20, paddingTop: 72, paddingBottom: 112 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    minHeight: 44,
    backgroundColor: OptionA.canvas,
  },
  statusDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: OptionA.green },
  terminalName: { flex: 1, fontSize: 13, fontWeight: '600', color: OptionA.ink },
  statusLabel: { fontSize: 13, color: OptionA.inkSoft },
  manageButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: OptionA.fill,
  },
  manageLabel: { fontSize: 13, fontWeight: '600', color: OptionA.blue },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: OptionA.fill,
  },
  noticeText: { flex: 1, fontSize: 12, color: OptionA.inkSoft },
  noticeLink: { fontSize: 13, fontWeight: '600', color: OptionA.blue },
  error: { fontSize: 12, color: OptionA.redInk, paddingHorizontal: 16, paddingBottom: 6 },
  chatArea: { flex: 1, minHeight: 0 },
  chatContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  messageRow: { alignItems: 'flex-start' },
  messageRowUser: { alignItems: 'flex-end' },
  messageCard: {
    maxWidth: '88%',
    backgroundColor: OptionA.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
    padding: 10,
    gap: 4,
  },
  messageCardUser: { backgroundColor: '#E5F1FF' },
  messageRole: { fontSize: 11, fontWeight: '700', color: OptionA.inkSoft },
  messageText: { fontSize: 14, lineHeight: 20, color: OptionA.ink },
  messageIndex: { fontSize: 10, color: OptionA.inkSoft, alignSelf: 'flex-end' },
  fallbackButton: { marginHorizontal: 16, marginBottom: 4 },
});
