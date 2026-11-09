/**
 * 「终端」Tab（route 名沿用 monitors）：低频能力唯一归口。
 * v5：NativeWind className + React Native Reusables 复制式 Card/Button/Text/Input/Badge。
 */
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { PairingSheet, type PairingSheetHandle } from '@/components/PairingSheet';
import { Badge, Button, Card, Input, Text } from '@/components/ui/rnr';
import { useEnginePreference, type Engine } from '@/services/appState';
import { localGet, localSet } from '@/services/localStore';
import { normalizeServerUrl, readPairing, savePairing, type QRParseResult } from '@/services/pairing';
import { getTurnloomClient } from '@/services/turnloomClient';

const client = getTurnloomClient();
const ACTIVE_TERMINAL_KEY = 'activeTerminalId';

export default function TerminalsScreen() {
  const insets = useSafeAreaInsets();
  const pairingRef = useRef<PairingSheetHandle>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const { engine, setEngine } = useEnginePreference();
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [machineName, setMachineName] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [activeId, setActiveId] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');
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
      await savePairing({ serverUrl: result.serverUrl, token: result.token, machineName: result.machineName });
      await client.refreshConfig();
      if (result.token) await client.exchangeAuthSession(result.token).catch(() => undefined);
      setMessage('终端已添加');
      await load();
      await checkConnection();
    },
    [load, checkConnection]
  );

  const saveEdit = useCallback(async () => {
    setMessage('');
    const nextUrl = normalizeServerUrl(serverUrl);
    if (!nextUrl) {
      setMessageTone('error');
      setMessage('服务地址格式不正确，请检查后重试（需要 http:// 或 https:// 开头）');
      return;
    }
    try {
      const nextName = machineName.trim() || new URL(nextUrl).host;
      await savePairing({ serverUrl: nextUrl, token: token.trim(), machineName: nextName });
      // 回读校验：写进去必须能读回来才算成功。上一版是「先弹已保存」，所以
      // 即使地址没真正切换也显示保存成功，重启后又回到旧地址。
      const persisted = await readPairing();
      if (!persisted || persisted.serverUrl !== nextUrl) {
        setMessageTone('error');
        setMessage('保存未生效：安全存储没有读回刚写入的地址，请重试');
        return;
      }
      await client.refreshConfig();
      if (persisted.token) await client.exchangeAuthSession(persisted.token).catch(() => undefined);
      // 编辑后这台设备就是「已配对终端」，不再让内置常量覆盖地址。
      await localSet(ACTIVE_TERMINAL_KEY, 'paired-device');
      setActiveId('paired-device');
      // 以落盘值为准回填，界面与真实配置永远一致。
      setServerUrl(persisted.serverUrl);
      setToken(persisted.token);
      setMachineName(persisted.machineName || nextName);
      setEditing(false);
      setMessageTone('ok');
      setMessage(`终端信息已保存 · 当前地址 ${persisted.serverUrl}`);
      await checkConnection();
    } catch (caught) {
      setMessageTone('error');
      setMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }, [serverUrl, token, machineName, checkConnection]);

  /** 进入编辑态后自动滚到底：否则「保存 / 取消」会被底栏裁掉（实测只剩 1px 高）。 */
  useEffect(() => {
    if (!editing) return undefined;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 90);
    return () => clearTimeout(timer);
  }, [editing]);

  const switchTo = useCallback(async () => {
    void Haptics.selectionAsync();
    await localSet(ACTIVE_TERMINAL_KEY, activeId || 'paired-device');
    setMessage('已切换到该终端');
    router.push('/(tabs)/');
  }, [activeId]);

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-transparent"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: insets.top + 16,
        // 编辑态多留一屏底部空间，保证「保存 / 取消」永远滚得出来。
        paddingBottom: editing ? 220 : 120,
        gap: 10,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <Text className="text-[11px] font-bold uppercase tracking-[2px] text-[#8E8E93]">Codex-Turnloom</Text>
      <Text className="text-[30px] font-bold leading-[34px] tracking-[-1px] text-[#1C1C1E]">终端管理</Text>
      <Text className="pb-[6px] text-[12px] leading-[19px] text-[#8E8E93]">
        切换电脑、添加终端与选择代理引擎都在这里完成。
      </Text>

      <Card className="gap-[10px] p-[14px]">
        <View className="flex-row items-center gap-[10px]">
          <View className={`h-[9px] w-[9px] rounded-full ${connected ? 'bg-[#34C759]' : 'bg-[#FF3B30]'}`} />
          <View className="flex-1 gap-[2px]">
            <Text className="text-[15px] font-semibold text-[#1C1C1E]" numberOfLines={1}>
              {machineName || '我的电脑'}
            </Text>
            <Text className="text-[12px] text-[#8E8E93]" numberOfLines={1}>
              {serverUrl || 'http://192.168.0.10:8787'}
            </Text>
          </View>
          {connected === null ? (
            <ActivityIndicator color={OptionA.blue} />
          ) : (
            <Badge variant={connected ? 'default' : 'secondary'}>
              <Text className="text-[12px] font-semibold text-[#007AFF]">{connected ? '已连接' : '离线'}</Text>
            </Badge>
          )}
        </View>
        <View className="flex-row gap-[10px]">
          <Button onPress={() => void switchTo()} className="flex-1">
            <Text className="text-[15px] font-semibold text-white">切换并使用</Text>
          </Button>
          <Button variant="secondary" onPress={() => void checkConnection()} className="flex-1">
            <Text className="text-[15px] font-semibold text-[#1C1C1E]">测试连接</Text>
          </Button>
        </View>
      </Card>

      <Text className="mb-2 text-[13px] font-semibold uppercase tracking-[0.6px] text-[#8E8E93]">代理引擎</Text>
      <Card className="gap-[10px] p-[14px]">
        <View className="flex-row gap-[3px] rounded-xl bg-[#EFEFF4] p-[3px]">
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
                className={`min-h-[44px] flex-1 items-center justify-center rounded-[10px] active:opacity-80 ${active ? 'bg-white' : ''}`}>
                <Text className={`text-[14px] ${active ? 'font-bold text-[#1C1C1E]' : 'font-medium text-[#8E8E93]'}`}>
                  {value === 'codex' ? 'Codex CLI' : 'Pi Agent'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text className="text-[12px] leading-[17px] text-[#8E8E93]">
          技术标识保留，选择只影响显示偏好，不会改动服务端配置。
        </Text>
      </Card>

      <Text className="mb-2 text-[13px] font-semibold uppercase tracking-[0.6px] text-[#8E8E93]">修改终端信息</Text>
      <Card className="gap-[10px] p-[14px]">
        {editing ? (
          <View className="gap-2">
            <Input value={machineName} onChangeText={setMachineName} placeholder="终端名称" autoCapitalize="none" />
            <Input
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.0.10:8787"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Input
              value={token}
              onChangeText={setToken}
              placeholder="访问码"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View className="flex-row gap-[10px]">
              <Button onPress={() => void saveEdit()} className="flex-1">
                <Text className="text-[15px] font-semibold text-white">保存</Text>
              </Button>
              <Button variant="secondary" onPress={() => setEditing(false)} className="flex-1">
                <Text className="text-[15px] font-semibold text-[#1C1C1E]">取消</Text>
              </Button>
            </View>
          </View>
        ) : (
          <Button variant="secondary" onPress={() => setEditing(true)}>
            <Text className="text-[15px] font-semibold text-[#1C1C1E]">修改名称 / 地址 / 访问码</Text>
          </Button>
        )}
      </Card>

      <Text className="mb-2 text-[13px] font-semibold uppercase tracking-[0.6px] text-[#8E8E93]">新增终端</Text>
      <Card className="gap-[10px] p-[14px]">
        <Button onPress={() => pairingRef.current?.present()}>
          <Text className="text-[15px] font-semibold text-white">扫码添加终端</Text>
        </Button>
        <Text className="text-[12px] leading-[17px] text-[#8E8E93]">
          粘贴 codexpocket://add?… 配对码，或手动输入服务地址与访问码。
        </Text>
      </Card>

      {message ? (
        <Text className={`py-[6px] text-[13px] leading-[18px] ${messageTone === 'error' ? 'text-[#D70015]' : 'text-[#248A3D]'}`}>
          {message}
        </Text>
      ) : null}

      <PairingSheet ref={pairingRef} onPaired={handlePaired} />
    </ScrollView>
  );
}
