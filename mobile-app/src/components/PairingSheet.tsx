/**
 * Bottom-sheet pairing drawer. CameraView barcode scanning plus manual entry
 * live inside a scrollable @gorhom/bottom-sheet drawer — never a centred Modal.
 * Parses both real QR formats (codexpocket://add and /login?token=).
 *
 * Contract kept from the previous version:
 *  - `present()` / `dismiss()` handle, `onPaired(result)` prop.
 * Hardened behaviour:
 *  - content is scrollable (small screens / large font) and the drawer tracks
 *    the keyboard so the manual fields and the action stay reachable;
 *  - the access code is masked, one submit at a time (in-flight guard),
 *  - a failure shows the reason and keeps every field value,
 *  - the drawer closes only after `onPaired` really resolved.
 */
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SymbolView } from './ui/icon';
import * as Haptics from 'expo-haptics';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { GLASS_INTENSITY, GLASS_TINT, OptionA } from '@/constants/optionA';
import { parsePairingQR, type QRParseResult } from '@/services/pairing';

import {
  accessCodeSummary,
  blockScanAfterFailure,
  composeManualPairingInput,
  pairingErrorMessage,
  shouldHandleScan,
  type ScanThrottle,
} from './sheetLogic';
import { DragHandle, EmptyState, PrimaryButton, Separator } from './ui';

export type PairingSheetHandle = {
  present: () => void;
  dismiss: () => void;
};

type Props = {
  onPaired: (result: QRParseResult) => void | Promise<void>;
};

/** Same code cannot re-trigger while in flight or right after a failure. */
const SCAN_LOCKED_UNTIL_SETTLED = Number.MAX_SAFE_INTEGER;

