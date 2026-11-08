/**
 * 底部拇指输入舱（V6）。
 * - placeholder 任何状态都用超短文案，杜绝窄输入框文字截断。
 * - busy && !readOnly 时在输入框上方出现紧凑「排队发送 / 直接插队」分段控件，
 *   空闲时整控件隐藏；删掉原先重复冗长的整行状态文案，改一行 ≤12 字短提示。
 * - 保留发送键（busy 也可点）与独立中断键。
 * - onSend 传对象 { message, mode, images? }，交给上层调用真实 /api/send。
 * 组件原语来自 React Native Reusables 复制式用法，布局用 NativeWind className。
 */
import { SymbolView } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_TINT, OptionA, THUMB_GLASS_INTENSITY } from '@/constants/optionA';
import { Button, Text } from '@/components/ui/rnr';
import { pickImages, type PickedImage } from '@/services/imagePicker';

export type SendMode = 'start' | 'queue' | 'steer';

export type SendPayload = {
  message: string;
  mode?: SendMode;
  images?: Array<{ name: string; mimeType: string; data: string }>;
};

export type ThumbPromptBarProps = {
  busy?: boolean;
  readOnly?: boolean;
  sending?: boolean;
  onSend: (payload: SendPayload) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
};

const HINT_QUEUE = '排队不打断当前任务';
const HINT_STEER = '直接插入当前任务';

export function ThumbPromptBar({
  busy = false,
  readOnly = false,
  sending = false,
  onSend,
  onInterrupt,
}: ThumbPromptBarProps) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<'queue' | 'steer'>('queue');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);

  const submit = async () => {
    const message = value.trim();
    // 只有图没有文字也允许发送（服务端 normalizeSendImages 允许）。
    if ((!message && images.length === 0) || readOnly || sending) return;
    await onSend({
      message,
      mode: busy && !readOnly ? mode : 'start',
      ...(images.length ? { images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data })) } : {}),
    });
    setValue('');
    setImages([]);
  };

  const addImages = async () => {
    if (picking || readOnly || sending) return;
    setPicking(true);
    try {
      const picked = await pickImages();
      if (picked.length) setImages((current) => [...current, ...picked].slice(0, 4));
    } finally {
      setPicking(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <BlurView
        tint={GLASS_TINT}
        intensity={THUMB_GLASS_INTENSITY}
        className="border-t border-[#E5E5EA] bg-white/85">
        <View className="pt-[8px]" style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
          {/* busy 分段控件：仅 busy && !readOnly 出现，空闲完全隐藏 */}
          {busy && !readOnly ? (
            <View className="mb-[6px] flex-row items-center gap-2 px-[14px]">
              <View className="flex-row gap-[3px] rounded-[10px] bg-[#EFEFF4] p-[3px]">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="发送方式-排队"
                  accessibilityState={{ selected: mode === 'queue' }}
                  onPress={() => setMode('queue')}
                  className={`min-h-[32px] min-w-[72px] items-center justify-center rounded-[8px] px-2 active:opacity-80 ${mode === 'queue' ? 'bg-white' : ''}`}>
                  <Text className={`text-[12px] font-semibold ${mode === 'queue' ? 'text-[#007AFF]' : 'text-[#8E8E93]'}`}>
                    排队发送
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="发送方式-插队"
                  accessibilityState={{ selected: mode === 'steer' }}
                  onPress={() => setMode('steer')}
                  className={`min-h-[32px] min-w-[72px] items-center justify-center rounded-[8px] px-2 active:opacity-80 ${mode === 'steer' ? 'bg-white' : ''}`}>
                  <Text className={`text-[12px] font-semibold ${mode === 'steer' ? 'text-[#007AFF]' : 'text-[#8E8E93]'}`}>
                    直接插队
                  </Text>
                </Pressable>
              </View>
              <Text className="flex-1 text-[11px] text-[#8E8E93]" numberOfLines={1}>
                {mode === 'queue' ? HINT_QUEUE : HINT_STEER}
              </Text>
            </View>
          ) : null}

          {/* 附件预览：缩略图 chips + 移除 */}
          {images.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mb-[6px] pl-[14px]"
              contentContainerStyle={{ gap: 8, paddingRight: 14 }}>
              {images.map((image, index) => (
                <View key={`${image.name}-${index}`} className="flex-row items-center gap-1 rounded-full bg-[#EFEFF4] py-1 pl-2 pr-1">
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

          <View className="flex-row items-center gap-2 px-[14px]">
            {/* 添加图片：expo-symbols 真图标，不用自编符号/emoji */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加图片"
              disabled={readOnly || sending || picking}
              onPress={() => void addImages()}
              className="h-11 w-11 items-center justify-center rounded-full bg-[#EFEFF4] active:opacity-80">
              <SymbolView
                name={{ ios: 'photo.on.rectangle', android: 'add_photo_alternate', web: 'add_photo_alternate' }}
                size={20}
                tintColor={OptionA.blue}
              />
            </Pressable>

            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={busy ? '追加指令…' : '输入指令…'}
              placeholderTextColor={OptionA.inkSoft}
              editable={!readOnly && !sending}
              multiline={false}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
              className="h-11 min-w-0 flex-1 rounded-full bg-[#EFEFF4] px-4 text-[15px] text-[#1C1C1E]"
            />

            <Button
              disabled={readOnly || sending || (!value.trim() && images.length === 0)}
              onPress={() => void submit()}
              className="h-11 min-w-[60px] rounded-full bg-[#007AFF]">
              <Text className="text-[14px] font-bold text-white">{sending ? '…' : '发送'}</Text>
            </Button>

            {busy ? (
              <Button
                variant="destructive"
                disabled={readOnly}
                onPress={async () => {
                  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  await onInterrupt();
                }}
                className="h-11 min-w-[60px] rounded-full bg-[#FF3B30]">
                <Text className="text-[13px] font-bold text-white">中断</Text>
              </Button>
            ) : null}
          </View>

          {readOnly ? (
            <Text className="pt-1 text-center text-[12px] text-[#D70015]">只读模式：发送 / 中断 / 审批已禁用</Text>
          ) : null}
        </View>
      </BlurView>
    </KeyboardAvoidingView>
  );
}
