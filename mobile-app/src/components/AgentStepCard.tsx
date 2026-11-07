/**
 * Collapsible AI Thinking / Terminal Log card. #EFEFF4 fill, single-line
 * collapsed state with a running timer, reanimated smooth expansion.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { OptionA } from '@/constants/optionA';

export type AgentStepCardProps = {
  kind?: 'thinking' | 'terminal';
  title?: string;
  /** Mono-spaced log body; shown only when expanded. */
  content?: string;
  status?: string;
  timer?: string;
  defaultExpanded?: boolean;
};

export function AgentStepCard({
  kind = 'thinking',
  title,
  content = '',
  status,
  timer = '',
  defaultExpanded = false,
}: AgentStepCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [measured, setMeasured] = useState(0);
  const progress = useSharedValue(defaultExpanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, { duration: 220 });
  }, [expanded, progress]);

  const bodyStyle = useAnimatedStyle(() => ({
    height: measured ? progress.value * measured : progress.value ? undefined : 0,
    opacity: progress.value,
    overflow: 'hidden',
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));

  const label = title || (kind === 'thinking' ? 'AI Thinking...' : 'Terminal Log');

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={[styles.dot, kind === 'terminal' && styles.dotTerminal]} />
        <Text style={styles.title} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.timer} numberOfLines={1}>
          {status || timer || (expanded ? '' : '收起')}
        </Text>
        <Animated.Text style={[styles.chevron, chevronStyle]}>⌄</Animated.Text>
      </Pressable>

      {/* Hidden measurement copy keeps the animated height exact. */}
      <View
        style={styles.measure}
        onLayout={(event) => {
          const height = Math.ceil(event.nativeEvent.layout.height);
          if (height > 0 && height !== measured) setMeasured(height);
        }}>
        <Text style={styles.log}>{content || '暂无日志'}</Text>
      </View>

      <Animated.View style={bodyStyle}>
        <Text style={styles.log} selectable>
          {content || '暂无日志'}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: OptionA.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: OptionA.separator,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: OptionA.inkSoft,
  },
  dotTerminal: {
    backgroundColor: OptionA.blue,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: OptionA.ink,
  },
  timer: {
    fontSize: 12,
    color: OptionA.inkSoft,
    maxWidth: 130,
  },
  chevron: {
    fontSize: 16,
    color: OptionA.inkSoft,
    marginLeft: 4,
  },
  measure: {
    position: 'absolute',
    opacity: 0,
    left: 14,
    right: 14,
    pointerEvents: 'none',
  },
  log: {
    fontSize: 12,
    lineHeight: 18,
    color: OptionA.ink,
    fontFamily: 'monospace',
    paddingVertical: 6,
  },
});
