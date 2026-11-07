/**
 * 底部拇指输入舱。
 *
 * 顶层 UX（与 Web 端一致）：代理运行中不再把「发送」整键换成「中断」——
 * 那样用户填完字会发不出去。busy 时保留发送键（App 层用 mode:'queue'
 * 把指令排队），另给一个明确的「中断」按钮，并附一行状态说明。
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
    // busy 不再阻止发送：上层会带 mode:'queue' 排队，不打断当前任务。
    if (!message || readOnly || sending) return;
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
            placeholder={busy ? '追加指令将排队，或点中断停止当前任务' : '输入指令…'}
            placeholderTextColor={OptionA.inkSoft}
            editable={!readOnly && !sending}
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            className="h-11 min-w-0 flex-1 rounded-full bg-[#EFEFF4] px-4 text-[15px] text-[#1C1C1E]"
          />

          <Button
            disabled={readOnly || sending || !value.trim()}
            onPress={() => void submit()}
            className="h-11 min-w-[64px] rounded-full bg-[#007AFF]">
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
              className="h-11 min-w-[64px] rounded-full bg-[#FF3B30]">
              <Text className="text-[13px] font-bold text-white">中断</Text>
            </Button>
          ) : null}
        </View>
        {busy && !readOnly ? (
          <Text className="pb-1.5 text-center text-[11px] text-[#8E8E93]">
            代理运行中 · 发送的指令会排队，不会打断当前任务
          </Text>
        ) : null}
        {readOnly ? (
          <Text className="pb-2 text-center text-[12px] text-[#D70015]">只读模式：发送 / 中断 / 审批已禁用</Text>
        ) : null}
      </BlurView>
    </KeyboardAvoidingView>
  );
}
