import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AgentStepCard } from '@/components/AgentStepCard';
import { ApprovalBottomSheet, type ApprovalSheetHandle } from '@/components/ApprovalBottomSheet';
import { CodeDiffBlock } from '@/components/CodeDiffBlock';
import { ThumbPromptBar, type QueuedItem } from '@/components/ThumbPromptBar';
import { Badge, EmptyState } from '@/components/ui';
import { OptionA } from '@/constants/optionA';
import { useTerminalSelection } from '@/services/appState';
import { conversationCacheKey, readConversationCache, terminalCacheOrigin, writeConversationCache } from '@/services/conversationCache';
import { createRequestGate, createRetryKey } from '@/services/threadGuards';
import { AuthRequiredError, getTurnloomClient, uuid } from '@/services/turnloomClient';
import { approvableMessages, runningTimeLabel, type HostDiffResponse, type Message, type MessagesResponse, type Thread } from '@/services/types';

const client = getTurnloomClient();
const MESSAGE_LIMIT = 60;

type StreamItem = { key: string; message: Message };

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const threadId = String(params.id || '');
  const { terminal, connectionRevision, health, requestAuth } = useTerminalSelection();
  const contextKey = `${terminal?.id || ''}|${connectionRevision}|${threadId}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  const requestGate = useRef(createRequestGate()).current;
  const loadSequence = useRef(0);
  const retryKey = useRef(createRetryKey(uuid)).current;
  const approvalRef = useRef<ApprovalSheetHandle>(null);
  const listRef = useRef<FlashListRef<StreamItem>>(null);
  const threadRef = useRef<Thread | null>(null);
  const initialScroll = useRef(false);
  const [owner, setOwner] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [status, setStatus] = useState<MessagesResponse['status']>({});
  const [diff, setDiff] = useState<HostDiffResponse | null>(null);
  const [diffUnavailable, setDiffUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cached, setCached] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const cacheKey = conversationCacheKey({ origin: terminal ? terminalCacheOrigin(terminal.serverUrl, terminal.id, terminal.cacheVersion) : 'unknown', codexHomeVersion: 'native', threadId, messageLimit: MESSAGE_LIMIT });
  const shownMessages = owner === contextKey ? messages : [];
  const shownStatus = owner === contextKey ? status : {};
  const shownThread = owner === contextKey ? thread : null;
  const busy = Boolean(shownStatus?.thinking || shownStatus?.interactionRequired);
  const readOnly = health?.allowWrite === false;
  const approvals = useMemo(() => approvableMessages(shownMessages), [shownMessages]);
  const timer = runningTimeLabel(shownStatus, now, 'zh');

  const applyMessages = useCallback((response: MessagesResponse, ticket: number) => {
    if (!requestGate.isCurrent(ticket)) return;
    const nextMessages = Array.isArray(response.messages) ? response.messages : [];
    const nextThread = response.thread ?? threadRef.current;
    threadRef.current = nextThread;
    setOwner(contextKey);
    setMessages(nextMessages);
    setThread(nextThread);
    setStatus(response.status || {});
    setCached(false);
    setLoading(false);
    setRefreshing(false);
    setError('');
    void writeConversationCache({ key: cacheKey, savedAtMs: Date.now(), thread: nextThread, messages: response });
  }, [cacheKey, contextKey, requestGate]);

  const load = useCallback(async (refresh = false) => {
    if (!threadId || !terminal) return;
    // A dedicated sequence protects this load's own UI lifecycle. The long poll
    // must never be able to strand the spinner by issuing a requestGate ticket
    // while this call is awaiting a response.
    const sequence = ++loadSequence.current;
    const ticket = requestGate.issue();
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      if (!refresh) {
        const cachedValue = await readConversationCache(cacheKey);
        if (loadSequence.current !== sequence) return;
        if (requestGate.isCurrent(ticket) && cachedValue) {
          threadRef.current = cachedValue.thread;
          setOwner(contextKey);
          setMessages(Array.isArray(cachedValue.messages?.messages) ? cachedValue.messages.messages : []);
          setStatus(cachedValue.messages?.status || {});
          setThread(cachedValue.thread);
          setCached(true);
          setLoading(false);
        }
      }
      if (loadSequence.current !== sequence) return;
      const response = await client.getMessages(threadId, { limit: MESSAGE_LIMIT });
      if (loadSequence.current !== sequence) return;
      applyMessages(response, ticket);
      if (loadSequence.current !== sequence) return;
      const currentContext = contextKey;
      void client.getHostDiff(threadId).then((value) => {
        if (contextRef.current === currentContext) { setDiff(value); setDiffUnavailable(false); }
      }).catch(() => {
        if (contextRef.current === currentContext) { setDiff(null); setDiffUnavailable(true); }
      });
    } catch (caught) {
      if (loadSequence.current !== sequence) return;
      if (caught instanceof AuthRequiredError) requestAuth();
      else setError(caught instanceof Error ? caught.message : '无法加载会话');
    } finally {
      if (loadSequence.current === sequence) { setLoading(false); setRefreshing(false); }
    }
  }, [threadId, terminal?.id, cacheKey, contextKey, applyMessages, requestGate, requestAuth]);

  useFocusEffect(useCallback(() => {
    if (!terminal || !threadId) return undefined;
    const controller = new AbortController();
    let cursor = '';
    initialScroll.current = false;
    threadRef.current = null;
    setDiff(null);
    setDiffUnavailable(false);
    void load();
    const poll = async () => {
      while (!controller.signal.aborted) {
        const startedAt = Date.now();
        try {
          const change = await client.waitForChanges(threadId, { cursor, timeoutMs: 25_000, signal: controller.signal });
          if (controller.signal.aborted) return;
          cursor = change.cursor || cursor;
          if (change.changed) {
            const pollTicket = requestGate.issue();
            const response = await client.getMessages(threadId, { limit: MESSAGE_LIMIT, signal: controller.signal });
            if (!controller.signal.aborted) applyMessages(response, pollTicket);
          }
          if (Date.now() - startedAt < 250) await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (caught) {
          if (controller.signal.aborted) return;
          if (caught instanceof AuthRequiredError) {
            // Keep polling alive while the access-code sheet is up. Exiting here
            // would strand the thread forever after a 401 is recovered, because
            // re-entering the same token does not change any effect dependency.
            requestAuth();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    };
    void poll();
    return () => { controller.abort(); requestGate.invalidate(); loadSequence.current += 1; };
  }, [terminal?.id, terminal?.serverUrl, terminal?.token, connectionRevision, threadId, load, applyMessages, requestGate, requestAuth]));

  useEffect(() => {
    if (!shownStatus?.thinking) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [shownStatus?.thinking]);

  useEffect(() => {
    if (!shownMessages.length || initialScroll.current) return undefined;
    const timerId = setTimeout(() => { listRef.current?.scrollToEnd({ animated: false }); initialScroll.current = true; }, 180);
    return () => clearTimeout(timerId);
  }, [shownMessages.length]);

  const thinkingContent = shownMessages.filter((message) => message.role === 'assistant' && (message.phase === 'thinking' || message.kind === 'thinking')).map((message) => message.content || '').join('\n');
  const terminalContent = shownMessages.filter((message) => message.role === 'tool').map((message) => `${message.title ? `${message.title}\n` : ''}${message.content || ''}`).join('\n');
  const data: StreamItem[] = shownMessages.filter((message) => message.role !== 'tool').map((message, index) => ({ key: `${message.turnId || 'm'}-${message.lineNumber ?? index}-${index}`, message }));

  const renderItem = ({ item }: { item: StreamItem }) => {
    const { message } = item;
    const isUser = message.role === 'user';
    const isInteraction = message.role === 'interaction';
    const role = message.title || (isUser ? '我' : message.role === 'assistant' ? '助手' : isInteraction ? '待处理' : '系统');
    return (
      <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
        <View style={[styles.messageCard, isUser && styles.messageCardUser, isInteraction && styles.messageCardInteraction]}>
          <Text style={styles.messageRole}>{role}</Text>
          <Text style={styles.messageText} selectable>{message.content || ''}</Text>
          {isInteraction && message.canApprove && message.requestId ? (
            <Pressable accessibilityRole="button" accessibilityLabel="查看审批" onPress={() => approvalRef.current?.present(message)} style={({ pressed }) => [styles.approvalLink, pressed && styles.pressed]}>
              <Text style={styles.approvalLinkText}>查看审批</Text>
              <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={OptionA.blue} />
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: shownThread?.title || '会话详情', headerBackTitle: '对话' }} />
      <View style={styles.topRow}>
        <Badge label={shownStatus?.interactionRequired ? '待处理' : shownStatus?.thinking ? '运行中' : '空闲'} tone={busy ? 'blue' : 'neutral'} />
        {readOnly ? <Badge label="只读" tone="neutral" /> : null}
        {cached && owner === contextKey ? <Badge label="缓存" tone="neutral" /> : null}
        {approvals.length ? <Pressable accessibilityRole="button" accessibilityLabel={`${approvals.length} 项待审批`} onPress={() => approvalRef.current?.present(null)} style={styles.approvalButton}><Text style={styles.approvalButtonText}>{approvals.length} 项待审批</Text></Pressable> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {loading && shownMessages.length === 0 ? <ActivityIndicator color={OptionA.blue} /> : null}
      <FlashList
        ref={listRef}
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />}
        ListHeaderComponent={
          <View style={styles.details}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen((value) => !value)} style={styles.detailsButton}>
              <Text style={styles.detailsTitle}>运行详情</Text><Text style={styles.detailsHint}>{timer || (busy ? '运行中' : '空闲')}</Text><SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={20} tintColor={OptionA.inkSoft} />
            </Pressable>
            {detailsOpen ? <View style={styles.detailsContent}>
              <AgentStepCard kind="thinking" title={shownStatus?.thinking ? 'AI 正在思考' : '思考记录'} content={thinkingContent || '暂无思考记录'} status={timer || (shownStatus?.thinking ? '运行中' : '空闲')} />
              <AgentStepCard kind="terminal" content={terminalContent || '暂无终端日志'} />
              <CodeDiffBlock diff={diff} error={diffUnavailable ? '暂时无法读取代码改动，请检查电脑连接' : ''} />
            </View> : null}
          </View>
        }
        ListEmptyComponent={!loading && !error ? <EmptyState title="暂无消息" hint="发送一条指令开始" /> : null}
      />
      <ThumbPromptBar
        key={`${terminal?.id || ''}|${terminal?.serverUrl || ''}|${threadId}`}
        busy={busy}
        readOnly={readOnly}
        sending={sending}
        onSend={async ({ message, mode, images }) => {
          const sendMode = mode ?? (busy ? 'queue' : 'start');
          const clientRequestId = retryKey.get({ threadId: contextKey, message, mode: sendMode, images });
          setSending(true);
          setNotice('');
          try {
            const result = await client.sendMessage({ message, threadId, mode: sendMode, clientRequestId, ...(images?.length ? { images } : {}) });
            if (result.ok === false) throw new Error('发送失败，请重试');
            retryKey.clear();
            if (result.uncertain) setNotice('已提交，等待电脑确认；请先刷新，不要重复发送。');
            await load(true);
          } finally {
            setSending(false);
          }
        }}
        onInterrupt={async () => { await client.interrupt(threadId); await load(true); }}
        queueLength={shownStatus?.queueLength ?? 0}
        queuedMessages={Array.isArray(shownStatus?.queuedMessages) ? shownStatus.queuedMessages as QueuedItem[] : []}
        onQueueAction={async (action, itemId) => { if (action === 'steer') await client.steerQueuedSend(threadId, itemId); else await client.cancelQueuedSend(threadId, itemId); await load(true); }}
        onClearQueue={async () => { await client.cancelQueuedSend(threadId); await load(true); }}
      />
      <ApprovalBottomSheet ref={approvalRef} threadId={threadId} requests={approvals} readOnly={readOnly} onResolved={() => load(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OptionA.canvas },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6, minHeight: 44 },
  approvalButton: { marginLeft: 'auto', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#E4F8E9' },
  approvalButtonText: { fontSize: 13, fontWeight: '600', color: '#16713A' },
  error: { fontSize: 13, color: OptionA.redInk, paddingHorizontal: 16, paddingBottom: 6 },
  notice: { fontSize: 13, color: '#0065D1', paddingHorizontal: 16, paddingBottom: 6 },
  details: { marginBottom: 10 },
  detailsButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: OptionA.fill, borderRadius: 12, paddingHorizontal: 12 },
  detailsTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: OptionA.ink },
  detailsHint: { fontSize: 13, color: OptionA.inkSoft },
  detailsContent: { gap: 8, paddingTop: 8 },
  messageRow: { alignItems: 'flex-start' },
  messageRowUser: { alignItems: 'flex-end' },
  messageCard: { maxWidth: '92%', backgroundColor: OptionA.card, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: OptionA.separator, padding: 12, gap: 4 },
  messageCardUser: { backgroundColor: '#E5F1FF' },
  messageCardInteraction: { backgroundColor: '#FFF8E5' },
  messageRole: { fontSize: 12, fontWeight: '700', color: OptionA.inkSoft },
  messageText: { fontSize: 15, lineHeight: 22, color: OptionA.ink },
  approvalLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  approvalLinkText: { color: '#0065D1', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
