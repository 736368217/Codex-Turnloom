/**
 * 底部拇指输入舱（V9，与 Web 端 ThumbGlassBar 行为对齐）。
 *
 * 设计约束（来自真机反馈，改之前先读）：
 * - **主结构仍是单行**：`[附件] [输入框] [发送 / 停止]`，不再加工具行 / 分段行。
 * - **输入自适应 1–5 行**：多行输入随内容长高，最高 `INPUT_MAX_HEIGHT`（5 行 + 上下内边距），
 *   超过后输入框内部滚动，不会把输入舱顶到屏幕外。回车在多行输入里是换行，
 *   发送只走右侧按钮 —— 这样「按了到底发生什么」没有歧义。
 * - **发送与停止互斥**，同一位置只渲染一个：有内容→发送（运行中即排队，不打断当前任务）；
 *   空且运行中→停止。按钮带 `accessibilityHint` 说明当前是「开始新任务」还是「进入排队」。
 * - **只有 `onSend` 真的 resolve 才清空**：rejected 时保留文本与附件并给出可重试反馈；
 *   清空前按快照比对，避免把等待期间用户新输入的内容一起清掉。
 * - **in-flight 防重复发送**：用 ref 做同步闸门（父级的 `sending` prop 是异步 setState，
 *   跟不上连点），发送 / 中断 / 队列操作都不会有未处理的 Promise。
 * - **附件显示真实缩略图**：只用 picker 给的本地 uri；`data:` 形式（内嵌 base64）
 *   一律不渲染，也不进任何 label / testID，避免把 base64 泄漏到视图层。
 * - **命中区 ≥44dp**：队列展开 / 清空 / 优先 / 删除、附件删除、附件、发送、停止全部 44dp，
 *   并带可访问名称；队列条展开后限高滚动，键盘态也不会被挤出屏幕。
 * - 提前发送在不同队列后端可能是调整优先级，也可能立即插入当前轮次；操作前要求确认。
 * 组件原语来自 React Native Reusables 复制式用法，布局用 NativeWind className。
 */
import { SymbolView } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_TINT, OptionA, THUMB_GLASS_INTENSITY } from '@/constants/optionA';
import { Text } from '@/components/ui/rnr';
import { pickFiles, pickImages, type PickedImage } from '@/services/imagePicker';

export type SendMode = 'start' | 'queue' | 'steer';

export type SendPayload = {
  message: string;
  mode?: SendMode;
  images?: Array<{ name: string; mimeType: string; data: string }>;
};

/**
 * 排队项。`text` / `deliveryState` / `position` 是既有字段（父级把 `status.queuedMessages`
 * 直接断言成这个类型），后面几个可选字段是服务端本地队列顺带返回的展示信息，缺了也能用。
 */
export type QueuedItem = {
  id: string;
  text?: string;
  deliveryState?: string;
  position?: number;
  /** 只有图片时的文本预览。 */
  preview?: string;
  imageCount?: number;
  lastError?: string | null;
};

export type ThumbPromptBarProps = {
  busy?: boolean;
  readOnly?: boolean;
  sending?: boolean;
  onSend: (payload: SendPayload) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  queueLength?: number;
  queuedMessages?: QueuedItem[];
  onQueueAction?: (action: 'steer' | 'cancel', itemId: string) => void | Promise<void>;
  onClearQueue?: () => void | Promise<void>;
};

/** 输入框一行的高度；下面三个常量一起决定「1–5 行」的上下限。 */
const INPUT_LINE_HEIGHT = 20;
const INPUT_PADDING_V = 12;
const INPUT_MIN_HEIGHT = INPUT_PADDING_V * 2 + INPUT_LINE_HEIGHT; // 44 = 1 行
const INPUT_MAX_HEIGHT = INPUT_PADDING_V * 2 + INPUT_LINE_HEIGHT * 5; // 124 = 5 行
/** 服务端 /api/send 单次最多带的图片数（与 Web 端 ThumbGlassBar 一致）。 */
const MAX_IMAGES = 4;
/** 展开后的排队明细限高，避免长队列把输入舱顶出屏幕。 */
const EXPANDED_QUEUE_MAX_HEIGHT = 176;
const MIN_TOUCH = 44;
const HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 } as const;

type Notice = { text: string; tone: 'info' | 'error' };

type ContentSizeEvent = { nativeEvent: { contentSize: { height: number } } };

