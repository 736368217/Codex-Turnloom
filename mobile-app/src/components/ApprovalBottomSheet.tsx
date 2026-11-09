/**
 * Native glass approval drawer. Only real interaction messages with
 * `canApprove && requestId` are rendered — no fabricated ids. Approve/Reject
 * call POST /api/approval with the mandatory four-field body; failures are
 * shown inside the sheet, success clears state and asks the page to refresh.
 *
 * Hardened behaviour:
 *  - the full command / patch body is rendered (no `numberOfLines` truncation)
 *    inside a scrollable drawer, so long content is reachable;
 *  - multiple pending requests can be stepped through (上一条 / 下一条) in server
 *    order, and both actions always target the row currently shown — so
 *    `present(null)` can no longer render enabled buttons that do nothing;
 *  - submits are single-flight and disabled while read-only; a failure keeps the
 *    content mounted and retryable, success closes the drawer and refreshes.
 */
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_INTENSITY, GLASS_TINT, OptionA } from '@/constants/optionA';
import { getTurnloomClient } from '@/services/turnloomClient';
import type { Message } from '@/services/types';

import {
  approvalErrorMessage,
  approvalKindLabel,
  approvalPositionLabel,
  approvalQueue,
  canDecideApproval,
  focusApprovalCursor,
  resolveApprovalCursor,
  stepApprovalCursor,
  type ApprovalCursor,
} from './sheetLogic';
import { DragHandle, EmptyState, PrimaryButton } from './ui';

const client = getTurnloomClient();

