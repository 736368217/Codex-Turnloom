/**
 * Native glass approval drawer. Only real interaction messages with
 * `canApprove && requestId` are rendered — no fabricated ids. Approve/Reject
 * call POST /api/approval with the mandatory four-field body; failures are
 * shown inside the sheet, success clears state and asks the page to refresh.
 */
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { GLASS_INTENSITY, GLASS_TINT, OptionA } from '@/constants/optionA';
import { getTurnloomClient } from '@/services/turnloomClient';
import type { Message } from '@/services/types';

import { DragHandle, EmptyState, PrimaryButton } from './ui';

const client = getTurnloomClient();

export type ApprovalSheetHandle = {
  present: (request: Message | null) => void;
  dismiss: () => void;
};

type Props = {
  threadId: string;
  /** Real messages from /api/threads/:id/messages. */
  requests: Message[];
  readOnly?: boolean;
  onResolved: () => void | Promise<void>;
};

export const ApprovalBottomSheet = forwardRef<ApprovalSheetHandle, Props>(function ApprovalBottomSheet(
  { threadId, requests, readOnly = false, onResolved },
  ref: Ref<ApprovalSheetHandle>
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [active, setActive] = useState<Message | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState(false);

  useImperativeHandle(ref, () => ({
    present: (request: Message | null) => {
      setActive(request);
      setError('');
      setResolved(false);
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  // Keep the displayed request in sync with the real message stream.
  useEffect(() => {
    if (!active?.requestId) return;
    const stillPresent = requests.some((item) => item.requestId === active.requestId);
    if (!stillPresent) setActive(null);
  }, [requests, active?.requestId]);

  const decide = async (decision: 'accept' | 'decline') => {
    if (!active?.requestId || pending || readOnly) return;
    setPending(true);
    setError('');
    try {
      await Haptics.notificationAsync(
        decision === 'accept'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
      await client.respondToApproval({
        threadId,
        requestId: String(active.requestId),
        approvalKind: active.approvalKind || 'command',
        decision,
      });
      setResolved(true);
      setActive(null);
      await onResolved();
      sheetRef.current?.dismiss();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  const queue = requests.filter((item) => item.role === 'interaction' && item.canApprove && item.requestId);
  const shown = active ?? queue[0] ?? null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['48%']}
      enablePanDownToClose
      backgroundStyle={styles.sheetBackground}
      handleComponent={() => (
        <View style={styles.handleWrapper}>
          <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} style={styles.handleBlur}>
            <DragHandle />
          </BlurView>
        </View>
      )}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} />
      )}>
      <BottomSheetView style={styles.content}>
        <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} style={styles.glass}>
          <Text style={styles.title}>Approve</Text>
          <Text style={styles.subtitle}>File / command changes</Text>

          {!shown ? (
            <EmptyState
              title={resolved ? '审批已提交' : '暂无待审批项'}
              hint={resolved ? '正在刷新消息流' : '仅显示服务端真实 interaction 请求'}
            />
          ) : (
            <View style={styles.requestCard}>
              <Text style={styles.requestTitle} numberOfLines={2}>
                {shown.title || 'Approval requested'}
              </Text>
              <Text style={styles.requestKind}>
                {shown.approvalKind || 'command'} · {shown.requestId}
              </Text>
              <Text style={styles.requestBody} numberOfLines={4} selectable>
                {shown.content || ''}
              </Text>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {readOnly ? <Text style={styles.error}>只读模式：审批已禁用</Text> : null}

          {pending ? <ActivityIndicator color={OptionA.green} /> : null}

          <PrimaryButton
            label="Approve & Apply"
            tone="green"
            disabled={!shown || pending || readOnly || resolved}
            onPress={() => void decide('accept')}
            style={styles.action}
          />
          <PrimaryButton
            label="Reject"
            tone="neutral"
            disabled={!shown || pending || readOnly || resolved}
            onPress={() => void decide('decline')}
          />
          {queue.length > 1 ? (
            <Text style={styles.queueHint}>队列中还有 {queue.length - 1} 个待审批项</Text>
          ) : null}
        </BlurView>
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handleBlur: {
    backgroundColor: OptionA.glass,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  glass: {
    borderRadius: 20,
    backgroundColor: OptionA.glass,
    padding: 16,
    gap: 8,
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
  requestCard: {
    backgroundColor: OptionA.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
    padding: 12,
    gap: 6,
  },
  requestTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: OptionA.ink,
  },
  requestKind: {
    fontSize: 12,
    color: OptionA.inkSoft,
    fontFamily: 'monospace',
  },
  requestBody: {
    fontSize: 13,
    lineHeight: 18,
    color: OptionA.ink,
  },
  error: {
    fontSize: 13,
    color: OptionA.redInk,
  },
  action: {
    marginTop: 4,
  },
  queueHint: {
    fontSize: 12,
    color: OptionA.inkSoft,
    textAlign: 'center',
  },
});