/** 缩略图只接受真实文件地址；`data:` 内嵌 base64 直接拒绝，永不进视图层。 */
function previewUriOf(image: PickedImage): string | null {
  const uri = typeof image.uri === 'string' ? image.uri.trim() : '';
  if (!uri) return null;
  if (/^data:/i.test(uri)) return null;
  return uri;
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // 防御性脱敏：万一异常信息里带上请求体（内嵌 base64 的 data:），先抹掉再进界面。
  const text = raw.replace(/[A-Za-z0-9+/=]{120,}/g, '（长数据已省略）').trim();
  return text ? (text.length > 140 ? `${text.slice(0, 140)}…` : text) : '未知错误';
}

/** 服务端 deliveryState 只有 queued / sending / awaitingConfirmation / failed 四种。 */
function queueStateLabel(item: QueuedItem): string | null {
  if (item.deliveryState === 'sending') return '发送中';
  if (item.deliveryState === 'awaitingConfirmation') return '等待确认';
  if (item.deliveryState === 'failed') return '发送失败';
  return null;
}

/** 发送中的排队项在服务端会返回 409，界面上先禁用，别给用户假装能点。 */
function queueItemLocked(item: QueuedItem): boolean {
  return item.deliveryState === 'sending' || item.deliveryState === 'awaitingConfirmation';
}

function samePickedImages(current: PickedImage[], snapshot: PickedImage[]): boolean {
  if (current.length !== snapshot.length) return false;
  return current.every((image, index) => image.uri === snapshot[index].uri && image.name === snapshot[index].name);
}

