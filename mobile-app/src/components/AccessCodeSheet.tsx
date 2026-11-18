import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { OptionA } from '@/constants/optionA';
import { useTerminalSelection } from '@/services/appState';

export function AccessCodeSheet() {
  const sheetRef = useRef<BottomSheetModal>(null);
  const inFlight = useRef(false);
  const { authRequired, dismissAuth, reauthenticate, terminal } = useTerminalSelection();
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authRequired) {
      setError('');
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [authRequired]);

  const submit = async () => {
    if (!token.trim() || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      await reauthenticate(token);
      setToken('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '连接失败，请重试');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['46%', '80%']}
      enableDynamicSizing={false}
      enablePanDownToClose={!pending}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={() => { setToken(''); setError(''); dismissAuth(); }}
      backgroundStyle={{ backgroundColor: OptionA.card }}
      backdropComponent={(props) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} pressBehavior={pending ? 'none' : 'close'} />}>
      <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: OptionA.ink }}>输入访问码</Text>
        <Text style={{ fontSize: 14, color: OptionA.inkSoft }}>
          {terminal?.machineName ? `重新连接 ${terminal.machineName}` : '重新连接当前电脑'}
        </Text>
        <BottomSheetTextInput
          accessibilityLabel="访问码"
          value={token}
          onChangeText={setToken}
          placeholder="电脑上的访问码"
          placeholderTextColor={OptionA.inkSoft}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          onSubmitEditing={() => void submit()}
          style={{ minHeight: 48, borderRadius: 12, backgroundColor: OptionA.fill, paddingHorizontal: 14, color: OptionA.ink, fontSize: 16 }}
        />
        {error ? <Text accessibilityRole="alert" style={{ color: OptionA.redInk, fontSize: 13 }}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="验证并连接"
          accessibilityState={{ disabled: pending || !token.trim() }}
          disabled={pending || !token.trim()}
          onPress={() => void submit()}
          style={{ minHeight: 48, borderRadius: 12, backgroundColor: OptionA.blue, opacity: pending || !token.trim() ? 0.5 : 1, alignItems: 'center', justifyContent: 'center' }}>
          {pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>验证并连接</Text>}
        </Pressable>
        <View style={{ height: 4 }} />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
