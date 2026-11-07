/**
 * Option A home screen — machine status card, engine segmented control,
 * QR pairing drawer and an iOS inset-grouped FlashList of real threads.
 * All data comes from the verified API client; nothing is fabricated.
 */
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
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
import { GlassTabBar } from '@/components/GlassTabBar';
import { PairingSheet, type PairingSheetHandle } from '@/components/PairingSheet';
import { Badge, Card, EmptyState, PressableCard, PrimaryButton, Separator } from '@/components/ui';
import { getTurnloomClient, AuthRequiredError } from '@/services/turnloomClient';
import { threadStatusKind, type Thread } from '@/services/types';
import { savePairing, type QRParseResult } from '@/services/pairing';

const client = getTurnloomClient();

type Engine = 'codex' | 'pi';

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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const pairingRef = useRef<PairingSheetHandle>(null);
  const [engine, setEngine] = useState<Engine>('codex');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [machineName, setMachineName] = useState('de');
  const [readOnly, setReadOnly] = useState(false);
  const [authGate, setAuthGate] = useState(false);
  const [authCode, setAuthCode] = useState('');
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
        setThreads([]);
        setConnected(false);
        setAuthGate(false);
        setError('尚未配对电脑节点，请点击「扫码配对」');
        return;
      }
      setMachineName(config.machineName || new URL(config.serverUrl).host);
      const health = await client.getHealth();
      setConnected(Boolean(health?.ok));
      setReadOnly(health?.allowWrite === false);
      const result = await client.getThreads({ limit: 60 });
      // 304 keeps the previous body.
      if (result.status !== 304 && result.data?.threads) setThreads(result.data.threads);
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
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
      return undefined;
    }, [load])
  );

  useEffect(() => client.onAuthRequired(() => setAuthGate(true)), []);

  const handlePaired = useCallback(
    async (result: QRParseResult) => {
      await savePairing({
        serverUrl: result.serverUrl,
        token: result.token,
        machineName: result.machineName,
      });
      await client.refreshConfig();
      if (result.token) await client.exchangeAuthSession(result.token).catch(() => undefined);
      await load();
    },
    [load]
  );

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
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.largeTitle}>会话总控</Text>
            <Card style={styles.machineCard}>
              <View style={styles.statusRow}>
                <Animated.View style={[styles.statusDot, pulseStyle]} />
                <Text style={styles.statusText}>
                  {connected ? `电脑已连接 · ${machineName}` : '电脑离线'}
                </Text>
                {readOnly ? <Badge label="只读模式" tone="neutral" /> : null}
              </View>
              <Separator />
              <Text style={styles.fieldLabel}>代理引擎</Text>
              <View style={styles.segment}>
                {(['codex', 'pi'] as Engine[]).map((value) => {
                  const active = engine === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setEngine(value);
                      }}
                      style={({ pressed }) => [
                        styles.segmentItem,
                        active && styles.segmentActive,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {value === 'codex' ? 'Codex CLI' : 'Pi Agent'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <PrimaryButton
                label="▣  扫码配对"
                tone="neutral"
                onPress={() => pairingRef.current?.present()}
                style={styles.scanButton}
              />
            </Card>

            {authGate ? (
              <Card style={styles.authCard}>
                <Text style={styles.authTitle}>需要访问码</Text>
                <Text style={styles.authHint}>服务器返回 401，请输入终端显示的访问码</Text>
                <View style={styles.authRow}>
                  <PrimaryButton
                    label="重新输入访问码"
                    onPress={() => pairingRef.current?.present()}
                    style={{ flex: 1 }}
                  />
                </View>
                <Text style={styles.authCodeHint}>扫码或在配对抽屉里填写访问码</Text>
                <Text style={styles.hiddenValue}>{authCode}</Text>
              </Card>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {loading ? <ActivityIndicator color={OptionA.blue} style={styles.loader} /> : null}
            {!loading && !error && threads.length === 0 ? (
              <EmptyState title="暂无会话" hint="扫码配对或新建任务后，这里会显示真实会话" />
            ) : null}
            <Text style={styles.sectionTitle}>任务会话</Text>
          </View>
        }
      />

      <PairingSheet ref={pairingRef} onPaired={handlePaired} />
      {/* Re-exported to keep the tab bar definition in one place for phase 2 composition. */}
      <View style={styles.hidden}>{/* GlassTabBar is mounted by (tabs)/_layout.tsx */}</View>
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
  screen: {
    flex: 1,
    backgroundColor: OptionA.canvas,
  },
  header: {
    gap: 10,
    paddingBottom: 8,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: OptionA.ink,
    paddingTop: 8,
    paddingBottom: 4,
  },
  machineCard: {
    padding: 16,
    gap: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: OptionA.green,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: OptionA.greenInk,
    backgroundColor: 'rgba(52,199,89,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: OptionA.inkSoft,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: OptionA.fill,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  segmentActive: {
    backgroundColor: OptionA.card,
    shadowColor: 'rgba(0,0,0,0.08)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  segmentText: {
    fontSize: 14,
    color: OptionA.inkSoft,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: OptionA.ink,
    fontWeight: '700',
  },
  scanButton: {
    minHeight: 44,
  },
  authCard: {
    padding: 16,
    gap: 8,
  },
  authTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OptionA.ink,
  },
  authHint: {
    fontSize: 13,
    color: OptionA.inkSoft,
  },
  authRow: {
    flexDirection: 'row',
    gap: 8,
  },
  authCodeHint: {
    fontSize: 12,
    color: OptionA.inkSoft,
  },
  hiddenValue: {
    display: 'none',
  },
  error: {
    fontSize: 13,
    color: OptionA.redInk,
    paddingHorizontal: 2,
  },
  loader: {
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: OptionA.inkSoft,
    paddingTop: 8,
  },
  threadCard: {
    padding: 14,
    gap: 6,
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  threadTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: OptionA.ink,
  },
  chevron: {
    fontSize: 20,
    color: OptionA.inkSoft,
    marginLeft: 8,
  },
  threadPreview: {
    fontSize: 13,
    lineHeight: 18,
    color: OptionA.inkSoft,
  },
  threadFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
  },
  threadMeta: {
    marginLeft: 'auto',
    fontSize: 12,
    color: OptionA.inkSoft,
  },
  hidden: {
    display: 'none',
  },
});

export { GlassTabBar };