export const PairingSheet = forwardRef<PairingSheetHandle, Props>(function PairingSheet(
  { onPaired },
  ref: Ref<PairingSheetHandle>
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const inFlightRef = useRef(false);
  const scanThrottleRef = useRef<ScanThrottle | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    present: () => {
      setError('');
      setManualOpen(false);
      scanThrottleRef.current = null;
      setSheetOpen(true);
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  // 只在用户真正打开扫码抽屉后才申请相机权限。
  // 之前在组件挂载时（即切到「终端」Tab 时）就申请，属打扰式权限弹窗。
  useEffect(() => {
    if (sheetOpen && !permission?.granted) void requestPermission().catch(() => undefined);
  }, [sheetOpen, permission?.granted, requestPermission]);

  /**
   * 唯一的提交出口：成功（onPaired 已完成）才返回 true 并关闭抽屉；
   * 失败返回 false，保留输入内容与错误文案。
   */
  const submit = useCallback(
    async (raw: string): Promise<boolean> => {
      if (inFlightRef.current) return false;
      const parsed = parsePairingQR(raw);
      if (!parsed) {
        setError('无法识别配对码：请扫描终端二维码，或手动输入服务地址');
        return false;
      }
      inFlightRef.current = true;
      setPending(true);
      setError('');
      try {
        await onPaired(parsed);
      } catch (caught) {
        setError(pairingErrorMessage(caught, '配对失败，请确认电脑端已启动'));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => undefined
        );
        return false;
      } finally {
        inFlightRef.current = false;
        setPending(false);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined
      );
      sheetRef.current?.dismiss();
      return true;
    },
    [onPaired]
  );

  const submitManual = useCallback(() => {
    setManualOpen(true);
    const target = composeManualPairingInput({ url: manualUrl, token: manualToken });
    if (!target.ok) {
      setError(target.error);
      return;
    }
    void submit(target.raw);
  }, [manualToken, manualUrl, submit]);

  const handleBarcode = useCallback(
    (data: string) => {
      const now = Date.now();
      if (!shouldHandleScan(scanThrottleRef.current, data, now)) return;
      scanThrottleRef.current = {
        code: String(data).trim(),
        blockedUntil: SCAN_LOCKED_UNTIL_SETTLED,
      };
      void submit(data).then((ok) => {
        // 失败后给同一个码一个冷却窗口，避免相机回调连环重试。
        if (!ok) scanThrottleRef.current = blockScanAfterFailure(data, Date.now());
      });
    },
    [submit]
  );

  const cameraAvailable = Platform.OS !== 'web' && permission?.granted === true;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['76%', '95%']}
      enableDynamicSizing={false}
      enablePanDownToClose={!pending}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onChange={(index) => setSheetOpen(index >= 0)}
      backgroundStyle={styles.sheetBackground}
      handleComponent={() => (
        <View style={styles.handleWrapper}>
          <DragHandle />
        </View>
      )}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} pressBehavior={pending ? 'none' : 'close'} />
      )}>
      <BottomSheetScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>扫码配对</Text>
        <Text style={styles.subtitle}>扫描电脑终端的配对二维码，或手动输入地址</Text>

        <View style={styles.cameraFrame}>
          {cameraAvailable ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(event) => handleBarcode(event?.data ?? '')}
            />
          ) : (
            <EmptyState
              title={sheetOpen ? '相机尚未授权' : '准备启用相机'}
              hint={
                Platform.OS === 'web'
                  ? '预览环境不支持扫码，请用下方手动输入'
                  : sheetOpen
                    ? '允许相机权限，或直接用下方手动输入'
                    : '打开抽屉后会申请相机权限'
              }
            />
          )}
          <View style={styles.glassLabel}>
            <Text style={styles.glassLabelText}>将二维码放入框内</Text>
          </View>
        </View>

        <Separator />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={manualOpen ? '收起手动输入' : '展开手动输入'}
          accessibilityState={{ expanded: manualOpen }}
          onPress={() => setManualOpen((open) => !open)}
          style={styles.manualToggle}>
          <Text style={styles.manualTitle}>手动输入</Text>
          <SymbolView name={{ ios: manualOpen ? 'chevron.down' : 'chevron.right', android: manualOpen ? 'expand_less' : 'chevron_right', web: manualOpen ? 'expand_less' : 'chevron_right' }} size={18} tintColor={OptionA.blue} />
        </Pressable>
        {manualOpen ? (
          <>
            <BottomSheetTextInput
              value={manualUrl}
              onChangeText={setManualUrl}
              placeholder="http://<电脑 IP>:8787"
              placeholderTextColor={OptionA.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
              editable={!pending}
              accessibilityLabel="服务地址"
              style={styles.input}
            />
            <View style={styles.tokenRow}>
              <BottomSheetTextInput
                value={manualToken}
                onChangeText={setManualToken}
                placeholder="访问码（可选）"
                placeholderTextColor={OptionA.inkSoft}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showToken}
                editable={!pending}
                accessibilityLabel="访问码"
                style={[styles.input, styles.tokenInput]}
              />
              <Pressable
                onPress={() => setShowToken((shown) => !shown)}
                accessibilityRole="button"
                accessibilityLabel={showToken ? '隐藏访问码' : '显示访问码'}
                hitSlop={8}
                style={({ pressed }) => [styles.tokenToggle, pressed && styles.pressed]}>
                <Text style={styles.tokenToggleText}>{showToken ? '隐藏' : '显示'}</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>{accessCodeSummary(manualToken)}</Text>
            <PrimaryButton
              label={pending ? '配对中…' : '配对并保存'}
              onPress={submitManual}
              disabled={pending}
              style={styles.action}
            />
          </>
        ) : (
          <Text style={styles.manualCollapsedHint}>手动输入电脑地址和访问码，默认收起以优先扫码</Text>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: OptionA.card,
    borderRadius: 24,
  },
  handleWrapper: {
    backgroundColor: OptionA.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: OptionA.ink,
  },
  subtitle: {
    fontSize: 13,
    color: OptionA.inkSoft,
    marginBottom: 4,
  },
  cameraFrame: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: OptionA.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
  },
  glassLabel: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: OptionA.glass,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  glassLabelText: {
    fontSize: 13,
    color: OptionA.ink,
  },
  manualToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: OptionA.fill,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: OptionA.ink,
  },
  manualCollapsedHint: {
    paddingHorizontal: 8,
    paddingBottom: 4,
    fontSize: 13,
    color: OptionA.inkSoft,
  },
  input: {
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: OptionA.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: OptionA.ink,
    fontSize: 15,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tokenInput: {
    flex: 1,
  },
  tokenToggle: {
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OptionA.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
  },
  tokenToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: OptionA.blue,
  },
  pressed: {
    opacity: 0.8,
  },
  hint: {
    fontSize: 13,
    color: OptionA.inkSoft,
  },
  error: {
    color: OptionA.redInk,
    fontSize: 13,
  },
  action: {
    marginTop: 4,
  },
});

/** Glass scrim fragment used by other sheets; kept here for shared constants. */
export { GLASS_INTENSITY, GLASS_TINT };
