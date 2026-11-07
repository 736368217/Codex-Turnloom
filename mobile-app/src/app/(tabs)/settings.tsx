import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, RoundedInput } from '@/components/ui';
import { getTurnloomClient } from '@/services/turnloomClient';

const client = getTurnloomClient();

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');

  const save = useCallback(async () => {
    try {
      await client.load();
      const { savePairing } = await import('@/services/pairing');
      await savePairing({ serverUrl, token, machineName: '' });
      await client.refreshConfig();
      if (token) await client.exchangeAuthSession(token).catch(() => undefined);
      setMessage('已保存连接配置');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [serverUrl, token]);

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7', paddingTop: 64 + insets.top, paddingHorizontal: 20, gap: 12 }}>
      <Text style={{ fontSize: 30, fontWeight: '700', color: '#1C1C1E' }}>Settings</Text>
      <Text style={{ fontSize: 13, color: '#8E8E93' }}>连接配置保存在系统钥匙串（Web 预览为本地存储）</Text>
      <RoundedInput value={serverUrl} onChangeText={setServerUrl} placeholder="http://192.168.1.10:8799" autoCapitalize="none" />
      <RoundedInput value={token} onChangeText={setToken} placeholder="访问码 / token" autoCapitalize="none" secureTextEntry />
      <PrimaryButton label="保存" onPress={() => void save()} />
      {message ? <Text style={{ fontSize: 13, color: '#8E8E93' }}>{message}</Text> : null}
      <PrimaryButton
        label="清除配对"
        tone="neutral"
        onPress={() => {
          void client.signOut().then(() => setMessage('已清除'));
        }}
      />
    </View>
  );
}
