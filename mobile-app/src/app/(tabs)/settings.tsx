/**
 * 「设置」Tab：访问码说明、只读模式、关于。
 * 低频的终端新增/切换/修改全部在「终端」Tab，这里只保留说明性内容。
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OptionA } from '@/constants/optionA';
import { Card, PrimaryButton, SectionLabel } from '@/components/ui';
import { getTurnloomClient } from '@/services/turnloomClient';

const client = getTurnloomClient();

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [paired, setPaired] = useState(false);

  useEffect(() => {
    let alive = true;
    void client.load().then(async (config) => {
      if (!alive) return;
      setPaired(Boolean(config?.serverUrl));
      if (!config) return;
      try {
        const health = await client.getHealth();
        if (alive) setReadOnly(health?.allowWrite === false);
      } catch {
        if (alive) setReadOnly(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const clearPairing = useCallback(async () => {
    await client.signOut();
    setPaired(false);
    setMessage('已清除配对信息，请到「终端」页重新添加');
  }, []);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>设置</Text>

      <SectionLabel>连接</SectionLabel>
      <Card style={styles.card}>
        <Text style={styles.rowLabel}>当前服务</Text>
        <Text style={styles.value}>{paired ? '已配对终端' : '未配对'}</Text>
        <Text style={styles.hint}>访问码将作为 x-access-token 请求头发送，只保存在本机。</Text>
      </Card>

      <SectionLabel>权限</SectionLabel>
      <Card style={styles.card}>
        <Text style={styles.rowLabel}>{readOnly ? '只读模式' : '写入权限'}</Text>
        <Text style={styles.hint}>
          {readOnly
            ? '服务端处于只读模式，发送、中断、审批已禁用。'
            : '可发送消息、中断运行中的任务，并处理待审批项。'}
        </Text>
      </Card>

      <SectionLabel>关于</SectionLabel>
      <Card style={styles.card}>
        <Text style={styles.rowLabel}>会话总控 · 日光版</Text>
        <Text style={styles.hint}>浅色界面，中文优先。终端与会话数据均来自本机服务，不经过云端账号。</Text>
        <Text style={styles.hint}>版本 1.18.0-option-a</Text>
      </Card>

      <PrimaryButton label="清除配对" tone="neutral" onPress={() => void clearPairing()} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: OptionA.canvas },
  content: { paddingHorizontal: 20, paddingBottom: 120, gap: 10 },
  title: { fontSize: 28, fontWeight: '700', color: OptionA.ink, paddingBottom: 6 },
  card: { padding: 16, gap: 8 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: OptionA.ink },
  value: { fontSize: 14, color: OptionA.inkSoft },
  hint: { fontSize: 12, lineHeight: 18, color: OptionA.inkSoft },
  message: { fontSize: 13, color: OptionA.greenInk, paddingVertical: 6 },
});
