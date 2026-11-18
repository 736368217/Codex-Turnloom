/**
 * Option A · Cupertino Daylight Glass — 跨端共享的日光雾白背景。
 *
 * Web 端由 index.css 的 .daylight-canvas 实现；RN 端用 expo-linear-gradient
 * 生成同样的「户外阳光 + 淡蓝/暖光」层次。玻璃 BlurView 叠在它上面，
 * Android 上也能看到通透感（expo-blur 在 Android 效果有限，渐变兜底）。
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

const COLORS = [
  '#F6F9FF',
  '#EFF3FB',
  '#E9EEF7',
  '#EDF0F6',
  '#F4F1F6',
] as const;

export function DaylightBackdrop({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[...COLORS]}
        locations={[0, 0.28, 0.58, 0.82, 1]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.glowTopRight} pointerEvents="none" />
      <View style={styles.glowBottomLeft} pointerEvents="none" />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#EEF1F7' },
  content: { flex: 1 },
  glowTopRight: {
    position: 'absolute',
    top: -70,
    right: -60,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(0,122,255,0.10)',
  },
  glowBottomLeft: {
    position: 'absolute',
    bottom: 40,
    left: -80,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255,205,150,0.12)',
  },
});
