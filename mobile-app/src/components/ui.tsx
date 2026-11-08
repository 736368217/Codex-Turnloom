/**
 * Shared light-only UI primitives in the spirit of React Native Reusables:
 * small composable pieces with explicit Option A tokens, no dark branch.
 */
import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { A, OptionA } from '@/constants/optionA';

export type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
};

/** White inset grouped card. */
export function Card({ children, style, className }: CardProps) {
  return (
    <View className={`${A.card} ${className ?? ''}`} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export type PressableCardProps = PressableProps & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function PressableCard({ children, style, ...props }: PressableCardProps) {
  return (
    <Pressable
      {...props}
      style={({ pressed }) => [
        styles.card,
        style,
        { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}>
      {children}
    </Pressable>
  );
}

export function Separator({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.separator, { marginLeft: inset }]} />;
}

export type BadgeProps = {
  label: string;
  tone?: 'blue' | 'green' | 'red' | 'neutral';
};

const badgeTones: Record<NonNullable<BadgeProps['tone']>, { bg: string; ink: string }> = {
  blue: { bg: '#E5F1FF', ink: OptionA.blue },
  green: { bg: '#E4F8E9', ink: OptionA.greenInk },
  red: { bg: '#FDECEC', ink: OptionA.redInk },
  neutral: { bg: OptionA.fill, ink: OptionA.inkSoft },
};

export function Badge({ label, tone = 'blue' }: BadgeProps) {
  const colors = badgeTones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export type PrimaryButtonProps = PressableProps & {
  label: string;
  tone?: 'blue' | 'green' | 'red' | 'neutral';
  disabled?: boolean;
};

const buttonTones: Record<NonNullable<PrimaryButtonProps['tone']>, string> = {
  blue: OptionA.blue,
  green: OptionA.green,
  red: OptionA.red,
  neutral: OptionA.fill,
};

export function PrimaryButton({ label, tone = 'blue', disabled, style, ...props }: PrimaryButtonProps) {
  const background = buttonTones[tone];
  const ink = tone === 'neutral' ? OptionA.ink : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      {...props}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        pressed && !disabled ? styles.pressed : null,
        style as StyleProp<ViewStyle>,
      ]}>
      <Text style={[styles.buttonText, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export type RoundedInputProps = TextInputProps;

export function RoundedInput(props: RoundedInputProps) {
  return (
    <TextInput
      placeholderTextColor={OptionA.inkSoft}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function DragHandle() {
  return (
    <View style={styles.dragHandleRow}>
      <View style={styles.dragHandle} />
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: OptionA.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(229,229,234,0.7)',
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: OptionA.separator,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  button: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  input: {
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: OptionA.fill,
    paddingHorizontal: 16,
    color: OptionA.ink,
    fontSize: 15,
  },
  dragHandleRow: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
  },
  dragHandle: {
    width: 36,
    height: 6,
    borderRadius: 999,
    backgroundColor: OptionA.drag,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: OptionA.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  emptyState: {
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: OptionA.ink,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyHint: {
    color: OptionA.inkSoft,
    fontSize: 13,
    textAlign: 'center',
  },
});
