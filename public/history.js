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

export function shouldHydrateConversationCache({ preserveScrollPosition = false } = {}) {
  return !preserveScrollPosition;
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

function pendingMessageForRealUser(pendingMessages, message, threadId) {
  return (Array.isArray(pendingMessages) ? pendingMessages : []).find((pending) => {
    if (pending?.threadId !== threadId) return false;
    if (!visibleContentMatches(pending.sentContent || pending.content, message.content)) return false;
    return normalizedMessageContent(message.content) || messageImageCount(message) > 0;
  });
}

function restorePendingImages(realMessage, pendingMessage) {
  if (!pendingMessage) return realMessage;
  const pendingImages = [
    ...(Array.isArray(pendingMessage.images) ? pendingMessage.images : []),
    ...(Array.isArray(pendingMessage.localImages) ? pendingMessage.localImages : [])
  ];
  if (!pendingImages.length) return realMessage;
  const realImages = [
    ...(Array.isArray(realMessage.images) ? realMessage.images : []),
    ...(Array.isArray(realMessage.localImages) ? realMessage.localImages : [])
  ];
  if (realImages.length >= pendingImages.length) return realMessage;
  // PI rollout can persist the text before it persists the staged attachment.
  // Keep the optimistic preview attached to the real user row until the host
  // reports its own image, otherwise a successfully sent photo disappears.
  return {
    ...realMessage,
    images: [...(Array.isArray(realMessage.images) ? realMessage.images : []), ...pendingImages],
    localImages: Array.isArray(realMessage.localImages) ? realMessage.localImages : [],
    restoredAttachments: true
  };
}

export function reconcilePendingMessages(pendingMessages, messages, threadId) {
  const realMessages = Array.isArray(messages) ? messages : [];
  const realUsers = realMessages.filter((message) => message?.role === "user");
  const restored = realMessages.map((message) => message?.role === "user"
    ? restorePendingImages(message, pendingMessageForRealUser(pendingMessages, message, threadId))
    : message);
  Object.defineProperty(restored, "restoredPendingImages", { value: true, enumerable: false });
  return (Array.isArray(pendingMessages) ? pendingMessages : []).filter((pendingMessage) => {
    if (pendingMessage?.threadId !== threadId) return true;
    const pendingContent = pendingMessage.sentContent || pendingMessage.content;
    const pendingImages = messageImageCount(pendingMessage);
    return !realUsers.some((message) => {
      if (!visibleContentMatches(pendingContent, message.content)) return false;
      if (normalizedMessageContent(message.content)) {
        // A text-only rollout row is not enough to discard an image-bearing
        // optimistic message; PI may write the image separately.
        return pendingImages === 0 || messageImageCount(message) >= pendingImages;
      }
      return messageImageCount(message) >= pendingImages;
    });
  });
}
