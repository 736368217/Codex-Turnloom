/**
 * Thread detail / live remote-control screen.
 *
 * Data flow:
 *  - load(): GET /api/health + GET /api/threads/:id/messages (cached first for
 *    weak-network instant open, then network) and GET /api/host/diff.
 *  - poll loop: GET /api/threads/:id/changes?timeout=25000&cursor=... and ONLY
 *    when `changed === true` re-fetch messages, then update cursor.
 *  - sends via POST /api/send with a fresh clientRequestId; interrupt via
 *    POST /api/interrupt; approvals via the bottom sheet (POST /api/approval).
 */
import { FlashList } from '@shopify/flash-list';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { AgentStepCard } from '@/components/AgentStepCard';
import { ApprovalBottomSheet, type ApprovalSheetHandle } from '@/components/ApprovalBottomSheet';
import { CodeDiffBlock } from '@/components/CodeDiffBlock';
import { ThumbPromptBar } from '@/components/ThumbPromptBar';
import { Badge, Card, EmptyState } from '@/components/ui';
import {
  conversationCacheKey,
  isConversationCacheFresh,
  readConversationCache,
  writeConversationCache,
} from '@/services/conversationCache';
import {
  AuthRequiredError,
  getTurnloomClient,
  ReadOnlyError,
} from '@/services/turnloomClient';
import {
  approvableMessages,
  runningTimeLabel,
  type HostDiffResponse,
  type Message,
  type MessagesResponse,
  type Thread,
} from '@/services/types';

const client = getTurnloomClient();
const MESSAGE_LIMIT = 60;

