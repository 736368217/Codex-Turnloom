/**
 * 底部拇指输入舱。按 v5 修订：整排快捷指令胶囊已删除
 * （规范只说「提供胶囊」未定义点击行为，原实现仅回填文字，属半成品按钮）。
 * 保留 BlurView(90)、输入指令…、蓝色发送 / 红色「中断」、Haptics。
 * 组件原语来自 React Native Reusables 的复制式用法（src/components/ui/*），
 * 布局改用 NativeWind className。
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_TINT, OptionA, THUMB_GLASS_INTENSITY } from '@/constants/optionA';
import { Button, Text } from '@/components/ui/rnr';

export type ThumbPromptBarProps = {
  busy?: boolean;
  readOnly?: boolean;
  sending?: boolean;
  onSend: (message: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
};

export function ThumbPromptBar({
  busy = false,
  readOnly = false,
  sending = false,
  onSend,
  onInterrupt,
}: ThumbPromptBarProps) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');

  const submit = async () => {
    const message = value.trim();
    if (!message || readOnly || sending || busy) return;
    await onSend(message);
    setValue('');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <BlurView
        tint={GLASS_TINT}
        intensity={THUMB_GLASS_INTENSITY}
        className="border-t border-[#E5E5EA] bg-white/85">
        <View
          className="flex-row items-center gap-2 px-[14px] pt-[10px]"
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="输入指令…"
            placeholderTextColor={OptionA.inkSoft}
            editable={!readOnly && !sending}
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            className="h-11 min-w-0 flex-1 rounded-full bg-[#EFEFF4] px-4 text-[15px] text-[#1C1C1E]"
          />

          {busy ? (
            <Button
              variant="destructive"
              disabled={readOnly}
              onPress={async () => {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                await onInterrupt();
              }}
              className="h-11 min-w-[86px] rounded-full bg-[#FF3B30]">
              <Text className="text-[14px] font-bold text-white">中断</Text>
            </Button>
          ) : (
            <Button
              disabled={readOnly || sending || !value.trim()}
              onPress={() => void submit()}
              className="h-11 min-w-[86px] rounded-full bg-[#007AFF]">
              <Text className="text-[14px] font-bold text-white">{sending ? '…' : '发送'}</Text>
            </Button>
          )}
        </View>
        {readOnly ? (
          <Text className="pb-2 text-center text-[12px] text-[#D70015]">只读模式：发送 / 中断 / 审批已禁用</Text>
        ) : null}
      </BlurView>
    </KeyboardAvoidingView>
  );
}
