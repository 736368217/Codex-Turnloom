export const MESSAGE_PAGE_SIZE = 40;
export const MAX_MESSAGE_HISTORY = 1000;

export function messageScrollMode({
  cacheHydration = false,
  force = false,
  preserveScrollPosition = false,
  wasNearBottom = false
} = {}) {
  if (preserveScrollPosition) return "retain";
  if (cacheHydration || force || wasNearBottom) return "latest";
  return "keep";
}

export function nextMessageLimit(currentLimit, response, pageSize = MESSAGE_PAGE_SIZE, maxLimit = MAX_MESSAGE_HISTORY) {
  const hasOlderMessages =
    typeof response?.hasOlderMessages === "boolean"
      ? response.hasOlderMessages
      : Boolean(response?.truncated) || Number(response?.omittedMessages) > 0;
  if (!hasOlderMessages) return null;
  const current = Math.max(pageSize, Number(currentLimit) || pageSize);
  if (current >= maxLimit) return null;
  return Math.min(maxLimit, current + pageSize);
}

export function retainedScrollTop({ scrollTop, scrollHeight, nextScrollHeight }) {
  return Math.max(0, Number(scrollTop) || 0) + Math.max(0, (Number(nextScrollHeight) || 0) - (Number(scrollHeight) || 0));
}

function normalizedMessageContent(content) {
  return String(content || "").replace(/\r\n/g, "\n").trim();
}

function visibleContentMatches(pendingContent, realContent) {
  const pending = normalizedMessageContent(pendingContent);
  const real = normalizedMessageContent(realContent);
  if (!pending || !real) return pending === real;
  if (pending === real) return true;
  return pending.endsWith(`\n\n${real}`) || real.endsWith(`\n\n${pending}`);
}

function messageImageCount(message) {
  return (Array.isArray(message?.images) ? message.images.length : 0) +
    (Array.isArray(message?.localImages) ? message.localImages.length : 0);
}

export function reconcilePendingMessages(pendingMessages, messages, threadId) {
  const realUsers = (Array.isArray(messages) ? messages : []).filter((message) => message?.role === "user");
  return (Array.isArray(pendingMessages) ? pendingMessages : []).filter((pendingMessage) => {
    if (pendingMessage?.threadId !== threadId) return true;
    const pendingContent = pendingMessage.sentContent || pendingMessage.content;
    const pendingImages = messageImageCount(pendingMessage);
    return !realUsers.some((message) => {
      if (!visibleContentMatches(pendingContent, message.content)) return false;
      return normalizedMessageContent(message.content) ? true : messageImageCount(message) >= pendingImages;
    });
  });
}
