/**
 * 信息架构 v4 的轻量共享状态：当前选中的终端、当前会话、引擎偏好。
 * 数据来自真实配对配置 / 用户选择，不伪造服务端数据。
 */
import { useEffect, useState } from 'react';

import { localGet, localSet } from './localStore';
import { getTurnloomClient } from './turnloomClient';

export type Engine = 'codex' | 'pi';

export const ACTIVE_TERMINAL_KEY = 'activeTerminalId';
export const ENGINE_KEY = 'engine';
export const SELECTED_THREAD_KEY = 'selectedThreadId';

/** 连接信息由用户扫码 / 手动输入并加密保存；仓库内不预置任何终端。 */
const BUILTIN_TERMINALS: readonly TerminalOption[] = [];

export type TerminalOption = {
  id: string;
  name: string;
  url: string;
  token: string;
};

export async function readActiveTerminal(): Promise<TerminalOption | null> {
  const [savedId, config] = await Promise.all([localGet(ACTIVE_TERMINAL_KEY), getTurnloomClient().load()]);
  // 真实配对配置优先：用户在「终端」页改过地址后，内置常量不能再盖回去。
  if (config?.serverUrl) {
    const builtin = BUILTIN_TERMINALS.find((item) => config.serverUrl.startsWith(item.url));
    return {
      id: savedId || builtin?.id || 'paired-device',
      name: config.machineName || builtin?.name || new URL(config.serverUrl).host,
      url: config.serverUrl,
      token: config.token || builtin?.token || '',
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
