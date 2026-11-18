/**
 * Weak-network conversation cache, the React Native counterpart of
 * `public/conversation-cache.js`. The web client uses IndexedDB with a
 * localStorage fallback; this module uses expo-file-system on native and
 * localStorage on web, plus an in-memory LRU for instant first paint.
 *
 * Cache keys mirror the web implementation:
 *   [origin, codexHomeVersion, threadId, messageLimit].join('|')
 */
import { Platform } from 'react-native';

type FileSystemModule = typeof import('expo-file-system/legacy');

function getFileSystem(): FileSystemModule | null {
  try {
    return require('expo-file-system/legacy') as FileSystemModule;
  } catch {
    return null;
  }
}
import type { Thread, MessagesResponse } from './types';

export const DEFAULT_MESSAGE_LIMIT = 40;

export type CachedConversation = {
  key: string;
  savedAtMs: number;
  thread: Thread | null;
  messages: MessagesResponse;
};

const WEB_PREFIX = 'turnloom.conversation.';
const MEMORY_LIMIT = 12;
const memory = new Map<string, CachedConversation>();

function safeKeyPart(value: string | number | null | undefined): string {
  return encodeURIComponent(String(value ?? ''));
}

export function terminalCacheOrigin(serverUrl: string, terminalId: string, cacheVersion: number): string {
  return `${serverUrl}#terminal=${encodeURIComponent(terminalId)}&version=${cacheVersion}`;
}

export function conversationCacheKey({
  origin = 'unknown',
  codexHomeVersion = 'unknown',
  threadId,
  messageLimit = DEFAULT_MESSAGE_LIMIT,
}: {
  origin?: string;
  codexHomeVersion?: string;
  threadId: string;
  messageLimit?: number;
}): string {
  return [origin, codexHomeVersion, threadId, messageLimit]
    .map((value) => safeKeyPart(value))
    .join('|');
}

/** Matches `isConversationCacheFresh()` in the shipped web client. */
export function isConversationCacheFresh(cached: CachedConversation | null, thread: Thread | null): boolean {
  if (!cached || !thread) return false;
  const cachedUpdatedAt = Number(cached.thread?.updatedAtMs);
  const currentUpdatedAt = Number(thread.updatedAtMs);
  if (!Number.isFinite(cachedUpdatedAt) || !Number.isFinite(currentUpdatedAt)) return true;
  return cachedUpdatedAt >= currentUpdatedAt;
}

function fileUriFor(key: string): string | null {
  const fileSystem = getFileSystem();
  if (!fileSystem) return null;
  const base = fileSystem.documentDirectory || fileSystem.cacheDirectory;
  if (!base) return null;
  // A stable, filesystem-safe filename derived from the cache key.
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(index)) | 0;
  }
  return `${base}turnloom-cache-${(hash >>> 0).toString(16)}.json`;
}

function remember(key: string, value: CachedConversation): void {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

function webGet(key: string): CachedConversation | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(WEB_PREFIX + key);
    return raw ? (JSON.parse(raw) as CachedConversation) : null;
  } catch {
    return null;
  }
}

export async function readConversationCache(key: string): Promise<CachedConversation | null> {
  const inMemory = memory.get(key);
  if (inMemory) return inMemory;

  if (Platform.OS === 'web') {
    const cached = webGet(key);
    if (cached) remember(key, cached);
    return cached;
  }

  const fileSystem = getFileSystem();
  if (!fileSystem) return null;
  const uri = fileUriFor(key);
  if (!uri) return null;
  try {
    const info = await fileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const raw = await fileSystem.readAsStringAsync(uri, { encoding: fileSystem.EncodingType.UTF8 });
    const cached = JSON.parse(raw) as CachedConversation;
    if (cached?.key !== key || !cached.messages) return null;
    remember(key, cached);
    return cached;
  } catch {
    return null;
  }
}

export async function writeConversationCache(value: CachedConversation): Promise<void> {
  remember(value.key, value);
  const serialized = JSON.stringify(value);

  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(WEB_PREFIX + value.key, serialized);
    } catch {
      /* quota exceeded — memory cache still serves this session */
    }
    return;
  }

  const fileSystem = getFileSystem();
  if (!fileSystem) return;
  const uri = fileUriFor(value.key);
  if (!uri) return;
  try {
    await fileSystem.writeAsStringAsync(uri, serialized, {
      encoding: fileSystem.EncodingType.UTF8,
    });
  } catch {
    /* best-effort persistence */
  }
}

export async function clearConversationCache(): Promise<void> {
  memory.clear();
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        const keys: string[] = [];
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key?.startsWith(WEB_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => localStorage.removeItem(key));
      }
    } catch {
      /* ignore */
    }
    return;
  }
  const fileSystem = getFileSystem();
  if (!fileSystem) return;
  const base = fileSystem.documentDirectory || fileSystem.cacheDirectory;
  if (!base) return;
  try {
    const entries = await fileSystem.readDirectoryAsync(base);
    await Promise.all(
      entries
        .filter((name) => name.startsWith('turnloom-cache-') && name.endsWith('.json'))
        .map((name) => fileSystem.deleteAsync(`${base}${name}`, { idempotent: true }).catch(() => undefined))
    );
  } catch {
    /* ignore */
  }
}

/** Remove only cache entries belonging to one unpaired server. */
export async function clearConversationCacheForOrigin(origin: string): Promise<void> {
  const prefix = `${safeKeyPart(origin)}|`;
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(WEB_PREFIX + prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
    return;
  }
  const fileSystem = getFileSystem();
  if (!fileSystem) return;
  const base = fileSystem.documentDirectory || fileSystem.cacheDirectory;
  if (!base) return;
  try {
    const entries = await fileSystem.readDirectoryAsync(base);
    for (const name of entries) {
      if (!name.startsWith('turnloom-cache-') || !name.endsWith('.json')) continue;
      const uri = `${base}${name}`;
      try {
        const cached = JSON.parse(await fileSystem.readAsStringAsync(uri, { encoding: fileSystem.EncodingType.UTF8 })) as CachedConversation;
        if (typeof cached?.key === 'string' && cached.key.startsWith(prefix)) {
          await fileSystem.deleteAsync(uri, { idempotent: true });
        }
      } catch {
        // Unreadable or unrelated cache files are left untouched.
      }
    }
  } catch {
    /* best-effort cleanup */
  }
}
