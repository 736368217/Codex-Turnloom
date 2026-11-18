/** Shared terminal state for the tab layout, screens and authentication recovery. */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { clearConversationCacheForOrigin, terminalCacheOrigin } from './conversationCache';
import { localRemove } from './localStore';
import {
  activateTerminal,
  normalizeServerUrl,
  readTerminals,
  removeTerminal,
  saveTerminal,
  type PairingConfig,
  type StoredTerminal,
  type TerminalSnapshot,
} from './pairing';
import { getTurnloomClient, probeConnection } from './turnloomClient';
import type { HealthResponse } from './types';

export const ACTIVE_TERMINAL_KEY = 'activeTerminalId';
const client = getTurnloomClient();
const EMPTY: TerminalSnapshot = { terminals: [], activeId: null };

type TerminalContextValue = {
  terminals: StoredTerminal[];
  terminal: StoredTerminal | null;
  connectionRevision: number;
  checking: boolean;
  storageError: string;
  health: HealthResponse | null;
  connectionState: 'checking' | 'online' | 'offline';
  authRequired: boolean;
  reload: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  connect: (config: PairingConfig) => Promise<void>;
  select: (id: string) => Promise<void>;
  update: (id: string, config: PairingConfig) => Promise<void>;
  remove: (id: string) => Promise<void>;
  requestAuth: () => void;
  dismissAuth: () => void;
  reauthenticate: (token: string) => Promise<void>;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot>(EMPTY);
  const snapshotRef = useRef<TerminalSnapshot>(EMPTY);
  const [checking, setChecking] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [connectionState, setConnectionState] = useState<'checking' | 'online' | 'offline'>('checking');
  const [authRequired, setAuthRequired] = useState(false);
  const healthSequence = useRef(0);
  const mutating = useRef(false);
  const [connectionRevision, setConnectionRevision] = useState(0);

  const sync = useCallback(async () => {
    const next = await readTerminals();
    const previous = snapshotRef.current.terminals.find((item) => item.id === snapshotRef.current.activeId);
    const active = next.terminals.find((item) => item.id === next.activeId);
    await client.refreshConfig();
    if (previous?.id !== active?.id || previous?.serverUrl !== active?.serverUrl || previous?.token !== active?.token) {
      healthSequence.current += 1;
      setHealth(null);
      setConnectionState(active ? 'checking' : 'offline');
      setConnectionRevision((value) => value + 1);
    }
    snapshotRef.current = next;
    setSnapshot(next);
    setStorageError('');
    return next;
  }, []);

  const runMutation = useCallback(async (action: () => Promise<void>) => {
    if (mutating.current) throw new Error('正在更新电脑连接，请稍后重试');
    mutating.current = true;
    try { await action(); } finally { mutating.current = false; }
  }, []);

  const reload = useCallback(async () => {
    setChecking(true);
    try {
      await sync();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [sync]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => client.onAuthRequired(() => setAuthRequired(true)), []);

  const refreshHealth = useCallback(async () => {
    const activeId = snapshotRef.current.activeId;
    const sequence = ++healthSequence.current;
    if (!activeId) {
      setHealth(null);
      setConnectionState('offline');
      return;
    }
    setConnectionState('checking');
    try {
      const result = await client.getHealth();
      if (sequence !== healthSequence.current || snapshotRef.current.activeId !== activeId) return;
      setHealth(result);
      setConnectionState(result?.ok ? 'online' : 'offline');
    } catch (error) {
      if (sequence !== healthSequence.current || snapshotRef.current.activeId !== activeId) return;
      setHealth(null);
      setConnectionState('offline');
      throw error;
    }
  }, []);

  const terminal = useMemo(
    () => snapshot.terminals.find((item) => item.id === snapshot.activeId) || null,
    [snapshot],
  );

  useEffect(() => {
    void refreshHealth().catch(() => undefined);
    return () => { healthSequence.current += 1; };
  }, [terminal?.id, terminal?.serverUrl, terminal?.token, refreshHealth]);

  const connect = useCallback((config: PairingConfig) => runMutation(async () => {
    const serverUrl = normalizeServerUrl(config.serverUrl);
    if (!serverUrl) throw new Error('服务地址格式不正确，请检查后重试');
    const normalized = { ...config, serverUrl };
    await probeConnection(normalized);
    await saveTerminal(normalized, { activate: true });
    await sync();
    setAuthRequired(false);
  }), [sync, runMutation]);

  const select = useCallback((id: string) => runMutation(async () => {
    await activateTerminal(id);
    await sync();
    setAuthRequired(false);
  }), [sync, runMutation]);

  const update = useCallback((id: string, config: PairingConfig) => runMutation(async () => {
    const old = snapshotRef.current.terminals.find((item) => item.id === id);
    const serverUrl = normalizeServerUrl(config.serverUrl);
    if (!serverUrl) throw new Error('服务地址格式不正确，请检查后重试');
    const normalized = { ...config, serverUrl };
    await probeConnection(normalized);
    await saveTerminal(normalized, { id });
    if (old && (old.serverUrl !== serverUrl || old.token !== config.token)) {
      await clearConversationCacheForOrigin(terminalCacheOrigin(old.serverUrl, old.id, old.cacheVersion)).catch(() => undefined);
    }
    await sync();
    setAuthRequired(false);
  }), [sync, runMutation]);

  const remove = useCallback((id: string) => runMutation(async () => {
    const old = snapshotRef.current.terminals.find((item) => item.id === id);
    const sharedOrigin = old && snapshotRef.current.terminals.some((item) => item.id !== id && item.serverUrl === old.serverUrl);
    await removeTerminal(id);
    const next = await sync();
    if (old) {
      await clearConversationCacheForOrigin(terminalCacheOrigin(old.serverUrl, old.id, old.cacheVersion)).catch(() => undefined);
      if (old.id === 'legacy' && !sharedOrigin) await clearConversationCacheForOrigin(old.serverUrl).catch(() => undefined);
    }
    if (!next.activeId) await localRemove(ACTIVE_TERMINAL_KEY);
    setAuthRequired(false);
  }), [sync, runMutation]);

  const reauthenticate = useCallback((token: string) => runMutation(async () => {
    const selected = snapshotRef.current.terminals.find((item) => item.id === snapshotRef.current.activeId);
    if (!selected) throw new Error('请先连接电脑');
    const next = { serverUrl: selected.serverUrl, token: token.trim(), machineName: selected.machineName };
    await probeConnection(next);
    await saveTerminal(next, { id: selected.id });
    if (selected.token !== next.token) await clearConversationCacheForOrigin(terminalCacheOrigin(selected.serverUrl, selected.id, selected.cacheVersion)).catch(() => undefined);
    await sync();
    // Re-entering the *same* access code is a valid recovery, yet it changes no
    // terminal field, so sync() would not bump the revision. Bump it explicitly
    // so thread screens restart their long poll after a 401 is cleared.
    setConnectionRevision((value) => value + 1);
    setAuthRequired(false);
  }), [sync, runMutation]);
  const requestAuth = useCallback(() => setAuthRequired(true), []);
  const dismissAuth = useCallback(() => {
    setAuthRequired(false);
    // Closing the sheet without changing credentials also has to wake up any
    // thread screen whose poll was waiting behind the authentication prompt.
    setConnectionRevision((value) => value + 1);
  }, []);

  const value = useMemo<TerminalContextValue>(() => ({
    terminals: snapshot.terminals,
    terminal,
    connectionRevision,
    checking,
    storageError,
    health,
    connectionState,
    authRequired,
    reload,
    refreshHealth,
    connect,
    select,
    update,
    remove,
    requestAuth,
    dismissAuth,
    reauthenticate,
  }), [snapshot, terminal, connectionRevision, checking, storageError, health, connectionState, authRequired, reload, refreshHealth, connect, select, update, remove, reauthenticate, requestAuth, dismissAuth]);

  return createElement(TerminalContext.Provider, { value }, children);
}

export function useTerminalSelection(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) throw new Error('TerminalProvider is missing');
  return context;
}
