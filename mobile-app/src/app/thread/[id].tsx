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
import * as Haptics from 'expo-haptics';
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
import {
  effortLabel,
  MentionSheet,
  MessageActionSheet,
  ModelEffortSheet,
  type ModelOption,
} from '@/components/OptionASheets';
import { ThumbPromptBar, type QueuedItem } from '@/components/ThumbPromptBar';
import { Badge, Card, EmptyState } from '@/components/ui';
import { copyText } from '@/services/clipboard';
import { composeMessage, type PluginRef, type SkillRef } from '@/services/mentions';
import { readThreadPrefs, writeThreadPrefs } from '@/services/threadPrefs';
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

  // 模型 / 思考强度：目录来自 /api/health 的 models，选择按 threadId 落盘。
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [modelSheet, setModelSheet] = useState(false);

  // 插件 / 技能引用：目录来自 /api/plugins 与 /api/skills。
  const [plugins, setPlugins] = useState<PluginRef[]>([]);
  const [skills, setSkills] = useState<SkillRef[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState('');
  const [mentionSheet, setMentionSheet] = useState(false);
  const [pickedPlugins, setPickedPlugins] = useState<PluginRef[]>([]);
  const [pickedSkills, setPickedSkills] = useState<SkillRef[]>([]);

  // 消息长按 → 复制全文
  const [actionText, setActionText] = useState('');
  const [actionOpen, setActionOpen] = useState(false);
  const [toast, setToast] = useState('');

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
        try {
          await writeConversationCache({
            key: cacheKey,
            savedAtMs: Date.now(),
            thread: response.thread ?? thread,
            messages: response,
          });
        } catch {
          // 缓存只是弱网加速用；写不进去不能影响消息展示与后续步骤。
        }
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

        // 模型目录改由下面的独立 effect 加载：不依赖消息/缓存的成败。

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

  /**
   * 模型目录与「本会话上次选择」独立加载。
   * 之前把它写在 load() 的 try 里，任何一步（消息拉取 / 写缓存）抛错都会整段跳过，
   * 结果就是入口消失、用户以为没有这个功能。现在它自己管自己的失败。
   */
  const modelResolved = useRef(false);
  useEffect(() => {
    if (!threadId) return undefined;
    let alive = true;
    void (async () => {
      try {
        // 必须先 load()：endpoint() 在未配对时会抛「尚未配对电脑节点」，
        // 而这个 effect 可能早于页面 load() 的第一次 await 完成。
        await client.load();
        const health = await client.getHealth();
        if (!alive) return;
        const catalog = Array.isArray(health?.models) ? (health.models as ModelOption[]) : [];
        setModels(catalog);
        if (!modelResolved.current && catalog.length) {
          const prefs = await readThreadPrefs(threadId);
          if (!alive) return;
          const known = catalog.map((entry) => entry.id);
          const threadModel = String(thread?.model || '');
          const nextModel =
            (prefs.model && known.includes(prefs.model) ? prefs.model : '') ||
            (threadModel && known.includes(threadModel) ? threadModel : '') ||
            catalog[0]?.id ||
            '';
          const entry = catalog.find((item) => item.id === nextModel);
          const efforts = entry?.efforts || [];
          const nextEffort =
            (prefs.effort && (!efforts.length || efforts.includes(prefs.effort)) ? prefs.effort : '') ||
            entry?.defaultEffort ||
            efforts[0] ||
            '';
          setModel((current) => current || nextModel);
          setEffort((current) => current || nextEffort);
          modelResolved.current = true;
        }
      } catch {
      }
    })();
    return () => {
      alive = false;
    };
  }, [threadId, thread?.model]);

  /** 首次打开引用抽屉时才拉目录，避免每进一个会话都多两个请求。 */
  const openMention = useCallback(async () => {
    setMentionSheet(true);
    if (mentionLoading || plugins.length || skills.length) return;
    setMentionLoading(true);
    setMentionError('');
    try {
      const [pluginData, skillData] = await Promise.all([
        client.getPlugins().catch(() => ({ plugins: [] })),
        client.getSkills().catch(() => ({ skills: [] })),
      ]);
      const nextPlugins = Array.isArray(pluginData?.plugins) ? (pluginData.plugins as PluginRef[]) : [];
      const nextSkills = Array.isArray(skillData?.skills) ? (skillData.skills as SkillRef[]) : [];
      setPlugins(nextPlugins);
      setSkills(nextSkills);
      if (!nextPlugins.length && !nextSkills.length) setMentionError('服务器没有返回可引用的插件或技能');
    } catch (caught) {
      setMentionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setMentionLoading(false);
    }
  }, [mentionLoading, plugins.length, skills.length]);

  const applyModel = useCallback(
    (modelId: string, level: string) => {
      setModel(modelId);
      setEffort(level);
      setModelSheet(false);
      void writeThreadPrefs(threadId, { model: modelId, effort: level });
    },
    [threadId]
  );

  const togglePlugin = useCallback((plugin: PluginRef) => {
    setPickedPlugins((current) => {
      const key = plugin.uri || plugin.name;
      const exists = current.some((item) => (item.uri || item.name) === key);
      return exists ? current.filter((item) => (item.uri || item.name) !== key) : [...current, plugin];
    });
  }, []);

  const toggleSkill = useCallback((skill: SkillRef) => {
    setPickedSkills((current) => {
      const key = skill.uri || skill.name;
      const exists = current.some((item) => (item.uri || item.name) === key);
      return exists ? current.filter((item) => (item.uri || item.name) !== key) : [...current, skill];
    });
  }, []);

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
        <Pressable
          accessibilityHint="长按可复制全文"
          delayLongPress={350}
          onLongPress={() => {
            void Haptics.selectionAsync();
            setActionText(message.content || '');
            setActionOpen(true);
          }}
          style={({ pressed }) => [
            styles.messageCard,
            isUser && styles.messageCardUser,
            isInteraction && styles.messageCardInteraction,
            pressed && styles.pressed,
          ]}>
          <View style={styles.messageHead}>
            <Text style={styles.messageRole}>{message.title || message.role}</Text>
            {message.content ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="复制这条消息"
                hitSlop={8}
                onPress={() => {
                  void Haptics.selectionAsync();
                  const ok = copyText(message.content || '');
                  setToast(ok ? '已复制全文' : '复制失败：系统剪贴板不可用');
                  setTimeout(() => setToast(''), 1800);
                }}
                style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
                <Text style={styles.copyButtonText}>复制</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.messageText}>
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
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: 96 + insets.top }]}>
      <Stack.Screen options={{ title: thread?.title || '会话详情', headerBackTitle: '会话' }} />

      <View style={styles.topRow}>
        <Badge label={busy ? '运行中' : '空闲'} tone={busy ? 'blue' : 'neutral'} />
        {readOnly ? <Badge label="只读模式" tone="neutral" /> : null}
        {cached ? <Badge label="缓存" tone="neutral" /> : null}
        {/* 入口无条件可见：目录没拉到也要能点开，由抽屉说明「服务器没有返回可用模型」。
            样式写在行内：曾用 StyleSheet key，实机只渲染出文字没有胶囊底色。 */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="选择模型与思考强度"
          onPress={() => setModelSheet(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            maxWidth: 210,
            paddingHorizontal: 9,
            paddingVertical: 5,
            borderRadius: 999,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: OptionA.separator,
            backgroundColor: OptionA.card,
            opacity: pressed ? 0.8 : 1,
          })}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: OptionA.ink }} numberOfLines={1}>
            {(models.find((entry) => entry.id === model)?.label || model || '选择模型') +
              (effort ? ` · ${effortLabel(effort)}` : '')}
          </Text>
          <SymbolView
            name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }}
            size={12}
            tintColor={OptionA.inkSoft}
          />
        </Pressable>
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
        onSend={async ({ message, mode, images }) => {
          setSending(true);
          setError('');
          try {
            // 与原版 composerSendMessage 一致：技能行 + 插件 markdown + 正文。
            const composed = composeMessage({ text: message, plugins: pickedPlugins, skills: pickedSkills });
            if (!composed) throw new Error('请输入消息，或先选择要引用的插件 / 技能');
            await client.sendMessage({
              message: composed,
              threadId,
              mode: mode ?? (busy ? 'queue' : 'start'),
              ...(model ? { model } : {}),
              ...(effort ? { effort } : {}),
              ...(images?.length ? { images } : {}),
            });
            setPickedPlugins([]);
            setPickedSkills([]);
            await load(true);
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
        queueLength={status?.queueLength ?? 0}
        queuedMessages={Array.isArray(status?.queuedMessages) ? (status!.queuedMessages as QueuedItem[]) : []}
        onQueueAction={async (action, itemId) => {
          try {
            if (action === 'steer') await client.steerQueuedSend(threadId, itemId);
            else await client.cancelQueuedSend(threadId, itemId);
            await load(true);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}
        onClearQueue={async () => {
          try {
            await client.cancelQueuedSend(threadId);
            await load(true);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}
        plugins={pickedPlugins}
        skills={pickedSkills}
        onOpenMention={() => void openMention()}
        onRemovePlugin={togglePlugin}
        onRemoveSkill={toggleSkill}
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

      <ModelEffortSheet
        visible={modelSheet}
        models={models}
        model={model}
        effort={effort}
        onApply={applyModel}
        onClose={() => setModelSheet(false)}
      />

      <MentionSheet
        visible={mentionSheet}
        plugins={plugins}
        skills={skills}
        loading={mentionLoading}
        error={mentionError}
        selectedPlugins={pickedPlugins}
        selectedSkills={pickedSkills}
        onTogglePlugin={togglePlugin}
        onToggleSkill={toggleSkill}
        onClose={() => setMentionSheet(false)}
      />

      <MessageActionSheet
        visible={actionOpen}
        preview={actionText}
        onCopy={() => {
          const ok = copyText(actionText);
          setActionOpen(false);
          setToast(ok ? '已复制全文' : '复制失败：系统剪贴板不可用');
          setTimeout(() => setToast(''), 1800);
        }}
        onClose={() => setActionOpen(false)}
      />

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
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
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: 190,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
    backgroundColor: OptionA.card,
  },
  modelChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: OptionA.ink,
  },
  toast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 128,
    alignItems: 'center',
  },
  toastText: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(28,28,30,0.88)',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
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
  messageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  copyButton: {
    marginLeft: 'auto',
    minWidth: 44,
    height: 28,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#EFEFF4',
  },
  copyButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: OptionA.inkSoft,
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
