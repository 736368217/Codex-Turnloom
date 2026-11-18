/**
 * Deterministic Material Symbols icon set for the native app.
 *
 * `expo-symbols` loads its Android font at runtime from a Metro numeric asset
 * id. On Android builds where that dynamic URI does not resolve, it silently
 * renders an empty View, which is why tab icons and composer controls can
 * disappear. This component loads the same variable font from a checked-in
 * app asset and uses a compact code-point map for every icon used by the app.
 */
import { loadAsync } from 'expo-font';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

const FONT_NAME = 'TurnloomMaterialSymbols';
const FONT_SOURCE = require('@expo-google-fonts/material-symbols/400Regular/MaterialSymbols_400Regular.ttf');

/** Code points from Material Symbols 400Regular, restricted to UI usage. */
const CODES = {
  add: 0xe145,
  alternate_email: 0xe0e6,
  arrow_drop_down: 0xe5c5,
  arrow_upward: 0xe5d8,
  attach_file: 0xe226,
  cancel: 0xe5c9,
  chat: 0xe0b7,
  check: 0xe5ca,
  chevron_right: 0xe5cc,
  close: 0xe5cd,
  desktop_windows: 0xe30c,
  expand_less: 0xe5ce,
  expand_more: 0xe5cf,
  folder: 0xe2c7,
  image: 0xe3f4,
  qr_code_scanner: 0xf206,
  settings: 0xe8b8,
  stop: 0xe047,
  unfold_more: 0xe5d7,
} as const;

export type IconName = keyof typeof CODES;

const FALLBACK_GLYPHS: Partial<Record<IconName, string>> = {
  add: '+',
  alternate_email: '@',
  arrow_drop_down: '▾',
  arrow_upward: '↑',
  attach_file: '📎',
  cancel: '×',
  chat: '▢',
  check: '✓',
  chevron_right: '›',
  close: '×',
  desktop_windows: '▣',
  expand_less: '⌃',
  expand_more: '⌄',
  folder: '▤',
  image: '▧',
  qr_code_scanner: '▦',
  settings: '⚙',
  stop: '■',
  unfold_more: '↕',
};

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glyph: {
    includeFontPadding: false,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
});

let fontPromise: Promise<void> | null = null;
function loadIconFont(): Promise<void> {
  if (!fontPromise) {
    fontPromise = loadAsync({ [FONT_NAME]: FONT_SOURCE }).then(
      () => undefined,
      () => undefined,
    );
  }
  return fontPromise;
}

export type IconProps = {
  name: IconName | { ios?: string; android?: IconName; web?: IconName };
  size?: number;
  tintColor?: string;
  style?: any;
};

export function Icon({ name, size = 20, tintColor = '#1C1C1E', style }: IconProps) {
  const [fontLoaded, setFontLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void loadIconFont().then(() => {
      if (active) setFontLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const iconName: IconName =
    typeof name === 'object' && name !== null ? name.android ?? name.web ?? 'check' : name;
  const code = CODES[iconName];
  const glyph = fontLoaded
    ? String.fromCharCode(code)
    : FALLBACK_GLYPHS[iconName] ?? '•';
  return (
    <View collapsable={false} style={[styles.box, { width: size, height: size }, style]}>
      <Text
        allowFontScaling={false}
        style={[
          styles.glyph,
          {
            color: tintColor,
            fontFamily: fontLoaded ? FONT_NAME : undefined,
            fontSize: size,
            lineHeight: size,
          },
        ]}>
        {glyph}
      </Text>
    </View>
  );
}

/** Drop-in alias so call sites can read naturally. */
export const SymbolView = Icon;
