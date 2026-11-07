import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { List, ListItem } from 'konsta/react';
import {
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Plus,
  QrCode,
  X,
} from 'lucide-react';
import {
  api,
  parsePairingQr,
  threadStatusKind,
  type ApprovalItem,
  type ConnectionSettings,
  type HealthResponse,
  type Thread,
} from '../lib/turnloomApi';
import { PRESS, StatusPill, relativeTime, truncate } from '../lib/ui';

export type SheetKind = 'approval' | 'threads' | 'newTask' | 'scanQr' | 'accessCode' | null;

export interface CupertinoSheetsProps {
  sheet: SheetKind;
  onSheetChange: (sheet: SheetKind) => void;
  approvals: ApprovalItem[];
  threads: Thread[];
  selectedThreadId: string;
  onSelectThread: (id: string) => void;
  onApprovalSubmit: (decision: 'accept' | 'decline', item: ApprovalItem) => Promise<void>;
  onNewTask: (message: string) => Promise<void>;
  onPairing: (settings: ConnectionSettings) => Promise<void>;
  onAccessCode: (token: string) => Promise<void>;
  health: HealthResponse | null;
  readOnly: boolean;
}

const SHEET_TITLES: Record<Exclude<SheetKind, null>, string> = {
  approval: 'Approve changes',
  threads: 'Switch conversation',
  newTask: 'New task',
  scanQr: 'Scan QR to Pair',
  accessCode: 'Enter access code',
};

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-xl border border-[#FF3B30]/20 bg-[#FF3B30]/5 px-3 py-2.5 text-[12px] leading-relaxed text-[#D70015]">
      {message}
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <div className="mt-3 rounded-xl bg-[#FF3B30]/5 px-3 py-2.5 text-[12px] text-[#D70015]">
      Read-only mode — sending and approvals are disabled.
    </div>
  );
}

/**
 * All secondary interactions live in ONE Vaul bottom sheet with
 * shouldScaleBackground (iOS card depth). No centered modal, no hamburger,
 * no top text navigation, no footer.
 */
