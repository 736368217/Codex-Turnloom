import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings2, RefreshCw } from 'lucide-react';
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
import { PRESS, cx, truncate } from './lib/ui';
import MachineHubHeader from './components/MachineHubHeader';
import TaskStreamView from './components/TaskStreamView';
import ThumbGlassBar from './components/ThumbGlassBar';
import CupertinoSheets, { type SheetKind } from './components/CupertinoSheets';

type Engine = 'codex' | 'pi';

const EMPTY_STATUS: MessagesStatus = { thinking: false, interactionRequired: false };

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
  const [draft, setDraft] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [activeApproval, setActiveApproval] = useState<ApprovalItem | null>(null);
  const pollerRef = useRef<(() => void) | null>(null);
  const threadIdRef = useRef(selectedThreadId);
  threadIdRef.current = selectedThreadId;

  const readOnly = health?.allowWrite === false;
  const busy = Boolean(status?.thinking);

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
      setThreads(list.threads || []);
      setNotice('');
    } catch (error) {
      showError(error);
      if (error instanceof ApiError && error.isAuth) setSheet('accessCode');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap, connectionVersion]);

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
        /* transient network error: the poller backs off by itself */
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
        // /api/host/diff depends on the desktop bridge; absence is not an error.
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
      setNotice('Select a conversation before interrupting.');
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

  const handleQuickCommand = useCallback(
    (command: string) => {
      setDraft(command);
      setNotice('');
    },
    [],
  );

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

  const handlePairing = useCallback(async (settings: ConnectionSettings) => {
    api.setConnection(settings);
    await api.createAuthSession(settings.token);
    setConnectionVersion((v) => v + 1);
  }, []);

  const handleAccessCode = useCallback(async (token: string) => {
    await api.createAuthSession(token);
    const previous = api.getConnection();
    api.setConnection({
      url: previous.url,
      token,
      name: previous.name || loadConnection().name,
    });
    setConnectionVersion((v) => v + 1);
  }, []);

  const selectedTitle = useMemo(() => {
    const thread = threads.find((t) => t.id === selectedThreadId);
    return thread?.title ? truncate(thread.title, 28) : 'Project Overview';
  }, [threads, selectedThreadId]);

  return (
    <div
      vaul-drawer-wrapper=""
      className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#F2F2F7] text-[#1C1C1E] shadow-2xl select-none"
    >
      {/* Fixed top: large title → compact frosted bar on scroll */}
      <header className="z-20 shrink-0">
        <MachineHubHeader
          health={health}
          machineName={loadConnection().name || 'DESKTOP-PC'}
          threads={threads}
          selectedThreadId={selectedThreadId}
          engine={engine}
          onEngineChange={setEngine}
          onScanQr={() => setSheet('scanQr')}
          onSelectThread={selectThread}
          onOpenThreads={() => setSheet('threads')}
          onNewTask={() => setSheet('newTask')}
          scrolled={scrolled}
        />
      </header>

      {/* Scrollable task stream */}
      <main
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 24)}
      >
        {loading && (
          <div className="mb-3 rounded-2xl bg-white px-4 py-3 text-center text-[13px] text-[#8E8E93]">
            Connecting to the desktop…
          </div>
        )}

        {selectedThreadId && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[#1C1C1E]">{selectedTitle}</p>
              <p className="text-[11px] text-[#8E8E93]">
                {threadStatusKind(status)} · {messages.length} messages
              </p>
            </div>
            <button
              type="button"
              aria-label="Refresh"
              onClick={() => void loadMessages(selectedThreadId, false)}
              className={cx(
                'flex h-8 w-8 items-center justify-center rounded-full bg-[#EFEFF4] text-[#8E8E93]',
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
              'mt-3 w-full rounded-2xl border border-[#34C759]/30 bg-[#34C759]/10 px-4 py-3 text-[14px] font-semibold text-[#248A3D]',
              PRESS,
            )}
          >
            {approvals.length} pending approval{approvals.length > 1 ? 's' : ''} · Review
          </button>
        )}

        {notice && (
          <div className="mt-3 rounded-2xl border border-[#FF3B30]/20 bg-[#FF3B30]/5 px-4 py-3 text-[12px] leading-relaxed text-[#D70015]">
            {notice}
          </div>
        )}

        <button
          type="button"
          onClick={() => setSheet('threads')}
          className={cx(
            'mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-[13px] font-medium text-[#8E8E93]',
            PRESS,
          )}
        >
          <Settings2 size={15} />
          Switch conversation / pair device
        </button>
      </main>

      <ThumbGlassBar
        value={draft}
        onValueChange={setDraft}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onQuickCommand={handleQuickCommand}
        onVoice={() => setNotice('Voice input is not available in the browser build yet.')}
        busy={busy}
        readOnly={readOnly}
        disabled={loading}
      />

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
    </div>
  );
}
