/**
 * Bottom-sheet based pairing drawer. Uses expo-camera's CameraView barcode
 * scanner inside a @gorhom/bottom-sheet half-screen drawer — never a centred
 * Modal. Parses both real QR formats (codexpocket://add and /login?token=).
 */
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { CameraView, useCameraPermissions } from 'expo-camera';
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
import { Platform, StyleSheet, Text, View } from 'react-native';

import { GLASS_INTENSITY, GLASS_TINT, OptionA } from '@/constants/optionA';
import { parsePairingQR, type QRParseResult } from '@/services/pairing';

import { DragHandle, EmptyState, PrimaryButton, RoundedInput, Separator } from './ui';

export type PairingSheetHandle = {
  present: () => void;
  dismiss: () => void;
};

type Props = {
  onPaired: (result: QRParseResult) => void | Promise<void>;
};

export const PairingSheet = forwardRef<PairingSheetHandle, Props>(function PairingSheet(
  { onPaired },
  ref: Ref<PairingSheetHandle>
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualToken, setManualToken] = useState('');

  useImperativeHandle(ref, () => ({
    present: () => {
      setError('');
      setScanned(null);
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  useEffect(() => {
    if (!permission?.granted) void requestPermission().catch(() => undefined);
  }, [permission?.granted, requestPermission]);

  const accept = useCallback(
    async (result: QRParseResult | null, source: string) => {
      if (!result) {
        setError('无法识别二维码，请扫描 Turnloom 终端配对码或手动输入');
        return;
      }
      setScanned(source);
      setError('');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onPaired(result);
      sheetRef.current?.dismiss();
    },
    [onPaired]
  );

  const cameraAvailable = Platform.OS !== 'web' && permission?.granted === true;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['62%']}
      enablePanDownToClose
      backgroundStyle={styles.sheetBackground}
      handleComponent={() => (
        <View style={styles.handleWrapper}>
          <DragHandle />
        </View>
      )}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} />
      )}>
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>Scan QR to Pair</Text>
        <Text style={styles.subtitle}>扫描电脑终端显示的 Codex-Turnloom 配对二维码</Text>

        <View style={styles.cameraFrame}>
          {cameraAvailable ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(event) => {
                if (scanned === event.data) return;
                setScanned(event.data);
                void accept(parsePairingQR(event.data), event.data);
              }}
            />
          ) : (
            <EmptyState
              title="相机不可用"
              hint={Platform.OS === 'web' ? 'Web 预览不支持原生扫码，请使用下方手动输入' : '请授予相机权限后重试'}
            />
          )}
          <View style={styles.glassLabel}>
            <Text style={styles.glassLabelText}>将二维码放入框内</Text>
          </View>
        </View>

        <Separator />
        <Text style={styles.manualTitle}>手动输入服务器地址</Text>
        <RoundedInput
          value={manualUrl}
          onChangeText={setManualUrl}
          placeholder="http://192.168.1.10:8799"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.manualInput}
        />
        <RoundedInput
          value={manualToken}
          onChangeText={setManualToken}
          placeholder="访问码（可选）"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.manualInput}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label="配对并保存"
          onPress={() => {
            const combined = manualToken.trim()
              ? `${manualUrl.trim().replace(/\?.*$/, '')}/login?token=${encodeURIComponent(manualToken.trim())}`
              : manualUrl.trim();
            void accept(parsePairingQR(combined), 'manual');
          }}
          style={styles.action}
        />
      </BottomSheetView>
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
    paddingBottom: 24,
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
    fontSize: 12,
    color: OptionA.ink,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: OptionA.inkSoft,
    marginTop: 4,
  },
  manualInput: {
    minHeight: 42,
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
