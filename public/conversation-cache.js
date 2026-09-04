const DB_NAME = "codex-pocket-cache";
const DB_VERSION = 1;
const STORE_NAME = "conversations";
const FALLBACK_PREFIX = "codex-pocket-conversation:";
const DEFAULT_MESSAGE_LIMIT = 40;

function canUseLocalStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 1200);
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        finish(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      request.onblocked = () => {
        clearTimeout(timer);
        finish(null);
      };
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

function localStorageKey(key) {
  return FALLBACK_PREFIX + key;
}

export function conversationCacheKey({ origin = globalThis.location?.origin || "unknown", codexHomeVersion = "unknown", threadId, messageLimit = DEFAULT_MESSAGE_LIMIT } = {}) {
  return [origin, codexHomeVersion, threadId, messageLimit].map((value) => encodeURIComponent(String(value || ""))).join("|");
}

export async function readConversationCache(key) {
  const database = await openDatabase();
  if (database) {
    try {
      const value = await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return value;
    } catch {
      database.close();
    }
  }
  if (!canUseLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(localStorageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeConversationCache(key, data) {
  if (!key || !data || typeof data !== "object") return false;
  const value = { ...data, cachedAt: Date.now() };
  const database = await openDatabase();
  if (database) {
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.objectStore(STORE_NAME).put(value, key);
      });
      database.close();
      return true;
    } catch {
      database.close();
    }
  }
  if (!canUseLocalStorage()) return false;
  try {
    localStorage.setItem(localStorageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function clearConversationCache() {
  const database = await openDatabase();
  if (database) {
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.objectStore(STORE_NAME).clear();
      });
      database.close();
    } catch {
      database.close();
    }
  }
  if (!canUseLocalStorage()) return;
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(FALLBACK_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Cache cleanup must never block the app.
  }
}
