export function runningTimeLabel(status, now = Date.now(), language = "zh") {
  const start = status?.startedAtMs;
  if (!status?.thinking || !Number.isFinite(start) || start <= 0) return "";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return language === "en"
    ? `Running ${minutes}m ${seconds % 60}s`
    : `已运行 ${minutes}分${seconds % 60}秒`;
}
