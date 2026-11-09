import { StyleSheet, View } from 'react-native';

import { Badge as RnrBadge, Button as RnrButton, Card, Text as RnrText, type ButtonProps } from './ui/rnr';

export { Card };

export type BadgeProps = { label: string; tone?: 'blue' | 'green' | 'red' | 'neutral' };

export function Badge({ label, tone = 'blue' }: BadgeProps) {
  const variant = tone === 'green' ? 'success' : tone === 'red' ? 'destructive' : tone === 'neutral' ? 'secondary' : 'default';
  return <RnrBadge variant={variant} className="min-h-[28px]"><RnrText className="text-[13px]">{label}</RnrText></RnrBadge>;
}

export function Separator({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.separator, { marginLeft: inset }]} />;
}

export type PrimaryButtonProps = Omit<ButtonProps, 'variant' | 'size' | 'children'> & {
  label: string;
  tone?: 'blue' | 'green' | 'red' | 'neutral';
};

export function PrimaryButton({ label, tone = 'blue', ...props }: PrimaryButtonProps) {
  const variant = tone === 'green' ? 'success' : tone === 'red' ? 'destructive' : tone === 'neutral' ? 'secondary' : 'default';
  return <RnrButton variant={variant} size="default" className="min-h-[44px] px-4" {...props}><RnrText>{label}</RnrText></RnrButton>;
}

export function DragHandle() {
  return <View style={styles.dragHandleRow}><View style={styles.dragHandle} /></View>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return <View style={styles.emptyState}><RnrText className="text-[15px] font-semibold text-[#1C1C1E]">{title}</RnrText>{hint ? <RnrText className="text-center text-[13px] text-[#6D6D72]">{hint}</RnrText> : null}</View>;
}

const styles = StyleSheet.create({
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA' },
  dragHandleRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  dragHandle: { width: 36, height: 6, borderRadius: 999, backgroundColor: '#C7C7CC' },
  emptyState: { paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 6 },
});