type StreamItem =
  | { kind: 'message'; key: string; message: Message; index: number }
  | { kind: 'thinking'; key: string }
  | { kind: 'terminal'; key: string }
  | { kind: 'diff'; key: string };

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const threadId = String(params.id || '');
  const insets = useSafeAreaInsets();
  const approvalRef = useRef<ApprovalSheetHandle>(null);
  const pollController = useRef<AbortController | null>(null);
  const cursorRef = useRef<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [status, setStatus] = useState<MessagesResponse['status']>({});
  const [diff, setDiff] = useState<HostDiffResponse | null>(null);
  const [diffError, setDiffError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [authGate, setAuthGate] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [cached, setCached] = useState(false);

  const cacheKey = conversationCacheKey({
    origin: client.getConfig()?.serverUrl || 'unknown',
    codexHomeVersion: 'native',
    threadId,
    messageLimit: MESSAGE_LIMIT,
  });

  const applyMessages = useCallback(
    async (response: MessagesResponse, persist: boolean) => {
      const nextMessages = Array.isArray(response?.messages) ? response.messages : [];
      setMessages(nextMessages);
      setStatus(response?.status || {});
      if (response?.thread) setThread(response.thread);
      setCached(false);
      if (persist) {
        await writeConversationCache({
          key: cacheKey,
          savedAtMs: Date.now(),
          thread: response.thread ?? thread,
          messages: response,
        });
      }
    },
    [cacheKey, thread]
  );

  const load = useCallback(
    async (isRefresh = false) => {
      if (!threadId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      // Weak-network instant open from local cache.
      if (!isRefresh) {
        const snapshot = await readConversationCache(cacheKey);
        if (snapshot) {
          setMessages(Array.isArray(snapshot.messages?.messages) ? snapshot.messages.messages : []);
          setStatus(snapshot.messages?.status || {});
          setThread(snapshot.thread);
          setCached(true);
          setLoading(false);
        }
      }

      try {
        await client.load();
        const health = await client.getHealth();
        setReadOnly(health?.allowWrite === false);
        const response = await client.getMessages(threadId, { limit: MESSAGE_LIMIT });
        await applyMessages(response, true);
        setAuthGate(false);

        // Diff is a separate host endpoint; never guessed from message text.
        try {
          const hostDiff = await client.getHostDiff(threadId);
          setDiff(hostDiff);
          setDiffError('');
        } catch (caught) {
          setDiff(null);
          setDiffError(caught instanceof Error ? caught.message : String(caught));
        }
      } catch (caught) {
        if (caught instanceof AuthRequiredError) setAuthGate(true);
        else setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [threadId, cacheKey, applyMessages]
  );

  /** Long-poll loop. Only `changed === true` triggers a message re-fetch. */
  const startPolling = useCallback(() => {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    cursorRef.current = '';

    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          const result = await client.waitForChanges(threadId, {
            cursor: cursorRef.current,
            timeoutMs: 25_000,
            signal: controller.signal,
          });
          cursorRef.current = result.cursor || cursorRef.current;
          if (result.changed) {
            const response = await client.getMessages(threadId, {
              limit: MESSAGE_LIMIT,
              signal: controller.signal,
            });
            await applyMessages(response, true);
          }
        } catch (caught) {
          if (controller.signal.aborted) return;
          if (caught instanceof AuthRequiredError) {
            setAuthGate(true);
            return;
          }
          // Transient network error: back off before the next long poll.
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    };
    void run();
  }, [threadId, applyMessages]);

  useEffect(() => {
    void load();
    startPolling();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      pollController.current?.abort();
    };
  }, [load, startPolling]);

  useEffect(() => client.onAuthRequired(() => setAuthGate(true)), []);

  const busy = Boolean(status?.thinking || status?.queueLength || status?.interactionRequired);
  const approvals = approvableMessages(messages);
  const timer = runningTimeLabel(status, now, 'zh');

  const thinkingContent = messages
    .filter((message) => message.role === 'assistant' && message.phase === 'commentary')
    .map((message) => message.content || '')
    .join('\n');
  const terminalContent = messages
    .filter((message) => message.role === 'tool' || message.role === 'notice')
    .map((message) => `${message.title ? `${message.title}\n` : ''}${message.content || ''}`)
    .join('\n');

  const data: StreamItem[] = [
    { kind: 'thinking', key: 'thinking' },
    { kind: 'terminal', key: 'terminal' },
    { kind: 'diff', key: 'diff' },
    ...messages.map((message, index) => ({
      kind: 'message' as const,
      key: `${message.turnId || 'm'}-${message.lineNumber ?? index}-${index}`,
      message,
      index,
    })),
  ];

  const renderItem = ({ item }: { item: StreamItem }) => {
    if (item.kind === 'thinking') {
      return (
        <View style={styles.block}>
          <AgentStepCard
            kind="thinking"
            content={thinkingContent || '等待代理思考输出…'}
            status={timer || (busy ? '运行中' : '空闲')}
          />
        </View>
      );
    }
    if (item.kind === 'terminal') {
      return (
        <View style={styles.block}>
          <AgentStepCard kind="terminal" content={terminalContent || '暂无终端日志'} />
        </View>
      );
    }
    if (item.kind === 'diff') {
      return (
        <View style={styles.block}>
          <CodeDiffBlock diff={diff} error={diffError} />
        </View>
      );
    }
    const { message } = item;
    const isUser = message.role === 'user';
    const isInteraction = message.role === 'interaction';
    return (
      <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
        <View style={[styles.messageCard, isUser && styles.messageCardUser, isInteraction && styles.messageCardInteraction]}>
          <Text style={styles.messageRole}>{message.title || message.role}</Text>
          <Text style={styles.messageText} selectable>
            {message.content || ''}
          </Text>
          {isInteraction && message.canApprove && message.requestId ? (
            <Pressable
              onPress={() => approvalRef.current?.present(message)}
              style={({ pressed }) => [styles.approvalLink, pressed && styles.pressed]}>
              <Text style={styles.approvalLinkText}>打开审批抽屉</Text>
              <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={13} tintColor="#007AFF" />
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: 96 + insets.top }]}>
      <Stack.Screen options={{ title: thread?.title || '会话详情' }} />

      <View style={styles.topRow}>
        <Badge label={busy ? '运行中' : '空闲'} tone={busy ? 'blue' : 'neutral'} />
        {readOnly ? <Badge label="只读模式" tone="neutral" /> : null}
        {cached ? <Badge label="缓存" tone="neutral" /> : null}
        {approvals.length ? (
          <Pressable onPress={() => approvalRef.current?.present(null)} style={styles.approvalButton}>
            <Text style={styles.approvalButtonText}>{approvals.length} 项待审批</Text>
          </Pressable>
        ) : null}
      </View>

      {authGate ? (
        <Card style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>需要访问码</Text>
          <Text style={styles.noticeText}>服务器返回 401，请在「设置」或扫码抽屉重新输入访问码</Text>
        </Card>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && messages.length === 0 ? <ActivityIndicator color={OptionA.blue} /> : null}
      {!loading && !error && messages.length === 0 ? (
        <EmptyState title="暂无消息" hint="发送一条指令开始，或下拉刷新" />
      ) : null}

      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />
        }
      />

      <ThumbPromptBar
        busy={busy}
        readOnly={readOnly}
        sending={sending}
        onSend={async (message) => {
          setSending(true);
          setError('');
          try {
            await client.sendMessage({ message, threadId, mode: busy ? 'queue' : 'start' });
            await load(true);
            startPolling();
          } catch (caught) {
            if (caught instanceof ReadOnlyError || caught instanceof AuthRequiredError) throw caught;
            setError(caught instanceof Error ? caught.message : String(caught));
          } finally {
            setSending(false);
          }
        }}
        onInterrupt={async () => {
          try {
            await client.interrupt(threadId);
            await load(true);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}
      />

      <ApprovalBottomSheet
        ref={approvalRef}
        threadId={threadId}
        requests={approvals}
        readOnly={readOnly}
        onResolved={async () => {
          await load(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: OptionA.canvas,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  approvalButton: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(52,199,89,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  approvalButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: OptionA.greenInk,
  },
  noticeCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    gap: 4,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OptionA.ink,
  },
  noticeText: {
    fontSize: 12,
    color: OptionA.inkSoft,
  },
  error: {
    fontSize: 13,
    color: OptionA.redInk,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  block: {
    marginBottom: 2,
  },
  messageRow: {
    alignItems: 'flex-start',
  },
  messageRowUser: {
    alignItems: 'flex-end',
  },
  messageCard: {
    maxWidth: '92%',
    backgroundColor: OptionA.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
    padding: 10,
    gap: 4,
  },
  messageCardUser: {
    backgroundColor: '#E5F1FF',
  },
  messageCardInteraction: {
    backgroundColor: '#FFF8E5',
  },
  messageRole: {
    fontSize: 11,
    fontWeight: '700',
    color: OptionA.inkSoft,
    textTransform: 'uppercase',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    color: OptionA.ink,
  },
  approvalLink: {
    paddingTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  approvalLinkText: {
    color: OptionA.blue,
    fontSize: 13,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
