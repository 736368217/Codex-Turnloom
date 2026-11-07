import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  api,
  ApiError,
  approvalItems,
  loadConnection,
  loadSelectedThreadId,
  saveSelectedThreadId,
  startChangePoller,
  threadStatusKind,
  conversationCacheKey,
  readConversationCache,
  writeConversationCache,
  isConversationCacheFresh,
  type ApprovalItem,
  type ConnectionSettings,
  type HealthResponse,
  type MessagesResponse,
  type MessagesStatus,
  type StreamMessage,
  type Thread,
} from './lib/turnloomApi';
import { HIT_AREA_44, PRESS, cx, truncate } from './lib/ui';
import MachineHubHeader from './components/MachineHubHeader';
import TaskStreamView from './components/TaskStreamView';
import ThumbGlassBar from './components/ThumbGlassBar';
import GlassTabBar, { type TabKey } from './components/GlassTabBar';
import CupertinoSheets, { type SheetKind } from './components/CupertinoSheets';
import {
  loadTerminals,
  readActiveTerminalId,
  saveTerminals,
  writeActiveTerminalId,
  SessionsPage,
  SettingsPage,
  TerminalPage,
  TerminalPicker,
  type TerminalEntry,
  type TerminalPatch,
} from './components/ManagementPages';

type Engine = 'codex' | 'pi';

const EMPTY_STATUS: MessagesStatus = { thinking: false, interactionRequired: false };

