'use strict';

function createRequestGate() {
  let version = 0;
  return {
    issue() { version += 1; return version; },
    isCurrent(ticket) { return ticket === version; },
    invalidate() { version += 1; },
  };
}

function createRetryKey(makeId, now = Date.now, ttlMs = 240000) {
  let pending = null;
  function sameImages(a, b) {
    const left = a || [];
    const right = b || [];
    return left.length === right.length && left.every((image, i) =>
      image.name === right[i].name && image.mimeType === right[i].mimeType && image.data === right[i].data);
  }
  return {
    get(payload) {
      const matches = pending && pending.threadId === payload.threadId && pending.message === payload.message &&
        pending.mode === payload.mode && sameImages(pending.images, payload.images);
      if (matches && now() - pending.createdAt >= ttlMs) {
        // The previous send's outcome is no longer confirmable. Do not reuse its
        // idempotency key forever: retire it and start a fresh attempt instead of
        // deadlocking the composer on the same text. The old request may still
        // arrive server-side, so the next attempt is intentionally a new id.
        pending = { ...payload, images: payload.images ? payload.images.map((image) => ({ ...image })) : [], id: makeId(), createdAt: now() };
      } else if (!matches) {
        pending = { ...payload, images: payload.images ? payload.images.map((image) => ({ ...image })) : [], id: makeId(), createdAt: now() };
      }
      return pending.id;
    },
    clear() { pending = null; },
  };
}

module.exports = { createRequestGate, createRetryKey };