export default function CupertinoSheets(props: CupertinoSheetsProps) {
  const { sheet, onSheetChange, approvals, threads, selectedThreadId, readOnly } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [taskText, setTaskText] = useState('');
  const [qrText, setQrText] = useState('');
  const [token, setToken] = useState('');
  const [approvalIndex, setApprovalIndex] = useState(0);

  // Reset transient state whenever a different sheet is opened.
  useEffect(() => {
    setSubmitting(false);
    setError('');
    setSuccess('');
    setApprovalIndex(0);
  }, [sheet]);

  // Delayed close after a successful approval; clean up on unmount/change.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => onSheetChange(null), 700);
    return () => clearTimeout(timer);
  }, [success, onSheetChange]);

  const open = sheet !== null;
  const title = sheet ? SHEET_TITLES[sheet] : '';
  const item = approvals[Math.min(approvalIndex, Math.max(0, approvals.length - 1))] || null;

  const run = async (fn: () => Promise<void>, onDone?: () => void) => {
    setSubmitting(true);
    setError('');
    try {
      await fn();
      setSuccess('Done');
      onDone?.();
    } catch (err) {
      // Never close on failure — surface the error inside the sheet.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer.Root
      shouldScaleBackground
      open={open}
      onOpenChange={(next) => {
        if (!next) onSheetChange(null);
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-h-[85dvh] max-w-[430px] flex-col rounded-t-3xl border-t border-[#E5E5EA] bg-white/95 shadow-2xl outline-none backdrop-blur-2xl">
          {/* iOS drag handle */}
          <div className="mx-auto mt-2.5 h-1.5 w-9 shrink-0 rounded-full bg-[#C7C7CC]" />

          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
            <div className="min-w-0">
              <Drawer.Title className="truncate text-[17px] font-semibold text-[#1C1C1E]">
                {title}
              </Drawer.Title>
              <Drawer.Description className="sr-only">
                {title} — bottom sheet
              </Drawer.Description>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => onSheetChange(null)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFEFF4] text-[#8E8E93] ${PRESS}`}
            >
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))]">
            {/* ---------------------------------------------------------- */}
            {/* 1. Approval                                                */}
            {/* ---------------------------------------------------------- */}
            {sheet === 'approval' && (
              <>
                {!item ? (
                  <div className="rounded-2xl bg-[#EFEFF4] px-4 py-8 text-center">
                    <CheckCircle2 size={30} className="mx-auto text-[#34C759]" />
                    <p className="mt-3 text-[15px] font-semibold text-[#1C1C1E]">
                      No pending approvals
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">
                      Approvals appear here when the desktop agent requests a command or file
                      change.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-[#E5E5EA]/60 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-semibold text-[#1C1C1E]">
                          {item.title || 'Approval requested'}
                        </p>
                        <StatusPill label={item.approvalKind || 'command'} tone="blue" />
                      </div>
                      <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[#EFEFF4] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#1C1C1E]">
                        {truncate(item.content, 400)}
                      </p>
                      <p className="mt-2 truncate text-[10px] text-[#8E8E93]">
                        requestId: {item.requestId}
                      </p>
                      {approvals.length > 1 && (
                        <p className="mt-1 text-[11px] text-[#8E8E93]">
                          {approvalIndex + 1} of {approvals.length}
                        </p>
                      )}
                    </div>

                    {readOnly && <ReadOnlyNote />}

                    <button
                      type="button"
                      disabled={submitting || readOnly || Boolean(success)}
                      onClick={() =>
                        void run(() => props.onApprovalSubmit('accept', item))
                      }
                      className={`mt-4 w-full rounded-2xl bg-[#34C759] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50 ${PRESS}`}
                    >
                      {submitting ? 'Submitting…' : 'Approve & Apply'}
                    </button>
                    <button
                      type="button"
                      disabled={submitting || readOnly || Boolean(success)}
                      onClick={() =>
                        void run(() => props.onApprovalSubmit('decline', item))
                      }
                      className={`mt-2 w-full rounded-2xl bg-[#EFEFF4] px-4 py-3.5 text-[15px] font-semibold text-[#1C1C1E] disabled:opacity-50 ${PRESS}`}
                    >
                      Reject
                    </button>

                    {approvals.length > 1 && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setApprovalIndex((i) => (i + 1) % approvals.length)}
                        className={`mt-2 w-full rounded-2xl bg-white px-4 py-2.5 text-[13px] text-[#007AFF] ${PRESS}`}
                      >
                        Next approval
                      </button>
                    )}

                    {success && !error && (
                      <p className="mt-3 text-center text-[13px] font-medium text-[#248A3D]">
                        Approval submitted
                      </p>
                    )}
                  </>
                )}
                {error && <ErrorBox message={error} />}
              </>
            )}

            {/* ---------------------------------------------------------- */}
            {/* 2. Switch Thread                                           */}
            {/* ---------------------------------------------------------- */}
            {sheet === 'threads' && (
              <>
                {threads.length === 0 ? (
                  <div className="rounded-2xl bg-[#EFEFF4] px-4 py-8 text-center text-[13px] text-[#8E8E93]">
                    No conversations yet. Scan a QR code or start a new task.
                  </div>
                ) : (
                  <List strongIos insetIos>
                    {threads.map((thread) => {
                      const kind = threadStatusKind(thread.status);
                      const tone =
                        kind === 'waiting' ? 'green' : kind === 'running' || kind === 'stale' ? 'blue' : 'gray';
                      const label =
                        kind === 'waiting'
                          ? 'Merge Request'
                          : kind === 'running' || kind === 'stale'
                            ? 'Active'
                            : 'Completed';
                      return (
                        <ListItem
                          key={thread.id}
                          component="button"
                          onClick={() => props.onSelectThread(thread.id)}
                          className={`${PRESS} ${thread.id === selectedThreadId ? 'bg-[#007AFF]/5' : ''}`}
                          title={thread.title || 'Untitled thread'}
                          text={truncate(thread.preview || '', 60)}
                          after={
                            <span className="flex items-center gap-2">
                              <span className="text-[11px] text-[#8E8E93]">
                                {relativeTime(thread.updatedAtMs)}
                              </span>
                              <StatusPill label={label} tone={tone} />
                            </span>
                          }
                        />
                      );
                    })}
                  </List>
                )}
                <button
                  type="button"
                  onClick={() => onSheetChange('newTask')}
                  className={`mt-4 flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3.5 text-[14px] font-medium text-[#007AFF] ${PRESS}`}
                >
                  <span className="flex items-center gap-2">
                    <Plus size={16} /> New Task
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onSheetChange('scanQr')}
                  className={`mt-2 flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3.5 text-[14px] font-medium text-[#1C1C1E] ${PRESS}`}
                >
                  <span className="flex items-center gap-2">
                    <QrCode size={16} /> Scan QR to Pair
                  </span>
                  <ChevronRight size={16} />
                </button>
              </>
            )}

            {/* ---------------------------------------------------------- */}
            {/* 3. New Task                                                */}
            {/* ---------------------------------------------------------- */}
            {sheet === 'newTask' && (
              <>
                <textarea
                  value={taskText}
                  onChange={(event) => setTaskText(event.target.value)}
                  rows={4}
                  placeholder="What should the agent work on?"
                  className="w-full resize-none rounded-2xl bg-[#EFEFF4] px-4 py-3 text-[15px] leading-relaxed text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-[#8E8E93]">
                  A new conversation is created on the desktop. In desktop mode this starts a
                  local draft.
                </p>
                {readOnly && <ReadOnlyNote />}
                <button
                  type="button"
                  disabled={submitting || readOnly || !taskText.trim()}
                  onClick={() =>
                    void run(() => props.onNewTask(taskText.trim()), () => {
                      setTaskText('');
                      onSheetChange(null);
                    })
                  }
                  className={`mt-4 w-full rounded-2xl bg-[#007AFF] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50 ${PRESS}`}
                >
                  {submitting ? 'Starting…' : 'Start Task'}
                </button>
                {error && <ErrorBox message={error} />}
              </>
            )}

            {/* ---------------------------------------------------------- */}
            {/* 4. Scan QR to Pair                                         */}
            {/* ---------------------------------------------------------- */}
            {sheet === 'scanQr' && (
              <>
                <div className="rounded-2xl bg-[#EFEFF4] px-4 py-3">
                  <p className="text-[12px] font-medium text-[#1C1C1E]">Pairing code format</p>
                  <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-[#8E8E93]">
                    codexpocket://add?name=…&amp;url=…&amp;token=…
                  </p>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-[#8E8E93]">
                  Browser camera scanning is unavailable here. Paste the scanned code below.
                </p>
                <textarea
                  value={qrText}
                  onChange={(event) => setQrText(event.target.value)}
                  rows={3}
                  placeholder="Paste codexpocket://add?... or a URL with ?token="
                  className="mt-2 w-full resize-none rounded-2xl bg-[#EFEFF4] px-4 py-3 font-mono text-[12px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                />
                <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-[12px] text-[#8E8E93]">
                  <div className="flex justify-between gap-2">
                    <span>Current backend</span>
                    <span className="font-medium text-[#1C1C1E]">
                      {props.health?.backend?.kind ? String(props.health.backend.kind) : '—'}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between gap-2">
                    <span>Paired device</span>
                    <span className="font-medium text-[#1C1C1E]">
                      {api.getConnection().name || '—'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={submitting || !qrText.trim()}
                  onClick={() => {
                    const parsed = parsePairingQr(qrText);
                    if (!parsed) {
                      setError('Invalid pairing code. Expected codexpocket://add?name=&url=&token=');
                      return;
                    }
                    void run(() => props.onPairing(parsed), () => {
                      setQrText('');
                      onSheetChange(null);
                    });
                  }}
                  className={`mt-4 w-full rounded-2xl bg-[#007AFF] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50 ${PRESS}`}
                >
                  {submitting ? 'Connecting…' : 'Connect'}
                </button>
                <button
                  type="button"
                  onClick={() => onSheetChange('accessCode')}
                  className={`mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-[13px] font-medium text-[#1C1C1E] ${PRESS}`}
                >
                  <KeyRound size={15} /> Enter access code manually
                </button>
                {error && <ErrorBox message={error} />}
              </>
            )}

            {/* ---------------------------------------------------------- */}
            {/* 5. Access code                                             */}
            {/* ---------------------------------------------------------- */}
            {sheet === 'accessCode' && (
              <>
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Access code"
                  autoComplete="off"
                  className="w-full rounded-2xl bg-[#EFEFF4] px-4 py-3 text-[15px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-[#8E8E93]">
                  The code is sent as the <code className="font-mono">x-access-token</code> header
                  on every request, and exchanged for a session cookie via /api/auth/session.
                </p>
                <button
                  type="button"
                  disabled={submitting || !token.trim()}
                  onClick={() =>
                    void run(() => props.onAccessCode(token.trim()), () => {
                      setToken('');
                      onSheetChange(null);
                    })
                  }
                  className={`mt-4 w-full rounded-2xl bg-[#007AFF] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50 ${PRESS}`}
                >
                  {submitting ? 'Connecting…' : 'Connect'}
                </button>
                {error && <ErrorBox message={error} />}
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
