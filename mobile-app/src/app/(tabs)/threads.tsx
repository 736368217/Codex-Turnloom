/**
 * 「会话」Tab：真实会话列表（由 index.tsx 迁入）。
 * 高频的「切换对话」一次点击直达；所有数据来自验证过的 API 客户端，不伪造。
 */
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { Badge, EmptyState, PressableCard } from '@/components/ui';
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

const STATUS_TONE = {
  waiting: 'green',
  running: 'blue',
  stale: 'neutral',
  ended: 'neutral',
  unknown: 'blue',
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
        <PressableCard
          accessibilityRole="button"
          onPress={() => {
            void Haptics.selectionAsync();
            router.push({ pathname: '/thread/[id]', params: { id: item.id } });
          }}
          style={styles.threadCard}>
          <View style={styles.threadRow}>
            <Text style={styles.threadTitle} numberOfLines={1}>
              {item.title || '未命名会话'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
          <Text style={styles.threadPreview} numberOfLines={2}>
            {item.preview || item.project?.name || item.cwd || '暂无预览'}
          </Text>
          <View style={styles.threadFooter}>
            <Badge label={STATUS_LABEL[kind]} tone={STATUS_TONE[kind]} />
            {item.status?.interactionRequired ? <Badge label="待合并" tone="green" /> : null}
            <Text style={styles.threadMeta}>
              {item.updatedAtMs ? relativeTime(item.updatedAtMs) : `#${index + 1}`}
            </Text>
          </View>
        </PressableCard>
      );
    },
    []
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.heading, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>会话</Text>
        <Text style={styles.subtitle}>选择一个对话，查看实时任务流</Text>
      </View>
      {authGate ? <Text style={styles.error}>需要访问码，请到「终端」页重新输入</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && threads.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={OptionA.blue} />
        </View>
      ) : null}
      <FlashList
        data={threads}
        renderItem={renderThread}
        keyExtractor={(item, index) => item.id || `thread-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 112 + insets.bottom, paddingHorizontal: 16 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              title={error ? '暂时无法加载会话' : '暂无会话'}
              hint={error ? '下拉刷新重试，或到「终端」页检查连接' : '扫码配对或新建任务后，这里会显示真实会话'}
            />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OptionA.canvas },
  heading: { paddingHorizontal: 16, paddingBottom: 10, gap: 3 },
  title: { fontSize: 28, fontWeight: '700', color: OptionA.ink },
  subtitle: { fontSize: 13, color: OptionA.inkSoft },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { fontSize: 12, color: OptionA.redInk, paddingHorizontal: 16, paddingBottom: 6 },
  threadCard: { padding: 14, gap: 6 },
  threadRow: { flexDirection: 'row', alignItems: 'center' },
  threadTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: OptionA.ink },
  chevron: { fontSize: 20, color: OptionA.inkSoft, marginLeft: 8 },
  threadPreview: { fontSize: 13, lineHeight: 18, color: OptionA.inkSoft },
  threadFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  threadMeta: { marginLeft: 'auto', fontSize: 12, color: OptionA.inkSoft },
});
