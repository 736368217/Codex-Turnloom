export function resolveAuthToken({ urlToken = "", rememberedToken = "", nativeToken = "" } = {}) {
  return String(urlToken || rememberedToken || nativeToken || "");
}
