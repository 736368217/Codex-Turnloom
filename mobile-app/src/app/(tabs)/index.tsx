/**
 * 「对话」Tab（一级页）= 会话列表，微信/QQ 模型。
 *
 * 冷启动未选终端时显示选终端页；已配对后显示真实会话列表，点某条会话
 * 进入全屏聊天详情页 `thread/[id]`（该页不在 Tabs 内，天然无底栏）。
 * 本页不再包含聊天输入舱 —— 聊天只存在于详情页。
 * v5：NativeWind className + React Native Reusables 复制式组件。
 */
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { NewThreadSheet, type ProjectOption } from '@/components/OptionASheets';
import { Badge, Card, Text } from '@/components/ui/rnr';
import {
  useTerminalSelection,
  type TerminalOption,
} from '@/services/appState';
import { savePairing } from '@/services/pairing';
import { getTurnloomClient, AuthRequiredError } from '@/services/turnloomClient';
import { threadStatusKind, type Thread } from '@/services/types';

const client = getTurnloomClient();

const STATUS_LABEL = {
  waiting: '待处理',
  running: '进行中',
  stale: '已停滞',
  ended: '已完成',
  unknown: '进行中',
} as const;

const BADGE_VARIANT = {
  waiting: 'default',
  running: 'default',
  stale: 'secondary',
  ended: 'secondary',
  unknown: 'default',
} as const;

