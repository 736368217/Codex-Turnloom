/** Secure terminal storage with migration from the original single-device keys. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { DEMO_MODE, DEMO_PAIRING } from './demoBootstrap';
import { createTerminalStore, type StorageAdapter, type StoredTerminal, type TerminalSnapshot } from './terminalStore';

export type PairingConfig = {
  serverUrl: string;
  token: string;
  machineName: string;
};
export type { StoredTerminal, TerminalSnapshot };

const WEB_PREFIX = 'turnloom.pairing.';
const storage: StorageAdapter = {
  async get(key) {
    if (Platform.OS !== 'web') return SecureStore.getItemAsync(key);
    if (typeof localStorage === 'undefined') throw new Error('本机存储不可用');
    return localStorage.getItem(WEB_PREFIX + key);
  },
  async set(key, value) {
    if (Platform.OS !== 'web') return SecureStore.setItemAsync(key, value);
    if (typeof localStorage === 'undefined') throw new Error('本机存储不可用');
    localStorage.setItem(WEB_PREFIX + key, value);
  },
  async remove(key) {
    if (Platform.OS !== 'web') return SecureStore.deleteItemAsync(key);
    if (typeof localStorage === 'undefined') throw new Error('本机存储不可用');
    localStorage.removeItem(WEB_PREFIX + key);
  },
};

export function normalizeServerUrl(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

const terminalStore = createTerminalStore(storage, normalizeServerUrl, () =>
  `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);
const demoTerminal: StoredTerminal = { id: 'demo', ...DEMO_PAIRING, cacheVersion: 0 };

export async function readTerminals(): Promise<TerminalSnapshot> {
  if (DEMO_MODE) return { terminals: [demoTerminal], activeId: demoTerminal.id };
  return terminalStore.read();
}

export async function saveTerminal(config: PairingConfig, options: { id?: string; activate?: boolean } = {}): Promise<StoredTerminal> {
  if (DEMO_MODE) throw new Error('演示模式不能修改电脑连接');
  return terminalStore.upsert(config, options);
}

export async function activateTerminal(id: string): Promise<StoredTerminal> {
  if (DEMO_MODE && id === demoTerminal.id) return demoTerminal;
  if (DEMO_MODE) throw new Error('演示模式不能切换电脑');
  return terminalStore.activate(id);
}

export async function removeTerminal(id: string): Promise<void> {
  if (DEMO_MODE) throw new Error('演示模式不能解除配对');
  await terminalStore.remove(id);
}

export async function readPairing(): Promise<PairingConfig | null> {
  const snapshot = await readTerminals();
  const selected = snapshot.terminals.find((item) => item.id === snapshot.activeId);
  return selected ? { serverUrl: selected.serverUrl, token: selected.token, machineName: selected.machineName } : null;
}

export async function savePairing(config: PairingConfig): Promise<PairingConfig> {
  const selected = await saveTerminal(config, { activate: true });
  return { serverUrl: selected.serverUrl, token: selected.token, machineName: selected.machineName };
}

export async function clearPairing(): Promise<void> {
  const snapshot = await readTerminals();
  if (snapshot.activeId) await removeTerminal(snapshot.activeId);
}

export async function updateAccessToken(token: string): Promise<void> {
  const snapshot = await readTerminals();
  const selected = snapshot.terminals.find((item) => item.id === snapshot.activeId);
  if (!selected) throw new Error('请先连接电脑');
  await saveTerminal({ ...selected, token }, { id: selected.id });
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