const STATUS_LABELS: Record<string, string> = {
  waiting: '待处理',
  running: '运行中',
  stale: '运行中',
  ended: '已完成',
  unknown: '空闲',
};
const statusText = (status: MessagesStatus | null): string =>
  STATUS_LABELS[threadStatusKind(status)] || '空闲';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>(() => loadSelectedThreadId());
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [status, setStatus] = useState<MessagesStatus | null>(null);
  const [diff, setDiff] = useState<unknown>(undefined);
  const [engine, setEngine] = useState<Engine>('codex');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [tab, setTab] = useState<TabKey>('chat');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [activeApproval, setActiveApproval] = useState<ApprovalItem | null>(null);
  const [terminals, setTerminals] = useState<TerminalEntry[]>(() => loadTerminals());
  const [activeTerminalId, setActiveTerminalId] = useState<string>(() => readActiveTerminalId() || '');
  const [pickerVisible, setPickerVisible] = useState<boolean>(() => !readActiveTerminalId());
  const pollerRef = useRef<(() => void) | null>(null);
  const threadIdRef = useRef(selectedThreadId);
  threadIdRef.current = selectedThreadId;

  const readOnly = health?.allowWrite === false;
  const busy = Boolean(status?.thinking);
  const activeTerminal = terminals.find((item) => item.id === activeTerminalId) || terminals[0];
  const terminalName = activeTerminal?.name || loadConnection().name || '本机电脑';

  const showError = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : String(error));
  }, []);

  // --- Bootstrap: health → threads → cached conversation -------------------
  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getHealth();
      setHealth(result);
      const list = await api.getThreadsWithEtag({ limit: 60, selectedId: loadSelectedThreadId() });
      const nextThreads = list.threads || [];
      setThreads(nextThreads);
      // 冷启动选完终端后直接落到最近一条会话，无需用户再找一次。
      if (!loadSelectedThreadId() && nextThreads[0]?.id) {
        setSelectedThreadId(nextThreads[0].id);
        saveSelectedThreadId(nextThreads[0].id);
      }
      setNotice('');
    } catch (error) {
      showError(error);
      if (error instanceof ApiError && error.isAuth) setSheet('accessCode');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (pickerVisible) return; // 冷启动先选终端，避免未鉴权请求弹出访问码抽屉
    void bootstrap();
  }, [bootstrap, connectionVersion, pickerVisible]);

  // --- Refresh threads (also used after writes) ----------------------------
  const refreshThreads = useCallback(async () => {
    try {
      const list = await api.getThreadsWithEtag({ limit: 60, selectedId: threadIdRef.current });
      setThreads(list.threads || []);
    } catch (error) {
      if (error instanceof ApiError && error.isAuth) {
        setSheet('accessCode');
        return;
      }
      showError(error);
    }
  }, [showError]);

  // --- Load messages for the selected thread (cache-first) ----------------
  const loadMessages = useCallback(
    async (threadId: string, useCache = true) => {
      if (!threadId) {
        setMessages([]);
        setStatus(null);
        setDiff(undefined);
        return;
      }
      const key = conversationCacheKey(threadId);
      if (useCache) {
        const cached = await readConversationCache(key);
        const thread = threads.find((t) => t.id === threadId);
        if (cached && isConversationCacheFresh(cached, thread)) {
          setMessages(cached.data.messages || []);
          setStatus(cached.data.status || EMPTY_STATUS);
        }
      }
      try {
        const result: MessagesResponse = await api.getMessages(threadId, { limit: 80 });
        if (threadIdRef.current !== threadId) return;
        setMessages(result.messages || []);
        setStatus(result.status || EMPTY_STATUS);
        void writeConversationCache(key, {
          threadId,
          thread: threads.find((t) => t.id === threadId),
          data: result,
        });
        setNotice('');
      } catch (error) {
        if (error instanceof ApiError && error.isAuth) {
          setSheet('accessCode');
          return;
        }
        showError(error);
      }
    },
    [threads, showError],
  );

  useEffect(() => {
    if (!selectedThreadId) return;
    void loadMessages(selectedThreadId);
  }, [selectedThreadId, loadMessages]);

  // --- Real-time refresh via /api/threads/:id/changes long poll -----------
  useEffect(() => {
    pollerRef.current?.();
    pollerRef.current = null;
    if (!selectedThreadId || !health) return;
    pollerRef.current = startChangePoller({
      threadId: selectedThreadId,
      onChanged: async () => {
        await loadMessages(selectedThreadId, false);
        await refreshThreads();
      },
      onUnauthorized: () => setSheet('accessCode'),
      onError: () => {
        /* 瞬时网络错误由轮询器自身退避处理 */
      },
    });
    return () => {
      pollerRef.current?.();
      pollerRef.current = null;
    };
  }, [selectedThreadId, health, loadMessages, refreshThreads]);

  // --- Optional diff payload (best effort, real endpoint) -----------------
  useEffect(() => {
    if (!selectedThreadId || !health) {
      setDiff(undefined);
      return;
    }
    let cancelled = false;
    void api
      .getHostDiff(selectedThreadId)
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch(() => {
        // /api/host/diff 依赖桌面桥接，缺失不算错误。
        if (!cancelled) setDiff(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedThreadId, health]);

  const approvals = useMemo(() => approvalItems(messages), [messages]);

  const selectThread = useCallback((id: string) => {
    setSelectedThreadId(id);
    saveSelectedThreadId(id);
    setSheet(null);
    setNotice('');
    setTab('chat');
  }, []);

  // --- Write actions (all guarded by allowWrite in the API layer) ----------
  const handleSend = useCallback(
    async (message: string) => {
      try {
        const result = await api.sendMessage({
          message,
          threadId: selectedThreadId || undefined,
          newThread: !selectedThreadId,
        });
        const nextId = result.threadId || selectedThreadId;
        if (nextId && nextId !== selectedThreadId) {
          setSelectedThreadId(nextId);
          saveSelectedThreadId(nextId);
        }
        setNotice('');
        await refreshThreads();
        if (nextId) await loadMessages(nextId, false);
      } catch (error) {
        if (error instanceof ApiError && error.isAuth) setSheet('accessCode');
        showError(error);
        throw error;
      }
    },
    [selectedThreadId, refreshThreads, loadMessages, showError],
  );

  const handleInterrupt = useCallback(async () => {
    if (!selectedThreadId) {
      setNotice('请先选择一个会话再中断。');
      return;
    }
    try {
      await api.interrupt(selectedThreadId);
      setNotice('');
      await loadMessages(selectedThreadId, false);
      await refreshThreads();
    } catch (error) {
      if (error instanceof ApiError && error.isAuth) setSheet('accessCode');
      showError(error);
    }
  }, [selectedThreadId, loadMessages, refreshThreads, showError]);

  const handleQuickCommand = useCallback((command: string) => {
    setDraft(command);
    setNotice('');
  }, []);

  const handleApprovalSubmit = useCallback(
    async (decision: 'accept' | 'decline', item: ApprovalItem) => {
      await api.respondToApproval({
        threadId: selectedThreadId,
        requestId: item.requestId,
        approvalKind: item.approvalKind,
        decision,
      });
      setActiveApproval(null);
      await loadMessages(selectedThreadId, false);
      await refreshThreads();
    },
    [selectedThreadId, loadMessages, refreshThreads],
  );

  const handleNewTask = useCallback(
    async (message: string) => {
      await api.sendMessage({ message, newThread: true, threadId: null });
      await refreshThreads();
    },
    [refreshThreads],
  );

  const applyConnection = useCallback(async (settings: ConnectionSettings, name?: string) => {
    api.setConnection({ ...settings, name: name ?? settings.name });
    // 无访问码时只更新同源连接，不发起必然 401 的会话请求。
    if (settings.token) await api.createAuthSession(settings.token);
    setConnectionVersion((v) => v + 1);
  }, []);

  const handlePairing = useCallback(
    async (settings: ConnectionSettings) => {
      const entry: TerminalEntry = {
        id: `t-${Date.now()}`,
        name: settings.name || '新终端',
        url: settings.url,
        token: settings.token,
      };
      const next = [...terminals, entry];
      setTerminals(next);
      saveTerminals(next);
      setActiveTerminalId(entry.id);
      writeActiveTerminalId(entry.id);
      setPickerVisible(false);
      await applyConnection(settings, entry.name);
    },
    [terminals, applyConnection],
  );

  const handleAccessCode = useCallback(async (token: string) => {
    await api.createAuthSession(token);
    const previous = api.getConnection();
    api.setConnection({
      url: previous.url,
      token,
      name: previous.name || loadConnection().name,
    });
    const next = terminals.map((item) =>
      item.id === activeTerminalId ? { ...item, token } : item,
    );
    setTerminals(next);
    saveTerminals(next);
    setConnectionVersion((v) => v + 1);
  }, [terminals, activeTerminalId]);

  // --- Terminal management -------------------------------------------------
  const chooseTerminal = useCallback(
    async (entry: TerminalEntry) => {
      setActiveTerminalId(entry.id);
      writeActiveTerminalId(entry.id);
      setPickerVisible(false);
      await applyConnection({ url: entry.url, token: entry.token, name: entry.name }, entry.name);
    },
    [applyConnection],
  );

  const editTerminal = useCallback(
    (id: string, patch: TerminalPatch) => {
      const next = terminals.map((item) => (item.id === id ? { ...item, ...patch } : item));
      setTerminals(next);
      saveTerminals(next);
      const changed = next.find((item) => item.id === id);
      if (changed && changed.id === activeTerminalId) {
        void applyConnection(
          { url: changed.url, token: changed.token, name: changed.name },
          changed.name,
        );
      }
    },
    [terminals, activeTerminalId, applyConnection],
  );

  const removeTerminal = useCallback(
    (id: string) => {
      if (terminals.length <= 1) return;
      const next = terminals.filter((item) => item.id !== id);
      setTerminals(next);
      saveTerminals(next);
      if (id === activeTerminalId) {
        const fallback = next[0];
        setActiveTerminalId(fallback.id);
        writeActiveTerminalId(fallback.id);
        void applyConnection(
          { url: fallback.url, token: fallback.token, name: fallback.name },
          fallback.name,
        );
      }
    },
    [terminals, activeTerminalId, applyConnection],
  );

  const selectedTitle = useMemo(() => {
    const thread = threads.find((t) => t.id === selectedThreadId);
    return thread?.title ? truncate(thread.title, 20) : '项目总览';
  }, [threads, selectedThreadId]);

  const composer = (
    <ThumbGlassBar
      value={draft}
      onValueChange={setDraft}
      onSend={handleSend}
      onInterrupt={handleInterrupt}
      onQuickCommand={handleQuickCommand}
      onVoice={() => setNotice('浏览器版本暂不支持语音输入。')}
      busy={busy}
      readOnly={readOnly}
      disabled={loading}
    />
  );

  return (
    <div
      vaul-drawer-wrapper=""
      className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#F2F2F7] text-[#1C1C1E] shadow-2xl select-none"
    >
      {pickerVisible ? (
        <>
          <TerminalPicker
            terminals={terminals}
            onPick={(entry) => void chooseTerminal(entry)}
            onScanAdd={() => setSheet('scanQr')}
          />
          <GlassTabBar active="terminal" onChange={() => undefined} />
          <CupertinoSheets
            sheet={sheet}
            onSheetChange={setSheet}
            approvals={approvals}
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelectThread={selectThread}
            onApprovalSubmit={handleApprovalSubmit}
            onNewTask={handleNewTask}
            onPairing={handlePairing}
            onAccessCode={handleAccessCode}
            health={health}
            readOnly={Boolean(readOnly)}
          />
        </>
      ) : (
        <>
          <header className="z-20 shrink-0">
            <MachineHubHeader
              health={health}
              machineName={terminalName}
              onManage={() => setTab('terminal')}
            />
          </header>

          {/* 主内容区：flex-1 min-h-0，聊天区在首屏占主导 */}
          <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
            {tab === 'chat' && (
              <>
                {loading && (
                  <div className="mb-3 rounded-2xl bg-white px-4 py-3 text-center text-[13px] text-[#8E8E93]">
                    正在连接电脑…
                  </div>
                )}

                {selectedThreadId && (
                  <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[#1C1C1E]">{selectedTitle}</p>
                      <p className="text-[11px] text-[#8E8E93]">
                        {statusText(status)} · {messages.length} 条消息
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="刷新"
                      onClick={() => void loadMessages(selectedThreadId, false)}
                      className={cx(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFEFF4] text-[#8E8E93]',
                        HIT_AREA_44,
                        PRESS,
                      )}
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                )}

                <TaskStreamView
                  messages={messages}
                  status={status}
                  diff={diff}
                  busy={busy}
                  onStartTask={() => setSheet('newTask')}
                  onApprove={(item) => {
                    setActiveApproval(item);
                    setSheet('approval');
                  }}
                />

                {approvals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSheet('approval')}
                    className={cx(
                      'mt-3 min-h-[44px] w-full rounded-2xl border border-[#34C759]/30 bg-[#34C759]/10 px-4 py-3 text-[14px] font-semibold text-[#248A3D]',
                      PRESS,
                    )}
                  >
                    {approvals.length} 条待审批 · 查看
                  </button>
                )}

                {notice && (
                  <div className="mt-3 rounded-2xl border border-[#FF3B30]/20 bg-[#FF3B30]/5 px-4 py-3 text-[12px] leading-relaxed text-[#D70015]">
                    {notice}
                  </div>
                )}
              </>
            )}

            {tab === 'sessions' && (
              <SessionsPage
                threads={threads}
                selectedThreadId={selectedThreadId}
                onSelectThread={selectThread}
                onNewTask={() => setSheet('newTask')}
              />
            )}

            {tab === 'terminal' && (
              <TerminalPage
                terminals={terminals}
                activeId={activeTerminalId || terminals[0]?.id || ''}
                health={health}
                engine={engine}
                onEngineChange={setEngine}
                onSelect={(entry) => void chooseTerminal(entry)}
                onAdd={() => setSheet('scanQr')}
                onEdit={editTerminal}
                onRemove={removeTerminal}
                onReconnect={() => setConnectionVersion((v) => v + 1)}
              />
            )}

            {tab === 'settings' && (
              <SettingsPage
                health={health}
                readOnly={Boolean(readOnly)}
                terminalName={terminalName}
                onAccessCode={() => setSheet('accessCode')}
              />
            )}
          </main>

          <GlassTabBar active={tab} onChange={setTab} composer={tab === 'chat' ? composer : undefined} />

          <CupertinoSheets
            sheet={sheet}
            onSheetChange={setSheet}
            approvals={activeApproval ? [activeApproval] : approvals}
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelectThread={selectThread}
            onApprovalSubmit={handleApprovalSubmit}
            onNewTask={handleNewTask}
            onPairing={handlePairing}
            onAccessCode={handleAccessCode}
            health={health}
            readOnly={Boolean(readOnly)}
          />
        </>
      )}
    </div>
  );
}
