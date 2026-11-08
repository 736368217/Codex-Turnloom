/**
 * 底部拇指输入舱（V8，与 Web 端 ThumbGlassBar 行为对齐）。
 *
 * 用户真机反馈后的设计：
 * - **单行主结构**：`[附件] [输入框] [发送 / 停止]`，不再有工具行 + 分段行两行。
 * - **发送与停止互斥**，同一位置只渲染一个：有内容→发送（运行中即排队）；空且运行中→停止。
 * - **附件还原原版语义**：一个回形针 → 弹出「相册 / 文件」菜单；
 *   相册走 expo-image-picker，文件走 expo-document-picker，两者都只采纳图片（服务端只收 images[]）。
 * - **语音已删除**（原版 voice 命中 0，本就是我们多加的）。
 * - **排队/插队不常驻**：仅 `busy && 有排队` 时出现紧凑队列条，展开后逐条「插队 / 删除」，可清空。
 * 组件原语来自 React Native Reusables 复制式用法，布局用 NativeWind className。
 */
import { SymbolView } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
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

export type QueuedItem = { id: string; text?: string; deliveryState?: string; position?: number };

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
  const [notice, setNotice] = useState('');

  const hasPayload = Boolean(value.trim() || images.length);
  /** 互斥：空输入且运行中才显示停止。 */
  const showStop = busy && !hasPayload && !readOnly;
  const blocked = readOnly || sending;

  const submit = async () => {
    const message = value.trim();
    if ((!message && images.length === 0) || blocked) return;
    await onSend({
      message,
      // 运行中默认排队（不打断）；要插队去队列条里操作。
      mode: busy && !readOnly ? 'queue' : 'start',
      ...(images.length ? { images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data })) } : {}),
    });
    setValue('');
    setImages([]);
    setNotice('');
  };

  const fromAlbum = async () => {
    if (picking || blocked) return;
    setAttachOpen(false);
    setPicking(true);
    try {
      const picked = await pickImages();
      if (picked.length) setImages((current) => [...current, ...picked].slice(0, 4));
      setNotice('');
    } finally {
      setPicking(false);
    }
  };

  const fromFiles = async () => {
    if (picking || blocked) return;
    setAttachOpen(false);
    setPicking(true);
    try {
      const { images: picked, skipped, unavailable } = await pickFiles();
      if (unavailable) {
        setNotice('当前安装包未编入文件选择模块，请先用「相册」');
        return;
      }
      if (picked.length) setImages((current) => [...current, ...picked].slice(0, 4));
      setNotice(skipped > 0 ? `已忽略 ${skipped} 个非图片文件（当前只支持图片附件）` : '');
    } finally {
      setPicking(false);
    }
  };

  const queueCount = Math.max(queueLength, queuedMessages.length);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <BlurView tint={GLASS_TINT} intensity={THUMB_GLASS_INTENSITY} className="border-t border-[#E5E5EA] bg-white/85">
        <View className="pt-[8px]" style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
          {/* 队列条：仅运行中且真有排队消息时出现，折叠一行（紧凑） */}
          {queueCount > 0 ? (
            <View
              testID="queue-bar"
              className="mb-[6px] mx-[14px] rounded-[12px] border border-[#007AFF]/20 bg-[#007AFF]/[0.06] px-2 py-[3px]">
              <View className="flex-row items-center gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="展开排队"
                  accessibilityState={{ expanded: queueOpen }}
                  onPress={() => setQueueOpen((v) => !v)}
                  className="min-h-[26px] min-w-0 flex-1 flex-row items-center gap-1 active:opacity-80">
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={12}
                    tintColor={OptionA.blue}
                  />
                  <Text className="flex-1 text-[12px] font-semibold text-[#007AFF]" numberOfLines={1}>
                    {queueCount} 条排队，完成后自动发送
                  </Text>
                </Pressable>
                {onClearQueue ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清空排队"
                    onPress={() => void onClearQueue()}
                    className="rounded-full px-2 py-1 active:opacity-80">
                    <Text className="text-[11px] font-semibold text-[#D70015]">清空</Text>
                  </Pressable>
                ) : null}
              </View>
              {queueOpen ? (
                <View className="pt-[2px]">
                  {queuedMessages.length === 0 ? (
                    <Text className="py-1 text-[11px] text-[#8E8E93]">排队中（明细暂不可用，可清空后重发）</Text>
                  ) : null}
                  {queuedMessages.map((item, index) => (
                    <View
                      key={item.id || `q-${index}`}
                      className="mb-[3px] flex-row items-center gap-2 rounded-[8px] bg-white/70 px-2 py-1">
                      <Text className="w-[14px] text-[11px] font-bold text-[#8E8E93]">{item.position ?? index + 1}</Text>
                      <Text className="min-w-0 flex-1 text-[12px] text-[#1C1C1E]" numberOfLines={1}>
                        {item.text || '（无预览）'}
                      </Text>
                      {onQueueAction ? (
                        <>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`插队-${index + 1}`}
                            onPress={() => void onQueueAction('steer', item.id)}
                            className="rounded-full bg-[#007AFF]/12 px-2 py-1 active:opacity-80">
                            <Text className="text-[11px] font-semibold text-[#007AFF]">插队</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`删除排队-${index + 1}`}
                            onPress={() => void onQueueAction('cancel', item.id)}
                            className="h-[24px] w-[24px] items-center justify-center rounded-full active:opacity-80">
                            <SymbolView
                              name={{ ios: 'xmark', android: 'close', web: 'close' }}
                              size={13}
                              tintColor={OptionA.inkSoft}
                            />
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* 附件预览：仅选了图时才占一行 */}
          {images.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mb-[6px] pl-[14px]"
              contentContainerStyle={{ gap: 8, paddingRight: 14 }}>
              {images.map((image, index) => (
                <View
                  key={`${image.name}-${index}`}
                  className="flex-row items-center gap-1 rounded-full bg-[#EFEFF4] py-1 pl-2 pr-1">
                  <Text className="max-w-[110px] text-[11px] text-[#1C1C1E]" numberOfLines={1}>
                    {image.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="移除图片"
                    onPress={() => setImages((current) => current.filter((_, i) => i !== index))}
                    className="h-[24px] w-[24px] items-center justify-center rounded-full bg-white active:opacity-80">
                    <SymbolView
                      name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
                      size={16}
                      tintColor={OptionA.redInk}
                    />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {notice ? (
            <Text className="mb-[4px] px-[14px] text-[11px] text-[#B26A00]" numberOfLines={1}>
              {notice}
            </Text>
          ) : null}

          {/* 单行主结构：附件 · 输入 · 发送/停止（互斥） */}
          <View className="flex-row items-center gap-2 px-[14px]">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加附件"
              accessibilityState={{ expanded: attachOpen }}
              disabled={blocked || picking}
              onPress={() => setAttachOpen((v) => !v)}
              className="h-11 w-11 items-center justify-center rounded-full bg-[#EFEFF4] active:opacity-80">
              <SymbolView
                name={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }}
                size={19}
                tintColor={OptionA.blue}
              />
            </Pressable>

            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={readOnly ? '只读模式' : busy ? '追加消息（排队）' : '输入消息…'}
              placeholderTextColor={OptionA.inkSoft}
              editable={!blocked}
              multiline={false}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
              className="h-11 min-w-0 flex-1 rounded-full bg-[#EFEFF4] px-4 text-[15px] text-[#1C1C1E]"
            />

            {showStop ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="中断"
                disabled={sending}
                onPress={async () => {
                  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  await onInterrupt();
                }}
                className="h-11 w-11 items-center justify-center rounded-full bg-[#FF3B30] active:opacity-80">
                <SymbolView
                  name={{ ios: 'stop.fill', android: 'stop', web: 'stop' }}
                  size={15}
                  tintColor="#FFFFFF"
                />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="发送"
                disabled={blocked || !hasPayload}
                onPress={() => void submit()}
                className={`h-11 w-11 items-center justify-center rounded-full bg-[#007AFF] active:opacity-80 ${blocked || !hasPayload ? 'opacity-40' : ''}`}>
                <SymbolView
                  name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
                  size={19}
                  tintColor="#FFFFFF"
                />
              </Pressable>
            )}
          </View>

          {/* 附件菜单：还原原版「相册 / 文件浏览」 */}
          {attachOpen ? (
            <View className="mx-[14px] mt-[6px] overflow-hidden rounded-[12px] border border-[#E5E5EA] bg-white">
              <Pressable
                accessibilityRole="menuitem"
                accessibilityLabel="相册"
                onPress={() => void fromAlbum()}
                className="min-h-[44px] flex-row items-center gap-2 border-b border-[#E5E5EA] px-3 active:opacity-80">
                <SymbolView
                  name={{ ios: 'photo.on.rectangle', android: 'image', web: 'image' }}
                  size={17}
                  tintColor={OptionA.blue}
                />
                <Text className="text-[14px] text-[#1C1C1E]">相册</Text>
              </Pressable>
              <Pressable
                accessibilityRole="menuitem"
                accessibilityLabel="文件"
                onPress={() => void fromFiles()}
                className="min-h-[44px] flex-row items-center gap-2 px-3 active:opacity-80">
                <SymbolView
                  name={{ ios: 'folder', android: 'folder', web: 'folder' }}
                  size={17}
                  tintColor={OptionA.blue}
                />
                <Text className="text-[14px] text-[#1C1C1E]">文件</Text>
              </Pressable>
            </View>
          ) : null}

          {readOnly ? (
            <Text className="pt-1 text-center text-[12px] text-[#D70015]">只读模式：发送 / 中断 / 审批已禁用</Text>
          ) : null}
        </View>
      </BlurView>
    </KeyboardAvoidingView>
  );
}
