import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SymbolView } from '@/components/ui/icon';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NewTaskSheet, type NewTaskSheetHandle } from '@/components/NewTaskSheet';
import { PairingSheet, type PairingSheetHandle } from '@/components/PairingSheet';
import { Card, Text } from '@/components/ui/rnr';
import { OptionA } from '@/constants/optionA';
import { useTerminalSelection } from '@/services/appState';
import type { QRParseResult } from '@/services/pairing';
import { AuthRequiredError, getTurnloomClient } from '@/services/turnloomClient';
import { threadStatusKind, type Thread, type ThreadStatusKind } from '@/services/types';

const client = getTurnloomClient();
type Filter = 'all' | 'running' | 'waiting';
const STATUS: Record<ThreadStatusKind, { label: string; background: string; color: string }> = {
  waiting: { label: '待处理', background: '#FFF1D6', color: '#8A5100' },
  running: { label: '进行中', background: '#E5F1FF', color: '#0065D1' },
  stale: { label: '疑似停滞', background: '#FFF1D6', color: '#8A5100' },
  ended: { label: '已完成', background: '#E4F8E9', color: '#16713A' },
  unknown: { label: '空闲', background: '#EFEFF4', color: '#636366' },
};

function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { terminal, connectionRevision, checking, storageError, reload, connect, health, connectionState, requestAuth } = useTerminalSelection();
  const ownerKey = `${terminal?.id || ''}|${connectionRevision}`;
  const pairingRef = useRef<PairingSheetHandle>(null);
  const newTaskRef = useRef<NewTaskSheetHandle>(null);
  const sequence = useRef(0);
  const loadingMore = useRef(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async (refresh = false) => {
    if (!terminal) return;
    const request = ++sequence.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const result = await client.getThreads({ limit: 100 });
      if (request !== sequence.current) return;
      if (result.status !== 304) {
        setOwnerId(ownerKey);
        setThreads(result.data?.threads || []);
        setNextCursor(result.data?.nextCursor || null);
      }
    } catch (caught) {
      if (request !== sequence.current) return;
      if (caught instanceof AuthRequiredError) requestAuth();
      else setError(caught instanceof Error ? caught.message : '暂时无法加载会话');
    } finally {
      if (request === sequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [terminal?.id, terminal?.serverUrl, terminal?.token, ownerKey, requestAuth]);

  useFocusEffect(useCallback(() => {
    if (terminal) void load();
    return () => { sequence.current += 1; };
  }, [terminal?.id, load]));

  // Dismiss drawers only when the screen actually loses focus, not whenever a
  // data refresh changes `load`'s identity. Re-running the previous combined
  // effect could immediately close a sheet that had just been presented.
  useFocusEffect(useCallback(() => () => {
    newTaskRef.current?.dismiss();
    pairingRef.current?.dismiss();
  }, []));

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore.current || !terminal || ownerId !== ownerKey) return;
    const request = sequence.current;
    loadingMore.current = true;
    try {
      const result = await client.getThreads({ limit: 100, cursor: nextCursor });
      if (request !== sequence.current || result.status === 304) return;
      setThreads((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...(result.data?.threads || []).filter((item) => !ids.has(item.id))];
      });
      setNextCursor(result.data?.nextCursor || null);
    } catch (caught) {
      if (request === sequence.current) setError(caught instanceof Error ? caught.message : '加载更多失败');
    } finally {
      loadingMore.current = false;
    }
  }, [nextCursor, terminal?.id, ownerId, ownerKey]);

  const currentThreads = useMemo(() => ownerId === ownerKey ? threads : [], [ownerId, ownerKey, threads]);

  const visibleThreads = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return currentThreads.filter((thread) => {
      const kind = threadStatusKind(thread.status);
      if (filter === 'running' && kind !== 'running' && kind !== 'stale') return false;
      if (filter === 'waiting' && kind !== 'waiting') return false;
      return !search || [thread.title, thread.preview, thread.project?.name, thread.cwd]
        .some((value) => String(value || '').toLocaleLowerCase().includes(search));
    });
  }, [currentThreads, query, filter]);

  const renderThread = useCallback(({ item }: { item: Thread }) => {
    const status = STATUS[threadStatusKind(item.status)];
    return (
      <Pressable accessibilityRole="button" onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        router.push({ pathname: '/thread/[id]', params: { id: item.id } });
      }} className="active:opacity-80">
        <Card className="gap-[6px] p-[14px]">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-[15px] font-semibold text-[#1C1C1E]" numberOfLines={1}>{item.title || '未命名会话'}</Text>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={18} tintColor="#6D6D72" />
          </View>
          <Text className="text-[13px] leading-[19px] text-[#6D6D72]" numberOfLines={2}>{item.preview || item.project?.name || item.cwd || '暂无预览'}</Text>
          <View className="flex-row items-center gap-2 pt-[2px]">
            <View style={{ backgroundColor: status.background, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: status.color, fontSize: 13, fontWeight: '600' }}>{status.label}</Text>
            </View>
            {item.project?.name ? <Text className="flex-1 text-[13px] text-[#6D6D72]" numberOfLines={1}>{item.project.name}</Text> : <View className="flex-1" />}
            <Text className="text-[13px] text-[#6D6D72]">{item.updatedAtMs ? relativeTime(item.updatedAtMs) : ''}</Text>
          </View>
        </Card>
      </Pressable>
    );
  }, []);

  if (checking) return <View className="flex-1 items-center justify-center"><ActivityIndicator color={OptionA.blue} /></View>;
  if (storageError) return (
    <View className="flex-1 items-center justify-center px-6 gap-4">
      <Text className="text-[16px] font-semibold text-[#1C1C1E]">无法读取电脑连接</Text>
      <Text className="text-center text-[14px] text-[#6D6D72]">{storageError}</Text>
      <Pressable accessibilityRole="button" onPress={() => void reload()} className="min-h-[48px] justify-center rounded-xl bg-[#0065D1] px-6"><Text className="text-white font-semibold">重试</Text></Pressable>
    </View>
  );

  const onPaired = async (result: QRParseResult) => { await connect(result); };
  if (!terminal) return (
    <>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 28, paddingBottom: 32, gap: 16 }}>
        <Text className="text-[13px] font-semibold text-[#6D6D72]">Codex-Turnloom</Text>
        <Text className="text-[30px] font-bold text-[#1C1C1E]">连接电脑</Text>
        <Text className="text-[14px] leading-[21px] text-[#6D6D72]">在电脑端打开配对二维码，用手机扫码连接。</Text>
        <Card className="items-center gap-3 p-5">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-[#E5F1FF]">
            <SymbolView name={{ ios: 'qrcode.viewfinder', android: 'qr_code_scanner', web: 'qr_code_scanner' }} size={26} tintColor="#0065D1" />
          </View>
          <Text className="text-[17px] font-semibold text-[#1C1C1E]">扫码连接电脑</Text>
          <Pressable testID="pair-device" accessibilityRole="button" onPress={() => pairingRef.current?.present()} className="min-h-[48px] w-full items-center justify-center rounded-xl bg-[#0065D1] active:opacity-80">
            <Text className="text-[15px] font-semibold text-white">扫码或手动连接</Text>
          </Pressable>
        </Card>
      </ScrollView>
      <PairingSheet ref={pairingRef} onPaired={onPaired} />
    </>
  );

  return (
    <View className="flex-1">
      <View className="gap-2 px-5 pb-2" style={{ paddingTop: insets.top + 12 }}>
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-[28px] font-bold text-[#1C1C1E]">对话</Text>
          <Pressable testID="new-task" accessibilityRole="button" accessibilityLabel="新建任务" disabled={connectionState !== 'online' || health?.allowWrite === false} onPress={() => newTaskRef.current?.present()} className="min-h-[44px] flex-row items-center gap-1 rounded-xl bg-[#0065D1] px-3 disabled:opacity-40">
            <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={18} tintColor="#FFFFFF" />
            <Text className="text-[14px] font-semibold text-white">新建</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="管理当前电脑" onPress={() => router.push('/(tabs)/monitors')} className="min-h-[44px] flex-row items-center gap-2 self-start pr-3">
          <View className={`h-2 w-2 rounded-full ${connectionState === 'online' ? 'bg-[#248A3D]' : 'bg-[#D70015]'}`} />
          <Text className="text-[13px] text-[#1C1C1E]" numberOfLines={1}>{terminal.machineName || '当前电脑'} · {connectionState === 'online' ? '已连接' : connectionState === 'checking' ? '连接中' : '离线'}</Text>
          <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor="#6D6D72" />
        </Pressable>
        {currentThreads.length ? <TextInput accessibilityLabel="搜索会话" value={query} onChangeText={setQuery} placeholder="搜索会话或项目" placeholderTextColor="#6D6D72" className="min-h-[44px] rounded-xl bg-white px-3 text-[15px] text-[#1C1C1E]" /> : null}
        {currentThreads.length ? <View className="flex-row gap-2">{([{ key: 'all', label: '全部' }, { key: 'running', label: '进行中' }, { key: 'waiting', label: '待处理' }] as const).map((item) => (
          <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected: filter === item.key }} onPress={() => setFilter(item.key)} className={`min-h-[44px] justify-center rounded-xl px-3 ${filter === item.key ? 'bg-[#E5F1FF]' : 'bg-white'}`}>
            <Text className={`text-[13px] font-semibold ${filter === item.key ? 'text-[#0065D1]' : 'text-[#6D6D72]'}`}>{item.label}</Text>
          </Pressable>
        ))}</View> : null}
      </View>
      {error ? <Text accessibilityRole="alert" className="px-5 pb-2 text-[13px] text-[#D70015]">{error}</Text> : null}
      {notice ? <Text className="px-5 pb-2 text-[13px] text-[#0065D1]">{notice}</Text> : null}
      {loading && currentThreads.length === 0 ? <ActivityIndicator color={OptionA.blue} /> : null}
      <FlashList
        data={visibleThreads}
        renderItem={renderThread}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 + insets.bottom, paddingHorizontal: 16 }}
        ItemSeparatorComponent={() => <View className="h-[10px]" />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={OptionA.blue} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={!loading ? <View className="items-center gap-3 py-8"><Text className="text-[15px] font-semibold text-[#1C1C1E]">{error ? '暂时无法加载会话' : query || filter !== 'all' ? '没有匹配的会话' : '暂无会话'}</Text><Pressable accessibilityRole="button" onPress={() => error ? void load(true) : connectionState !== 'online' ? router.push('/(tabs)/monitors') : newTaskRef.current?.present()} className="min-h-[44px] justify-center px-4"><Text className="text-[14px] font-semibold text-[#0065D1]">{error ? '重新加载' : connectionState !== 'online' ? '检查连接' : '新建任务'}</Text></Pressable></View> : null}
      />
      <NewTaskSheet ref={newTaskRef} readOnly={health?.allowWrite === false} onCreated={async (result) => {
        if (result.threadId) router.push({ pathname: '/thread/[id]', params: { id: result.threadId } });
        else { setNotice('任务已提交，请刷新会话列表确认。'); await load(true); }
      }} />
    </View>
  );
}
