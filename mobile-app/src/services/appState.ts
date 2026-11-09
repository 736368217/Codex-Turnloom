/**
 * 信息架构 v4 的轻量共享状态：当前选中的终端、当前会话、引擎偏好。
 * 数据来自真实配对配置 / 用户选择，不伪造服务端数据。
 */
import { useEffect, useState } from 'react';

import { DEMO_MODE, DEMO_PAIRING } from './demoBootstrap';
import { localGet, localSet } from './localStore';
import { getTurnloomClient } from './turnloomClient';

export type Engine = 'codex' | 'pi';

export const ACTIVE_TERMINAL_KEY = 'activeTerminalId';
export const ENGINE_KEY = 'engine';
export const SELECTED_THREAD_KEY = 'selectedThreadId';
/**
 * 预置终端只提供地址占位，不携带任何访问码。
 * 口令必须来自用户配对（配对配置或手输）；写死进包等于把访问码公开分发。
 * 演示包额外提供离线演示终端（demo 只对本地假数据生效，不是真实凭据）。
 */
export const BUILTIN_TERMINALS = [
  { id: 'builtin-de', name: '本机 · de', url: 'http://192.168.1.10:8787', token: '' },
  { id: 'demo', name: '离线演示 · 本机', url: 'http://demo.invalid', token: 'demo' },
] as const;

export type TerminalOption = {
  id: string;
  name: string;
  url: string;
  token: string;
};

export async function readActiveTerminal(): Promise<TerminalOption | null> {
  if (DEMO_MODE) {
    return { id: 'demo', name: DEMO_PAIRING.machineName, url: DEMO_PAIRING.serverUrl, token: DEMO_PAIRING.token };
  }
  const [savedId, config] = await Promise.all([localGet(ACTIVE_TERMINAL_KEY), getTurnloomClient().load()]);
  // 真实配对配置优先：用户在「终端」页改过地址后，内置常量的硬编码 URL 不能再盖回去
  // （这正是上一版「改了保存、重启又变回旧地址」的根因）。
  if (config?.serverUrl) {
    const builtin = BUILTIN_TERMINALS.find((item) => config.serverUrl.startsWith(item.url));
    return {
      id: savedId || builtin?.id || 'paired-device',
      name: config.machineName || builtin?.name || new URL(config.serverUrl).host,
      url: config.serverUrl,
      token: config.token || '',
    };
  }
  if (savedId) {
    const builtin = BUILTIN_TERMINALS.find((item) => item.id === savedId);
    if (builtin) return { ...builtin };
  }
  return null;
}

export async function saveActiveTerminal(id: string): Promise<void> {
  await localSet(ACTIVE_TERMINAL_KEY, id);
}

/** 冷启动判定：已有已选终端或已配对设备时跳过轻量选择页。 */
export function useTerminalSelection() {
  const [terminal, setTerminal] = useState<TerminalOption | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    void readActiveTerminal().then((value) => {
      if (!alive) return;
      setTerminal(value);
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const choose = async (option: TerminalOption) => {
    await saveActiveTerminal(option.id);
    setTerminal(option);
  };

  return { terminal, checking, choose };
}

/** 引擎偏好（Codex CLI / Pi Agent），只影响「终端」页的选择展示。 */
export function useEnginePreference() {
  const [engine, setEngineState] = useState<Engine>('codex');

  useEffect(() => {
    let alive = true;
    void localGet(ENGINE_KEY).then((value) => {
      if (alive && (value === 'codex' || value === 'pi')) setEngineState(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setEngine = (value: Engine) => {
    setEngineState(value);
    void localSet(ENGINE_KEY, value);
  };

  return { engine, setEngine };
}

export function useSelectedThread() {
  const [threadId, setThreadIdState] = useState('');

  useEffect(() => {
    let alive = true;
    void localGet(SELECTED_THREAD_KEY).then((value) => {
      if (alive && value) setThreadIdState(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const selectThread = (id: string) => {
    setThreadIdState(id);
    void localSet(SELECTED_THREAD_KEY, id);
  };

  return { threadId, selectThread };
}
