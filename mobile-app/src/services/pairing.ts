/**
 * Turnloom pairing/storage layer.
 *
 * `expo-secure-store` is the iOS Keychain / Android Keystore on native. It has
 * no web implementation in SDK 58, so a localStorage mirror is used on web for
 * `expo export --platform web` validation. Connection credentials remain the
 * only secret held here; conversation cache goes through `conversationCache.ts`.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type PairingConfig = {
  serverUrl: string;
  token: string;
  machineName: string;
};

const KEY_URL = 'turnloom.pairing.serverUrl';
const KEY_TOKEN = 'turnloom.pairing.token';
const KEY_NAME = 'turnloom.pairing.machineName';

const WEB_PREFIX = 'turnloom.pairing.';

function webGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(WEB_PREFIX + key);
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(WEB_PREFIX + key, value);
  } catch {
    /* storage unavailable (private mode) — pairing just won't persist */
  }
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webGet(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

/** Normalizes a user/QR supplied URL into an absolute origin without a trailing slash. */
export function normalizeServerUrl(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export async function readPairing(): Promise<PairingConfig | null> {
  const [serverUrl, token, machineName] = await Promise.all([
    getItem(KEY_URL),
    getItem(KEY_TOKEN),
    getItem(KEY_NAME),
  ]);
  const normalized = normalizeServerUrl(serverUrl || '');
  if (!normalized) return null;
  return {
    serverUrl: normalized,
    token: token || '',
    machineName: machineName || '',
  };
}

export async function savePairing(config: PairingConfig): Promise<PairingConfig> {
  const normalized = normalizeServerUrl(config.serverUrl);
  if (!normalized) throw new Error('Invalid server URL');
  const next: PairingConfig = {
    serverUrl: normalized,
    token: String(config.token || ''),
    machineName: String(config.machineName || '').trim(),
  };
  await Promise.all([
    setItem(KEY_URL, next.serverUrl),
    setItem(KEY_TOKEN, next.token),
    setItem(KEY_NAME, next.machineName),
  ]);
  return next;
}

export async function clearPairing(): Promise<void> {
  if (Platform.OS === 'web') {
    [KEY_URL, KEY_TOKEN, KEY_NAME].forEach((key) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(WEB_PREFIX + key);
      } catch {
        /* ignore */
      }
    });
    return;
  }
  await Promise.all(
    [KEY_URL, KEY_TOKEN, KEY_NAME].map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => undefined)
    )
  );
}

/** Only updates the access code (used by the 401 re-auth gate). */
export async function updateAccessToken(token: string): Promise<void> {
  await setItem(KEY_TOKEN, String(token || ''));
}

export type QRParseResult = {
  serverUrl: string;
  token: string;
  machineName: string;
};

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value) => String(value || '').trim().length > 0)?.trim() || '';
}

/**
 * Parses both real QR formats produced by the host:
 *  1. `codexpocket://add?name=<machine>&url=<serverUrl>&token=<accessCode>`
 *     (scripts/print-device-qr.js:26-30)
 *  2. `http(s)://host/login?token=<accessCode>&device=<profile>` (runtime QR,
 *     server.js:766-771) and its `.../#login=<token>` variant.
 * Also accepts a plain server URL (token may be entered manually afterwards).
 */
export function parsePairingQR(raw: string): QRParseResult | null {
  const value = String(raw || '').trim();
  if (!value) return null;

  // Hash-based login link: https://host/#login=<token>
  if (value.includes('#login=')) {
    try {
      const url = new URL(value);
      const token = new URLSearchParams(url.hash.replace(/^#/, '')).get('login') || '';
      const origin = `${url.protocol}//${url.host}`;
      const serverUrl = normalizeServerUrl(origin);
      return serverUrl ? { serverUrl, token, machineName: '' } : null;
    } catch {
      return null;
    }
  }

  // codexpocket://add?... — URL() handles custom schemes fine.
  if (/^codexpocket:\/\/add/i.test(value)) {
    try {
      const url = new URL(value);
      const params = url.searchParams;
      const serverUrl = normalizeServerUrl(firstNonEmpty(params.get('url'), params.get('baseUrl')));
      if (!serverUrl) return null;
      return {
        serverUrl,
        token: firstNonEmpty(params.get('token'), params.get('accessCode')),
        machineName: firstNonEmpty(params.get('name'), params.get('device'), params.get('machineName')),
      };
    } catch {
      return null;
    }
  }

  // Runtime login link: https://host/login?token=...&device=...
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const isLogin = url.pathname === '/login' || url.pathname === '/';
      const token = firstNonEmpty(url.searchParams.get('token'), url.searchParams.get('accessCode'));
      const device = firstNonEmpty(url.searchParams.get('device'), url.searchParams.get('name'));
      if (isLogin && token) {
        const serverUrl = normalizeServerUrl(`${url.protocol}//${url.host}`);
        return serverUrl ? { serverUrl, token, machineName: device } : null;
      }
      const serverUrl = normalizeServerUrl(`${url.protocol}//${url.host}`);
      return serverUrl ? { serverUrl, token, machineName: device } : null;
    } catch {
      return null;
    }
  }

  const serverUrl = normalizeServerUrl(value);
  return serverUrl ? { serverUrl, token: '', machineName: '' } : null;
}
