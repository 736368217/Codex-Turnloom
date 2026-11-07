/**
 * 「终端」Tab（route 名沿用 monitors，避免改动 _layout）。
 * 用户说的「一个地方」：已保存终端、切换、扫码新增、修改名称/地址/访问码、
 * 引擎 Codex CLI / Pi Agent、连接状态、重新输入访问码，全部集中在此页。
 * 首屏（对话 Tab）不再出现任何连接/配对/新增按钮。
 */
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { PairingSheet, type PairingSheetHandle } from '@/components/PairingSheet';
import { Badge, Card, PrimaryButton, RoundedInput, SectionLabel } from '@/components/ui';
import { useEnginePreference, type Engine } from '@/services/appState';
import { localGet, localSet } from '@/services/localStore';
import { savePairing, type QRParseResult } from '@/services/pairing';
import { getTurnloomClient } from '@/services/turnloomClient';

const client = getTurnloomClient();
const ACTIVE_TERMINAL_KEY = 'activeTerminalId';

export default function TerminalsScreen() {
  const insets = useSafeAreaInsets();
  const pairingRef = useRef<PairingSheetHandle>(null);
  const { engine, setEngine } = useEnginePreference();
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [machineName, setMachineName] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [activeId, setActiveId] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const config = await client.load();
      if (config) {
        setServerUrl(config.serverUrl);
        setToken(config.token);
        setMachineName(config.machineName || new URL(config.serverUrl).host);
      }
      setActiveId((await localGet(ACTIVE_TERMINAL_KEY)) || '');
    } catch {
      /* ignore */
    }
  }, []);

  const checkConnection = useCallback(async () => {
    try {
      const health = await client.getHealth();
      setConnected(Boolean(health?.ok));
    } catch {
      setConnected(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void checkConnection();
      return undefined;
    }, [load, checkConnection])
  );

  const handlePaired = useCallback(
    async (result: QRParseResult) => {
      await savePairing({
        serverUrl: result.serverUrl,
        token: result.token,
        machineName: result.machineName,
      });
      await client.refreshConfig();
      if (result.token) await client.exchangeAuthSession(result.token).catch(() => undefined);
      setMessage('终端已添加');
      await load();
      await checkConnection();
    },
    [load, checkConnection]
  );

  const saveEdit = useCallback(async () => {
    try {
      await client.load();
      await savePairing({ serverUrl, token, machineName });
      await client.refreshConfig();
      if (token) await client.exchangeAuthSession(token).catch(() => undefined);
      await localSet(ACTIVE_TERMINAL_KEY, 'paired-device');
      setEditing(false);
      setMessage('终端信息已保存');
      await load();
      await checkConnection();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }, [serverUrl, token, machineName, load, checkConnection]);

  const switchTo = useCallback(async () => {
    void Haptics.selectionAsync();
    await localSet(ACTIVE_TERMINAL_KEY, activeId || 'paired-device');
    setMessage('已切换到该终端');
    router.push('/(tabs)/');
  }, [activeId]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>终端</Text>
      <Text style={styles.lead}>切换、新增、修改与连接设置都在这里，日常聊天无需再来。</Text>

      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: connected ? OptionA.green : OptionA.red }]} />
          <View style={styles.copy}>
            <Text style={styles.name} numberOfLines={1}>
              {machineName || '我的电脑'}
            </Text>
            <Text style={styles.url} numberOfLines={1}>
              {serverUrl || 'http://192.168.0.10:8787'}
            </Text>
          </View>
          {connected === null ? (
            <ActivityIndicator color={OptionA.blue} />
          ) : (
            <Badge label={connected ? '已连接' : '离线'} tone={connected ? 'green' : 'neutral'} />
          )}
        </View>
        <View style={styles.actions}>
          <PrimaryButton label="切换并使用" onPress={() => void switchTo()} style={styles.action} />
          <PrimaryButton label="测试连接" tone="neutral" onPress={() => void checkConnection()} style={styles.action} />
        </View>
      </Card>

      <SectionLabel>代理引擎</SectionLabel>
      <Card style={styles.card}>
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
                style={({ pressed }) => [styles.segmentItem, active && styles.segmentActive, pressed && styles.pressed]}>
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {value === 'codex' ? 'Codex CLI' : 'Pi Agent'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>技术标识保留，选择只影响显示偏好，不会改动服务端配置。</Text>
      </Card>

      <SectionLabel>修改终端信息</SectionLabel>
      <Card style={styles.card}>
        {editing ? (
          <View style={styles.form}>
            <RoundedInput
              value={machineName}
              onChangeText={setMachineName}
              placeholder="终端名称"
              autoCapitalize="none"
            />
            <RoundedInput
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.0.10:8787"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <RoundedInput
              value={token}
              onChangeText={setToken}
              placeholder="访问码"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.actions}>
              <PrimaryButton label="保存" onPress={() => void saveEdit()} style={styles.action} />
              <PrimaryButton label="取消" tone="neutral" onPress={() => setEditing(false)} style={styles.action} />
            </View>
          </View>
        ) : (
          <PrimaryButton label="修改名称 / 地址 / 访问码" tone="neutral" onPress={() => setEditing(true)} />
        )}
      </Card>

      <SectionLabel>新增终端</SectionLabel>
      <Card style={styles.card}>
        <PrimaryButton label="扫码添加终端" onPress={() => pairingRef.current?.present()} />
        <Text style={styles.hint}>粘贴 codexpocket://add?… 配对码，或手动输入服务地址与访问码。</Text>
      </Card>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <PairingSheet ref={pairingRef} onPaired={handlePaired} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OptionA.canvas },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 10 },
  title: { fontSize: 28, fontWeight: '700', color: OptionA.ink },
  lead: { fontSize: 13, lineHeight: 19, color: OptionA.inkSoft, paddingBottom: 6 },
  card: { padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 999 },
  copy: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600', color: OptionA.ink },
  url: { fontSize: 12, color: OptionA.inkSoft },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  segment: {
    flexDirection: 'row',
    backgroundColor: OptionA.fill,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  segmentActive: { backgroundColor: OptionA.card, shadowColor: 'rgba(0,0,0,0.08)', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 2 },
  segmentText: { fontSize: 14, color: OptionA.inkSoft, fontWeight: '500' },
  segmentTextActive: { color: OptionA.ink, fontWeight: '700' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  hint: { fontSize: 12, lineHeight: 17, color: OptionA.inkSoft },
  form: { gap: 8 },
  message: { fontSize: 13, color: OptionA.greenInk, paddingVertical: 6 },
});