const INITIAL_CURSOR: ApprovalCursor = { id: null, index: 0 };

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
  const inFlightRef = useRef(false);
  const insets = useSafeAreaInsets();
  const [cursor, setCursor] = useState<ApprovalCursor>(INITIAL_CURSOR);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState(false);

  const queue = useMemo(() => approvalQueue(requests), [requests]);
  const shown = useMemo(() => resolveApprovalCursor(queue, cursor), [queue, cursor]);
  const shownId = String(shown?.message.requestId ?? '').trim();
  const actionable = canDecideApproval(shownId, { pending, readOnly });

  useImperativeHandle(ref, () => ({
    present: (request: Message | null) => {
      setError('');
      setResolved(false);
      // present(real request) → 对准该条；present(null) → 对准第一条真实待审批项。
      setCursor(focusApprovalCursor(approvalQueue(requests), request));
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const decide = useCallback(
    async (decision: 'accept' | 'decline') => {
      const requestId = String(shown?.message.requestId ?? '').trim();
      if (!requestId || inFlightRef.current || readOnly) return;
      const approvalKind = shown?.message.approvalKind || 'command';
      inFlightRef.current = true;
      setPending(true);
      setError('');
      try {
        await client.respondToApproval({ threadId, requestId, approvalKind, decision });
      } catch (caught) {
        setError(approvalErrorMessage(caught));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => undefined
        );
        return;
      } finally {
        inFlightRef.current = false;
        setPending(false);
      }
      void Haptics.notificationAsync(
        decision === 'accept'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      ).catch(() => undefined);
      setResolved(true);
      // 保持位置：服务端移除该条后，队列里的下一条会顶上来。
      setCursor((previous) => ({ id: null, index: previous.index }));
      sheetRef.current?.dismiss();
      try {
        await onResolved();
      } catch {
        /* 审批已提交；刷新失败不该被当成审批失败 */
      }
    },
    [onResolved, readOnly, shown, threadId]
  );

  const goPrevious = useCallback(() => {
    setCursor((previous) => stepApprovalCursor(queue, previous, -1));
  }, [queue]);

  const goNext = useCallback(() => {
    setCursor((previous) => stepApprovalCursor(queue, previous, 1));
  }, [queue]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['48%', '88%']}
      enableDynamicSizing={false}
      enablePanDownToClose={!pending}
      backgroundStyle={styles.sheetBackground}
      handleComponent={() => (
        <View style={styles.handleWrapper}>
          <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} style={styles.handleBlur}>
            <DragHandle />
          </BlurView>
        </View>
      )}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} pressBehavior={pending ? 'none' : 'close'} />
      )}
      footerComponent={(props) => (
        <BottomSheetFooter {...props} bottomInset={insets.bottom} style={styles.footer}>
          <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} style={styles.footerGlass}>
            <PrimaryButton
              label="批准并应用"
              tone="green"
              disabled={!actionable}
              onPress={() => void decide('accept')}
              style={styles.action}
            />
            <PrimaryButton
              label="拒绝"
              tone="neutral"
              disabled={!actionable}
              onPress={() => void decide('decline')}
            />
          </BlurView>
        </BottomSheetFooter>
      )}>
        <BottomSheetScrollView
          enableFooterMarginAdjustment
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <BlurView tint={GLASS_TINT} intensity={GLASS_INTENSITY} style={styles.glass}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>待审批</Text>
              {queue.length > 1 ? (
                <Text style={styles.position}>{approvalPositionLabel(shown?.index ?? 0, queue.length)}</Text>
              ) : null}
            </View>
            {!shown ? (
              <>
                <EmptyState
                  title={resolved ? '审批已提交' : cursor.id ? '该请求已失效' : '暂无待审批项'}
                  hint={resolved ? '正在刷新消息流' : cursor.id ? '该请求可能已在电脑端处理' : '当前会话没有待审批请求'}
                />
                {!resolved && cursor.id && queue.length ? <PrimaryButton label="查看其他审批" tone="neutral" onPress={() => setCursor(INITIAL_CURSOR)} /> : null}
              </>
            ) : (
              <View style={styles.requestCard}>
                <Text style={styles.requestTitle} selectable>{shown.message.title || '待审批请求'}</Text>
                <Text style={styles.requestKind}>{approvalKindLabel(shown.message.approvalKind)} · {String(shown.message.requestId)}</Text>
                <Text style={[styles.requestBody, styles.mono]} selectable>{shown.message.content?.trim() || '（服务端未附带详细内容）'}</Text>
                {shown.message.files?.length ? (
                  <View style={styles.fileList}>
                    {shown.message.files.map((file, index) => (
                      <Text key={`${file.path}-${index}`} style={styles.filePath} selectable>{file.path}</Text>
                    ))}
                  </View>
                ) : null}
                {shown.message.requiresDesktopAction ? <Text style={styles.hint}>需在桌面端确认</Text> : null}
              </View>
            )}
            {queue.length > 1 ? (
              <View style={styles.navRow}>
                <Pressable onPress={goPrevious} disabled={pending} accessibilityRole="button" accessibilityLabel="上一条审批" hitSlop={8} style={({ pressed }) => [styles.navButton, pending && styles.navDisabled, pressed && styles.pressed]}>
                  <Text style={styles.navText}>上一条</Text>
                </Pressable>
                <Text style={styles.navPosition}>{approvalPositionLabel(shown?.index ?? 0, queue.length)}</Text>
                <Pressable onPress={goNext} disabled={pending} accessibilityRole="button" accessibilityLabel="下一条审批" hitSlop={8} style={({ pressed }) => [styles.navButton, pending && styles.navDisabled, pressed && styles.pressed]}>
                  <Text style={styles.navText}>下一条</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {readOnly ? <Text style={styles.hint}>只读模式：审批已禁用</Text> : null}
            {pending ? <View style={styles.pendingRow}><ActivityIndicator color={OptionA.green} /><Text style={styles.hint}>提交中…</Text></View> : null}
          </BlurView>
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handleBlur: {
    backgroundColor: OptionA.glass,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OptionA.separator,
    backgroundColor: OptionA.card,
  },
  footerGlass: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
  },
  glass: {
    borderRadius: 20,
    backgroundColor: OptionA.glass,
    padding: 16,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: OptionA.ink,
  },
  position: {
    fontSize: 13,
    color: OptionA.inkSoft,
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
    fontSize: 13,
    color: OptionA.inkSoft,
    fontFamily: 'monospace',
  },
  requestBody: {
    fontSize: 13,
    lineHeight: 18,
    color: OptionA.ink,
  },
  mono: {
    fontFamily: 'monospace',
  },
  fileList: {
    gap: 2,
  },
  filePath: {
    fontSize: 13,
    color: OptionA.inkSoft,
    fontFamily: 'monospace',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  navButton: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OptionA.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
  },
  navDisabled: {
    opacity: 0.45,
  },
  navText: {
    fontSize: 14,
    fontWeight: '600',
    color: OptionA.blue,
  },
  navPosition: {
    fontSize: 13,
    color: OptionA.inkSoft,
  },
  pressed: {
    opacity: 0.8,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hint: {
    fontSize: 13,
    color: OptionA.inkSoft,
  },
  error: {
    fontSize: 13,
    color: OptionA.redInk,
  },
  action: {
    marginTop: 4,
  },
});