export function ThumbPromptBar({
  busy = false,
  readOnly = false,
  sending = false,
  onSend,
  onInterrupt,
  queueLength = 0,
  queuedMessages = [],
  onQueueAction,
  onClearQueue,
}: ThumbPromptBarProps) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [submitting, setSubmitting] = useState(false);
  const [pendingQueueKey, setPendingQueueKey] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<string | null>(null);

  /** 供异步流程读取最新附件列表，避免 await 之后拿到过期闭包。 */
  const imagesRef = useRef<PickedImage[]>([]);
  /** 同步闸门：父级 `sending` 是异步 setState，连点时来不及挡住第二次提交。 */
  const inFlightRef = useRef(false);
  const queueActionRef = useRef(false);

  const hasPayload = Boolean(value.trim() || images.length);
  /** 互斥：空输入且运行中才显示停止。 */
  const showStop = busy && !hasPayload && !readOnly;
  const blocked = readOnly || sending || submitting;
  const queueCount = Math.max(queueLength, queuedMessages.length);
  const failedCount = queuedMessages.filter((item) => item.deliveryState === 'failed').length;

  const applyImages = (next: PickedImage[]) => {
    imagesRef.current = next;
    setImages(next);
  };

  const appendImages = (picked: PickedImage[]) => {
    const merged = [...imagesRef.current, ...picked];
    applyImages(merged.slice(0, MAX_IMAGES));
    if (merged.length > MAX_IMAGES) {
      setNotice({ text: `最多 ${MAX_IMAGES} 张图片，多出的 ${merged.length - MAX_IMAGES} 张已忽略`, tone: 'info' });
      return;
    }
    setNotice(null);
  };

  const removeImage = (index: number) => {
    applyImages(imagesRef.current.filter((_, current) => current !== index));
    setNotice(null);
  };

  const handleContentSizeChange = (event: ContentSizeEvent) => {
    const contentHeight = Number(event?.nativeEvent?.contentSize?.height) || 0;
    const next = Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, Math.ceil(contentHeight) + INPUT_PADDING_V * 2));
    // 只在跨过 0.5px 阈值时 setState，避免滚动/首帧反复触发渲染。
    setInputHeight((current) => (Math.abs(current - next) > 0.5 ? next : current));
  };

  const submit = async () => {
    if (readOnly) {
      setNotice({ text: '只读模式：发送已禁用', tone: 'error' });
      return;
    }
    if (inFlightRef.current) return;
    const message = value.trim();
    if (!message && imagesRef.current.length === 0) return;

    const snapshot = imagesRef.current;
    // 运行中默认排队（不打断当前任务）；要提前发某一条去队列条里点「优先」。
    const mode: SendMode = busy ? 'queue' : 'start';
    inFlightRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      await onSend({
        message,
        mode,
        ...(snapshot.length
          ? { images: snapshot.map(({ name, mimeType, data }) => ({ name, mimeType, data })) }
          : {}),
      });
      // 只有 resolve 才清空；按快照比对，等待期间新敲的字 / 新选的图都留着。
      setValue((current) => (current.trim() === message ? '' : current));
      if (samePickedImages(imagesRef.current, snapshot)) applyImages([]);
      if (mode === 'queue') setNotice({ text: '已加入排队，当前任务结束后自动发送', tone: 'info' });
      void Haptics.selectionAsync().catch(() => {});
    } catch (error) {
      // rejected：草稿与附件原样保留，用户可以原地重试。
      setNotice({ text: `发送失败：${errorText(error)}。草稿与附件已保留，可重试`, tone: 'error' });
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const stop = async () => {
    if (readOnly || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      await onInterrupt();
    } catch (error) {
      setNotice({ text: `中断失败：${errorText(error)}。任务可能仍在运行`, tone: 'error' });
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  /** 队列操作（清空 / 优先 / 删除）统一切到这条通道：单一在途、失败有反馈、无未处理 Promise。 */
  const runQueueAction = async (key: string, run: () => void | Promise<void>, success: string) => {
    if (queueActionRef.current) return;
    queueActionRef.current = true;
    setPendingQueueKey(key);
    setNotice(null);
    try {
      await run();
      setNotice({ text: success, tone: 'info' });
    } catch (error) {
      setNotice({ text: `操作失败：${errorText(error)}。列表会在下次刷新后同步`, tone: 'error' });
    } finally {
      queueActionRef.current = false;
      setPendingQueueKey(null);
    }
  };

  const fromAlbum = async () => {
    if (picking || readOnly) return;
    setAttachOpen(false);
    setPicking(true);
    try {
      const picked = await pickImages();
      if (!picked.length) {
        // 取消与「权限被拒」在 picker 里都返回空数组：不编造原因，只说明草稿没被动。
        setNotice({ text: '没有选中图片（也可能是相册权限被拒绝）。草稿已保留', tone: 'info' });
        return;
      }
      appendImages(picked);
    } catch (error) {
      setNotice({ text: `打开相册失败：${errorText(error)}。草稿与已选图片已保留`, tone: 'error' });
    } finally {
      setPicking(false);
    }
  };

  const fromFiles = async () => {
    if (picking || readOnly) return;
    setAttachOpen(false);
    setPicking(true);
    try {
      const { images: picked, skipped, unavailable } = await pickFiles();
      if (unavailable) {
        setNotice({ text: '当前安装包未编入文件选择模块，请先用「相册」。草稿已保留', tone: 'error' });
        return;
      }
      if (picked.length) appendImages(picked);
      if (skipped > 0) {
        setNotice({ text: `已跳过 ${skipped} 项：最多 4 张，单张不超过 5 MB，支持 JPEG、PNG、WebP`, tone: 'info' });
      } else if (!picked.length) {
        setNotice({ text: '没有选中图片。草稿已保留', tone: 'info' });
      }
    } catch (error) {
      setNotice({ text: `打开文件失败：${errorText(error)}。草稿与已选图片已保留`, tone: 'error' });
    } finally {
      setPicking(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <BlurView tint={GLASS_TINT} intensity={THUMB_GLASS_INTENSITY} className="border-t border-[#E5E5EA] bg-white/85">
        <View className="pt-[8px]" style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
          {/* 队列条：仅运行中且真有排队消息时出现，默认折叠一行 */}
          {queueCount > 0 ? (
            <View
              testID="queue-bar"
              className="mb-[6px] mx-[14px] overflow-hidden rounded-[12px] border border-[#007AFF]/20 bg-[#007AFF]/[0.06]">
              <View className="flex-row items-center">
                <Pressable
                  testID="queue-toggle"
                  accessibilityRole="button"
                  accessibilityLabel={
                    queueOpen ? `收起排队，共 ${queueCount} 条` : `展开排队，共 ${queueCount} 条`
                  }
                  accessibilityHint="排队消息会在当前任务结束后依次发送，也可提前处理或删除"
                  accessibilityState={{ expanded: queueOpen }}
                  onPress={() => { setConfirmingAction(null); setQueueOpen((v) => !v); }}
                  hitSlop={HIT_SLOP}
                  className="flex-1 min-w-0 flex-row items-center gap-1 pl-2 pr-1 active:opacity-80"
                  style={{ minHeight: MIN_TOUCH }}>
                  <SymbolView
                    name={
                      queueOpen
                        ? { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }
                        : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
                    }
                    size={12}
                    tintColor={OptionA.blue}
                  />
                  <Text className="flex-1 text-[12px] font-semibold text-[#007AFF]" numberOfLines={1}>
                    {queueCount} 条排队
                    {failedCount > 0 ? `（${failedCount} 条发送失败）` : ''} · 当前任务结束后自动发送
                  </Text>
                </Pressable>
                {onClearQueue ? (
                  <Pressable
                    testID="queue-clear"
                    accessibilityRole="button"
                    accessibilityLabel={`清空全部 ${queueCount} 条排队消息`}
                    accessibilityState={{ disabled: Boolean(pendingQueueKey) }}
                    disabled={Boolean(pendingQueueKey)}
                    onPress={() => {
                      if (confirmingAction !== 'clear') {
                        setConfirmingAction('clear');
                        setNotice({ text: '再次点击确认取消全部排队消息。', tone: 'info' });
                      } else {
                        setConfirmingAction(null);
                        void runQueueAction('clear', () => onClearQueue(), '已清空排队消息');
                      }
                    }}
                    className={`items-center justify-center px-2 active:opacity-80 ${
                      pendingQueueKey ? 'opacity-40' : ''
                    }`}
                    style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }}>
                    <Text className="text-[11px] font-semibold text-[#D70015]">{confirmingAction === 'clear' ? '确认' : '清空'}</Text>
                  </Pressable>
                ) : null}
              </View>

              {queueOpen ? (
                <ScrollView
                  style={{ maxHeight: EXPANDED_QUEUE_MAX_HEIGHT }}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 4 }}>
                  {queuedMessages.length === 0 ? (
                    <Text className="px-2 py-2 text-[11px] text-[#8E8E93]">
                      排队中（明细暂不可用，可清空后重发）
                    </Text>
                  ) : null}
                  {queuedMessages.map((item, index) => {
                    const order = item.position ?? index + 1;
                    const locked = queueItemLocked(item);
                    const stateLabel = queueStateLabel(item);
                    const detail = [stateLabel, item.imageCount ? `${item.imageCount} 张图片` : '']
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <View
                        key={item.id || `q-${index}`}
                        testID={`queue-item-${index}`}
                        className="mb-[3px] flex-row items-center gap-1 rounded-[8px] bg-white/80 pl-2">
                        <Text className="w-[16px] text-[11px] font-bold text-[#8E8E93]">{order}</Text>
                        <View className="min-w-0 flex-1 py-[2px]">
                          <Text className="text-[12px] text-[#1C1C1E]" numberOfLines={1}>
                            {item.text || item.preview || '（无预览）'}
                          </Text>
                          {detail ? (
                            <Text className="text-[10px] text-[#8E8E93]" numberOfLines={1}>
                              {detail}
                            </Text>
                          ) : null}
                        </View>
                        {onQueueAction ? (
                          <>
                            <Pressable
                              testID={`queue-steer-${index}`}
                              accessibilityRole="button"
                              accessibilityLabel={locked ? `第 ${order} 条排队消息正在发送，暂不可操作` : confirmingAction === `steer:${item.id}` ? `确认提前发送第 ${order} 条` : `提前发送第 ${order} 条`}
                              accessibilityHint="可能立即插入当前任务，再次点击确认"
                              accessibilityState={{ disabled: locked || Boolean(pendingQueueKey) }}
                              disabled={locked || Boolean(pendingQueueKey)}
                              onPress={() => {
                                const key = `steer:${item.id}`;
                                if (confirmingAction !== key) {
                                  setConfirmingAction(key);
                                  setNotice({ text: '提前发送可能立即插入当前任务，再点一次确认。', tone: 'info' });
                                  return;
                                }
                                setConfirmingAction(null);
                                void runQueueAction(key, () => onQueueAction('steer', item.id), '已提交提前发送请求');
                              }}
                              className={`items-center justify-center rounded-full px-2 active:opacity-80 ${
                                locked || pendingQueueKey ? 'opacity-40' : ''
                              }`}
                              style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }}>
                              {pendingQueueKey === `steer:${item.id}` ? (
                                <ActivityIndicator size="small" color={OptionA.blue} />
                              ) : (
                                <Text className="text-[11px] font-semibold text-[#0065D1]">{confirmingAction === `steer:${item.id}` ? '确认' : '提前'}</Text>
                              )}
                            </Pressable>
                            <Pressable
                              testID={`queue-cancel-${index}`}
                              accessibilityRole="button"
                              accessibilityLabel={
                                locked
                                  ? `第 ${order} 条排队消息正在发送，暂时不能删除`
                                  : `删除第 ${order} 条排队消息`
                              }
                              accessibilityState={{ disabled: locked || Boolean(pendingQueueKey) }}
                              disabled={locked || Boolean(pendingQueueKey)}
                              onPress={() =>
                                void runQueueAction(
                                  `cancel:${item.id}`,
                                  () => onQueueAction('cancel', item.id),
                                  `已删除第 ${order} 条排队消息`
                                )
                              }
                              className={`items-center justify-center rounded-full active:opacity-80 ${
                                locked || pendingQueueKey ? 'opacity-40' : ''
                              }`}
                              style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH }}>
                              {pendingQueueKey === `cancel:${item.id}` ? (
                                <ActivityIndicator size="small" color={OptionA.inkSoft} />
                              ) : (
                                <SymbolView
                                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                                  size={13}
                                  tintColor={OptionA.inkSoft}
                                />
                              )}
                            </Pressable>
                          </>
                        ) : null}
                      </View>
                    );
                  })}
                </ScrollView>
              ) : null}
            </View>
          ) : null}

          {/* 附件预览：真实缩略图 + 44dp 移除按钮；无本地可渲染 uri 时退回图标，绝不渲染 base64 */}
          {images.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              className="mb-[6px]"
              contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}>
              {images.map((image, index) => {
                const preview = previewUriOf(image);
                const label = image.name || `图片 ${index + 1}`;
                return (
                  <View
                    key={`${label}-${index}`}
                    testID={`attachment-${index}`}
                    className="flex-row items-center gap-2 rounded-[14px] border border-[#E5E5EA] bg-white p-1">
                    {preview ? (
                      <Image
                        source={{ uri: preview }}
                        resizeMode="cover"
                        accessible
                        accessibilityLabel={`图片预览：${label}`}
                        style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: OptionA.fill }}
                      />
                    ) : (
                      <View
                        className="items-center justify-center"
                        style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: OptionA.fill }}>
                        <SymbolView
                          name={{ ios: 'photo', android: 'image', web: 'image' }}
                          size={18}
                          tintColor={OptionA.inkSoft}
                        />
                      </View>
                    )}
                    <View className="max-w-[120px]">
                      <Text className="text-[12px] text-[#1C1C1E]" numberOfLines={1}>
                        {label}
                      </Text>
                      <Text className="text-[10px] text-[#8E8E93]" numberOfLines={1}>
                        {preview ? '图片' : '图片（无预览）'}
                      </Text>
                    </View>
                    <Pressable
                      testID={`attachment-remove-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`移除图片 ${label}`}
                      hitSlop={HIT_SLOP}
                      onPress={() => removeImage(index)}
                      className="items-center justify-center rounded-full active:opacity-80"
                      style={{ height: MIN_TOUCH, width: MIN_TOUCH }}>
                      <SymbolView
                        name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
                        size={18}
                        tintColor={OptionA.redInk}
                      />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}

          {notice ? (
            <View testID="prompt-notice" accessibilityLiveRegion="polite" className="mb-[4px] px-[14px]">
              <Text
                accessibilityRole="alert"
                className="text-[11px]"
                style={{ color: notice.tone === 'error' ? OptionA.redInk : '#8A6A00' }}
                numberOfLines={3}>
                {notice.text}
              </Text>
            </View>
          ) : null}

          {/* 运行中 + 已有内容：明确写出「这一下是排队，不是打断」 */}
          {!notice && busy && hasPayload && !readOnly ? (
            <Text className="mb-[4px] px-[14px] text-[11px] text-[#8E8E93]">
              运行中发送 → 加入排队，不打断当前任务
            </Text>
          ) : null}

          {/* 附件菜单：还原原版「相册 / 文件浏览」。
              必须渲染在输入行**上方**——输入舱贴屏幕底，菜单放下面会被挤出可视区。 */}
          {attachOpen ? (
            <View className="mx-[14px] mb-[6px] overflow-hidden rounded-[12px] border border-[#E5E5EA] bg-white">
              <Pressable
                testID="attach-album"
                accessibilityRole="menuitem"
                accessibilityLabel="相册"
                disabled={blocked || picking}
                onPress={() => void fromAlbum()}
                className="flex-row items-center gap-2 border-b border-[#E5E5EA] px-3 active:opacity-80"
                style={{ minHeight: MIN_TOUCH }}>
                <SymbolView
                  name={{ ios: 'photo.on.rectangle', android: 'image', web: 'image' }}
                  size={17}
                  tintColor={OptionA.blue}
                />
                <Text className="text-[14px] text-[#1C1C1E]">相册</Text>
              </Pressable>
              <Pressable
                testID="attach-files"
                accessibilityRole="menuitem"
                accessibilityLabel="文件"
                disabled={blocked || picking}
                onPress={() => void fromFiles()}
                className="flex-row items-center gap-2 px-3 active:opacity-80"
                style={{ minHeight: MIN_TOUCH }}>
                <SymbolView
                  name={{ ios: 'folder', android: 'folder', web: 'folder' }}
                  size={17}
                  tintColor={OptionA.blue}
                />
                <Text className="text-[14px] text-[#1C1C1E]">文件</Text>
              </Pressable>
            </View>
          ) : null}

          {/* 单行主结构：附件 · 输入 · 发送/停止（互斥） */}
          <View className="flex-row items-end gap-2 px-[14px]">
            <Pressable
              testID="prompt-attach"
              accessibilityRole="button"
              accessibilityLabel={attachOpen ? '收起附件菜单' : '添加附件（相册或文件）'}
              accessibilityState={{ expanded: attachOpen, disabled: blocked || picking }}
              disabled={blocked || picking}
              onPress={() => setAttachOpen((v) => !v)}
              className={`items-center justify-center rounded-full bg-[#EFEFF4] active:opacity-80 ${
                blocked ? 'opacity-40' : ''
              }`}
              style={{ height: MIN_TOUCH, width: MIN_TOUCH }}>
              {picking ? (
                <ActivityIndicator size="small" color={OptionA.blue} />
              ) : (
                <SymbolView
                  name={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }}
                  size={19}
                  tintColor={OptionA.blue}
                />
              )}
            </Pressable>

            <TextInput
              testID="prompt-input"
              accessibilityLabel="消息输入框"
              accessibilityHint={
                readOnly ? '当前为只读模式' : busy ? '发送后会先进入排队，不打断当前任务' : '发送后立即开始新任务'
              }
              value={value}
              onChangeText={setValue}
              onContentSizeChange={handleContentSizeChange}
              placeholder={readOnly ? '只读模式' : busy ? '追加消息（排队，不中断）' : '输入消息…'}
              placeholderTextColor={OptionA.inkSoft}
              editable={!blocked}
              multiline
              scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
              className="min-w-0 flex-1 rounded-[22px] bg-[#EFEFF4] text-[15px] text-[#1C1C1E]"
              style={{
                height: inputHeight,
                paddingTop: INPUT_PADDING_V,
                paddingBottom: INPUT_PADDING_V,
                paddingHorizontal: 16,
                lineHeight: INPUT_LINE_HEIGHT,
              }}
            />

            {showStop ? (
              <Pressable
                testID="prompt-stop"
                accessibilityRole="button"
                accessibilityLabel="中断当前任务"
                accessibilityHint="停止正在运行的任务，已经排队的消息会保留"
                accessibilityState={{ disabled: blocked }}
                disabled={blocked}
                onPress={() => void stop()}
                className={`items-center justify-center rounded-full bg-[#FF3B30] active:opacity-80 ${
                  blocked ? 'opacity-40' : ''
                }`}
                style={{ height: MIN_TOUCH, width: MIN_TOUCH }}>
                {submitting || sending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <SymbolView name={{ ios: 'stop.fill', android: 'stop', web: 'stop' }} size={15} tintColor="#FFFFFF" />
                )}
              </Pressable>
            ) : (
              <Pressable
                testID="prompt-send"
                accessibilityRole="button"
                accessibilityLabel={busy ? '加入排队并发送' : '发送消息'}
                accessibilityHint={
                  busy ? '当前任务不会被中断，这条消息会在它结束后发送' : '立即发送并开始新任务'
                }
                accessibilityState={{ disabled: !hasPayload || blocked }}
                disabled={!hasPayload || blocked}
                onPress={() => void submit()}
                className={`items-center justify-center rounded-full bg-[#007AFF] active:opacity-80 ${
                  !hasPayload || blocked ? 'opacity-40' : ''
                }`}
                style={{ height: MIN_TOUCH, width: MIN_TOUCH }}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <SymbolView
                    name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
                    size={19}
                    tintColor="#FFFFFF"
                  />
                )}
              </Pressable>
            )}
          </View>

          {readOnly ? (
            <Text className="pt-1 text-center text-[12px] text-[#D70015]">只读模式：发送 / 中断 / 审批已禁用</Text>
          ) : null}
        </View>
      </BlurView>
    </KeyboardAvoidingView>
  );
}
