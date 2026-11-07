/**
 * 「会话」Tab：真实会话列表。v5 改用 NativeWind className +
 * React Native Reusables 复制式 Card/Text/Badge 组件。
 */
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { Badge, Card, Text } from '@/components/ui/rnr';
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

export default function ThreadsScreen() {
  const insets = useSafeAreaInsets();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [authGate, setAuthGate] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
      return undefined;
    }, [load])
  );

  useEffect(() => client.onAuthRequired(() => setAuthGate(true)), []);

  const renderThread = useCallback(
    ({ item, index }: { item: Thread; index: number }) => {
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
    },
    []
  );

  return (
    <View className="flex-1 bg-transparent">
      <View className="gap-[3px] px-5 pb-[12px]" style={{ paddingTop: insets.top + 12 }}>
        <Text className="text-[11px] font-bold uppercase tracking-[2px] text-[#8E8E93]">Codex-Turnloom</Text>
        <Text className="text-[30px] font-bold leading-[34px] tracking-[-1px] text-[#1C1C1E]">会话总控</Text>
        <Text className="text-[12px] text-[#8E8E93]">项目管理 · 全部历史对话</Text>
      </View>
      {authGate ? <Text className="px-4 pb-[6px] text-[12px] text-[#D70015]">需要访问码，请到「终端」页重新输入</Text> : null}
      {error ? <Text className="px-4 pb-[6px] text-[12px] text-[#D70015]">{error}</Text> : null}
      {loading && threads.length === 0 ? (
        <View className="items-center justify-center p-6">
          <ActivityIndicator color={OptionA.blue} />
        </View>
      ) : null}
      <FlashList
        data={threads}
        renderItem={renderThread}
        keyExtractor={(item, index) => item.id || `thread-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 112 + insets.bottom, paddingHorizontal: 16 }}
        ItemSeparatorComponent={() => <View className="h-[10px]" />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />
        }
        ListEmptyComponent={
          loading ? null : (
            <View className="items-center py-7">
              <Text className="text-[15px] font-semibold text-[#1C1C1E]">
                {error ? '暂时无法加载会话' : '暂无会话'}
              </Text>
              <Text className="mt-2 text-center text-[13px] text-[#8E8E93]">
                {error ? '下拉刷新重试，或到「终端」页检查连接' : '扫码配对或新建任务后，这里会显示真实会话'}
              </Text>
            </View>
          )
        }
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