/** 冷启动：品牌大标题 + 「这是什么/要做什么」说明 + 引导卡 + 两个明确按钮。 */
function TerminalPicker({ onChoose }: { onChoose: (option: TerminalOption) => void }) {
  return (
    <View className="gap-3 pt-3">
      <Text className="text-[11px] font-bold uppercase tracking-[2px] text-[#8E8E93]">Codex-Turnloom</Text>
      <Text className="text-[30px] font-bold leading-[34px] tracking-[-1px] text-[#1C1C1E]">会话总控</Text>
      <Text className="text-[13px] leading-[20px] text-[#8E8E93]">
        在手机上远程查看并指挥电脑端代理。先选一台要连接的电脑，之后即可收发指令、查看改动与审批。
      </Text>

      <View className="mt-3 rounded-[20px] border border-white/90 bg-white/90 p-4">
        <Text className="text-[14px] font-semibold text-[#1C1C1E]">选择要连接的电脑</Text>
        <Text className="mt-1 text-[12px] leading-[18px] text-[#8E8E93]">
          选好后进入会话列表；之后可在「终端」里随时切换或新增。
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/monitors')}
        className="min-h-[48px] items-center justify-center rounded-[16px] bg-[#007AFF] active:opacity-80">
        <Text className="text-[14px] font-semibold text-white">扫码添加其他电脑</Text>
      </Pressable>

      <Text className="pt-6 text-center text-[11px] leading-[17px] text-[#8E8E93]">
        配对码由电脑端 Codex-Turnloom 生成 · 格式为 codexpocket://add?...
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { terminal, checking, choose } = useTerminalSelection();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [authGate, setAuthGate] = useState(false);
  const [query, setQuery] = useState('');

  // 新建会话（可归档到项目）
  const [composeOpen, setComposeOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [composeError, setComposeError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const config = await client.load();
      if (!config) {
        setThreads([]);
        setError('尚未选择终端，请到「终端」页添加');
        return;
      }
      const result = await client.getThreads({ limit: 60 });
      if (result.status !== 304 && result.data?.threads) setThreads(result.data.threads);
      setAuthGate(false);
    } catch (caught) {
      if (caught instanceof AuthRequiredError) setAuthGate(true);
      else setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (terminal) void load(); }, [terminal, load]);
  useFocusEffect(useCallback(() => { if (terminal) void load(true); return undefined; }, [terminal, load]));
  useEffect(() => client.onAuthRequired(() => setAuthGate(true)), []);

  const handleChoose = useCallback(
    async (option: TerminalOption) => {
      try {
        await savePairing({ serverUrl: option.url, token: option.token, machineName: option.name });
        await client.refreshConfig();
        if (option.token) await client.exchangeAuthSession(option.token).catch(() => undefined);
      } catch { /* 配对失败仍进入列表，由错误提示反馈 */ }
      await choose(option);
    },
    [choose],
  );

  /** 会话搜索：本地过滤标题 / 预览 / 项目 / 路径，不发请求、不改服务端顺序。 */
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return threads;
    return threads.filter((item) =>
      [item.title, item.preview, item.project?.name, item.cwd]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [threads, query]);

  const openCompose = useCallback(async () => {
    setComposeOpen(true);
    setComposeError('');
    if (projects.length || projectsLoading) return;
    setProjectsLoading(true);
    try {
      const data = await client.getProjects();
      setProjects(Array.isArray(data?.projects) ? (data.projects as ProjectOption[]) : []);
    } catch (caught) {
      setComposeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProjectsLoading(false);
    }
  }, [projects.length, projectsLoading]);

  const createThread = useCallback(async () => {
    const message = draft.trim();
    if (!message || creating) return;
    setCreating(true);
    setComposeError('');
    try {
      const result = await client.sendMessage({
        message,
        newThread: true,
        ...(projectId ? { projectId } : {}),
      });
      const nextId = String(result?.threadId || '');
      setComposeOpen(false);
      setDraft('');
      setProjectId('');
      await load(true);
      if (nextId) router.push({ pathname: '/thread/[id]', params: { id: nextId } });
    } catch (caught) {
      setComposeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  }, [draft, creating, projectId, load]);

  const renderThread = useCallback(({ item, index }: { item: Thread; index: number }) => {
    const kind = threadStatusKind(item.status);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void Haptics.selectionAsync();
          router.push({ pathname: '/thread/[id]', params: { id: item.id } });
        }}
        className="active:opacity-80">
        <Card className="gap-[6px] p-[14px]">
          <View className="flex-row items-center">
            <Text className="flex-1 text-[15px] font-semibold text-[#1C1C1E]" numberOfLines={1}>
              {item.title || '未命名会话'}
            </Text>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={18} tintColor="#8E8E93" />
          </View>
          <Text className="text-[13px] leading-[18px] text-[#8E8E93]" numberOfLines={2}>
            {item.preview || item.project?.name || item.cwd || '暂无预览'}
          </Text>
          <View className="flex-row items-center gap-2 pt-[2px]">
            <Badge variant={BADGE_VARIANT[kind]}>
              <Text className="text-[12px] font-semibold text-[#007AFF]">{STATUS_LABEL[kind]}</Text>
            </Badge>
            {item.status?.interactionRequired ? (
              <Badge variant="default">
                <Text className="text-[12px] font-semibold text-[#007AFF]">待合并</Text>
              </Badge>
            ) : null}
            <Text className="ml-auto text-[12px] text-[#8E8E93]">
              {item.updatedAtMs ? relativeTime(item.updatedAtMs) : `#${index + 1}`}
            </Text>
          </View>
        </Card>
      </Pressable>
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
      <View className="gap-[3px] px-5 pb-[10px]" style={{ paddingTop: insets.top + 12 }}>
        <Text className="text-[11px] font-bold uppercase tracking-[2px] text-[#8E8E93]">Codex-Turnloom</Text>
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-[30px] font-bold leading-[34px] tracking-[-1px] text-[#1C1C1E]">对话</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="新建会话"
            onPress={() => void openCompose()}
            className="h-11 w-11 items-center justify-center rounded-full bg-[#007AFF] active:opacity-80">
            <SymbolView name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }} size={19} tintColor="#FFFFFF" />
          </Pressable>
        </View>
        <Text className="text-[12px] text-[#8E8E93]">选择一条会话，查看实时任务流并继续指挥</Text>
        <View className="mt-[6px] h-9 flex-row items-center gap-2 rounded-[10px] bg-[#EFEFF4] px-3">
          <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={15} tintColor={OptionA.inkSoft} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索会话标题、预览或项目"
            placeholderTextColor={OptionA.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            className="min-w-0 flex-1 text-[14px] text-[#1C1C1E]"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="清除搜索" onPress={() => setQuery('')} hitSlop={8}>
              <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={16} tintColor={OptionA.inkSoft} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {authGate ? <Text className="px-4 pb-[6px] text-[12px] text-[#D70015]">需要访问码，请到「终端」页重新输入</Text> : null}
      {error ? <Text className="px-4 pb-[6px] text-[12px] text-[#D70015]">{error}</Text> : null}
      {loading && threads.length === 0 ? (
        <View className="items-center justify-center p-6">
          <ActivityIndicator color={OptionA.blue} />
        </View>
      ) : null}
      <FlashList
        data={filtered}
        renderItem={renderThread}
        keyExtractor={(item, index) => item.id || `thread-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 112 + insets.bottom, paddingHorizontal: 16 }}
        ItemSeparatorComponent={() => <View className="h-[10px]" />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />}
        ListEmptyComponent={
          loading ? null : (
            <View className="items-center py-7">
              <Text className="text-[15px] font-semibold text-[#1C1C1E]">
                {query.trim() ? '没有匹配的会话' : error ? '暂时无法加载会话' : '暂无会话'}
              </Text>
              <Text className="mt-2 text-center text-[13px] text-[#8E8E93]">
                {query.trim()
                  ? '换个关键词，或点右上角新建一条会话'
                  : error
                    ? '下拉刷新重试，或到「终端」页检查连接'
                    : '点右上角开始第一条会话'}
              </Text>
            </View>
          )
        }
      />

      <NewThreadSheet
        visible={composeOpen}
        projects={projects}
        projectsLoading={projectsLoading}
        projectId={projectId}
        draft={draft}
        creating={creating}
        error={composeError}
        onChangeDraft={setDraft}
        onSelectProject={setProjectId}
        onCreate={() => void createThread()}
        onClose={() => setComposeOpen(false)}
      />
    </View>
  );
}

function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
