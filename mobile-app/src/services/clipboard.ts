/**
 * 剪贴板：用 React Native 0.88 仍内置的 `Clipboard` 原生模块。
 *
 * 为什么不用 `expo-clipboard` / `@react-native-clipboard/clipboard`：
 * 那两个都要新增原生模块，而本机 release/原生重编被 Windows MAX_PATH 卡死
 * 加进去只会得到一个「JS 里有、APK 里没有」
 * 的崩溃点。RN 核心的 `NativeClipboard` 早已编进现有 APK，所以这里走它，
 * 代价只是一条 deprecation 警告。
 *
 * 返回值表示「是否真的写入了」，UI 必须据此提示成功/失败，不能先提示后写。
 */
type ClipboardLike = {
  setString?: (text: string) => void;
  getString?: () => Promise<string>;
};

export function copyText(text: string): boolean {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require('react-native') as { Clipboard?: ClipboardLike; default?: { Clipboard?: ClipboardLike } };
    const clipboard = rn.Clipboard ?? rn.default?.Clipboard;
    if (clipboard?.setString) {
      clipboard.setString(value);
      return true;
    }
  } catch {
    /* 老/新引擎都没有该模块时走下面的兜底 */
  }
  return false;
}
