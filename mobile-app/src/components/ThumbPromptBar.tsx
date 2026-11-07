/**
 * Thumb-zone glass prompt bar. KeyboardAvoidingView + BlurView(90),
 * shortcut chips with Haptics.selectionAsync, #EFEFF4 input, blue Send when
 * idle and #FF3B30 Interrupt when busy (Haptics Warning + POST /api/interrupt).
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_TINT, OptionA, THUMB_GLASS_INTENSITY } from '@/constants/optionA';

export const QUICK_PROMPTS = ['检查报错', '查看改动 Diff', '继续执行', '运行测试'] as const;

export type ThumbPromptBarProps = {
  busy?: boolean;
  readOnly?: boolean;
  sending?: boolean;
  onSend: (message: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  /** If omitted, tapping a chip prefills the input with the prompt text. */
  onQuickPrompt?: (prompt: string) => void;
};

export function ThumbPromptBar({
  busy = false,
  readOnly = false,
  sending = false,
  onSend,
  onInterrupt,
  onQuickPrompt,
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
      <BlurView tint={GLASS_TINT} intensity={THUMB_GLASS_INTENSITY} style={styles.blur}>
        <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled">
            {QUICK_PROMPTS.map((prompt) => (
              <Pressable
                key={prompt}
                accessibilityRole="button"
                onPress={() => {
                  void Haptics.selectionAsync();
                  if (onQuickPrompt) onQuickPrompt(prompt);
                  else setValue(prompt);
                }}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                <Text style={styles.chipText}>{prompt}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="语音输入（占位）"
              onPress={() => void Haptics.selectionAsync()}
              style={({ pressed }) => [styles.mic, pressed && styles.pressed]}>
              <Text style={styles.micIcon}>◉</Text>
            </Pressable>

            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="输入指令…"
              placeholderTextColor={OptionA.inkSoft}
              editable={!readOnly && !sending}
              multiline={false}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
              style={styles.input}
            />

            {busy ? (
              <Pressable
                accessibilityRole="button"
                disabled={readOnly}
                onPress={async () => {
                  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  await onInterrupt();
                }}
                style={({ pressed }) => [
                  styles.action,
                  { backgroundColor: OptionA.red, opacity: readOnly ? 0.45 : pressed ? 0.8 : 1 },
                  pressed && !readOnly && styles.pressed,
                ]}>
                <Text style={styles.actionText}>中断</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={readOnly || sending || !value.trim()}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.action,
                  {
                    backgroundColor: OptionA.blue,
                    opacity: readOnly || sending || !value.trim() ? 0.45 : pressed ? 0.8 : 1,
                  },
                  pressed && !readOnly && styles.pressed,
                ]}>
                <Text style={styles.actionText}>{sending ? '…' : '发送'}</Text>
              </Pressable>
            )}
          </View>
          {readOnly ? (
            <Text style={styles.readOnlyHint}>只读模式：发送 / 中断 / 审批已禁用</Text>
          ) : null}
        </View>
      </BlurView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  blur: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OptionA.separator,
    backgroundColor: OptionA.glass,
  },
  content: {
    paddingTop: 10,
    paddingHorizontal: 14,
    gap: 8,
  },
  chips: {
    gap: 8,
    paddingRight: 14,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: OptionA.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
  },
  chipText: {
    fontSize: 13,
    color: OptionA.ink,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mic: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OptionA.card,
  },
  micIcon: {
    fontSize: 16,
    color: OptionA.blue,
  },
  input: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: OptionA.fill,
    paddingHorizontal: 16,
    fontSize: 15,
    color: OptionA.ink,
  },
  action: {
    minWidth: 86,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  readOnlyHint: {
    fontSize: 12,
    color: OptionA.redInk,
    textAlign: 'center',
  },
});
