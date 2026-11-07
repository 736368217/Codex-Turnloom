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
import { HIT_AREA_44, PRESS, StatusPill, relativeTime, truncate } from '../lib/ui';

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
  approval: '审批改动',
  threads: '切换会话',
  newTask: '新建任务',
  scanQr: '扫码配对',
  accessCode: '输入访问码',
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
      只读模式：发送与审批已停用。
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
      setSuccess('已完成');
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
        <Drawer.Content className="ios-sheet-glass fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-h-[85dvh] max-w-[430px] flex-col rounded-t-[28px] border-t border-white/90 shadow-[0_-8px_40px_rgba(16,30,60,0.16)] outline-none">
          {/* iOS drag handle */}
          <div className="mx-auto mt-2.5 h-1.5 w-9 shrink-0 rounded-full bg-[#C7C7CC]" />

          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
            <div className="min-w-0">
              <Drawer.Title className="truncate text-[17px] font-semibold text-[#1C1C1E]">
                {title}
              </Drawer.Title>
              <Drawer.Description className="sr-only">
                {title} — 底部抽屉
              </Drawer.Description>
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => onSheetChange(null)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFEFF4] text-[#8E8E93] ${HIT_AREA_44} ${PRESS}`}
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
                      暂无待审批
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">
                      当电脑端代理请求执行命令或改动文件时，审批会显示在这里。
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-[#E5E5EA]/60 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-semibold text-[#1C1C1E]">
                          {item.title || '待审批'}
                        </p>
                        <StatusPill label={item.approvalKind === 'command' ? '命令' : '文件改动'} tone="blue" />
                      </div>
                      <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[#EFEFF4] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#1C1C1E]">
                        {truncate(item.content, 400)}
                      </p>
                      <p className="mt-2 truncate text-[10px] text-[#8E8E93]">
                        请求编号：{item.requestId}
                      </p>
                      {approvals.length > 1 && (
                        <p className="mt-1 text-[11px] text-[#8E8E93]">
                          第 {approvalIndex + 1} / {approvals.length} 条
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
                      {submitting ? '提交中…' : '批准并应用'}
                    </button>
                    <button
                      type="button"
                      disabled={submitting || readOnly || Boolean(success)}
                      onClick={() =>
                        void run(() => props.onApprovalSubmit('decline', item))
                      }
                      className={`mt-2 w-full rounded-2xl bg-[#EFEFF4] px-4 py-3.5 text-[15px] font-semibold text-[#1C1C1E] disabled:opacity-50 ${PRESS}`}
                    >
                      拒绝
                    </button>

                    {approvals.length > 1 && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setApprovalIndex((i) => (i + 1) % approvals.length)}
                        className={`mt-2 w-full rounded-2xl bg-white px-4 py-2.5 text-[13px] text-[#007AFF] ${PRESS}`}
                      >
                      下一条审批
                      </button>
                    )}

                    {success && !error && (
                      <p className="mt-3 text-center text-[13px] font-medium text-[#248A3D]">
                        审批已提交
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
                    暂无会话，扫码配对或新建任务
                  </div>
                ) : (
                  <List strongIos insetIos>
                    {threads.map((thread) => {
                      const kind = threadStatusKind(thread.status);
                      const tone =
                        kind === 'waiting' ? 'green' : kind === 'running' || kind === 'stale' ? 'blue' : 'gray';
                      const label =
                        kind === 'waiting'
                          ? '待合并'
                          : kind === 'running' || kind === 'stale'
                            ? '进行中'
                            : '已完成';
                      return (
                        <ListItem
                          key={thread.id}
                          component="button"
                          onClick={() => props.onSelectThread(thread.id)}
                          className={`min-h-[44px] ${PRESS} ${thread.id === selectedThreadId ? 'bg-[#007AFF]/5' : ''}`}
                          title={thread.title || '未命名会话'}
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
                  className={`mt-4 flex min-h-[44px] w-full items-center justify-between rounded-2xl bg-white px-4 py-3.5 text-[14px] font-medium text-[#007AFF] ${PRESS}`}
                >
                  <span className="flex items-center gap-2">
                    <Plus size={16} /> 新建任务
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onSheetChange('scanQr')}
                  className={`mt-2 flex min-h-[44px] w-full items-center justify-between rounded-2xl bg-white px-4 py-3.5 text-[14px] font-medium text-[#1C1C1E] ${PRESS}`}
                >
                  <span className="flex items-center gap-2">
                    <QrCode size={16} /> 扫码配对
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
                  placeholder="输入任务内容…"
                  className="w-full resize-none rounded-2xl bg-[#EFEFF4] px-4 py-3 text-[15px] leading-relaxed text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-[#8E8E93]">
                  将在电脑端创建新会话；桌面模式下会先生成一份本地草稿。
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
                  className={`mt-4 min-h-[44px] w-full rounded-2xl bg-[#007AFF] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50 ${PRESS}`}
                >
                  {submitting ? '启动中…' : '开始任务'}
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
                  <p className="text-[12px] font-medium text-[#1C1C1E]">配对码格式</p>
                  <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-[#8E8E93]">
                    codexpocket://add?name=…&amp;url=…&amp;token=…
                  </p>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-[#8E8E93]">
                  浏览器无法调用摄像头，请粘贴扫到的配对码
                </p>
                <textarea
                  value={qrText}
                  onChange={(event) => setQrText(event.target.value)}
                  rows={3}
                  placeholder="粘贴 codexpocket://add?… 配对码或带 ?token= 的服务地址"
                  className="mt-2 w-full resize-none rounded-2xl bg-[#EFEFF4] px-4 py-3 font-mono text-[12px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                />
                <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-[12px] text-[#8E8E93]">
                  <div className="flex justify-between gap-2">
                    <span>当前服务</span>
                    <span className="font-medium text-[#1C1C1E]">
                      {props.health?.backend?.kind ? String(props.health.backend.kind) : '—'}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between gap-2">
                    <span>已配对设备</span>
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
                      setError('配对码无效，应为 codexpocket://add?name=&url=&token=');
                      return;
                    }
                    void run(() => props.onPairing(parsed), () => {
                      setQrText('');
                      onSheetChange(null);
                    });
                  }}
                  className={`mt-4 min-h-[44px] w-full rounded-2xl bg-[#007AFF] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50 ${PRESS}`}
                >
                  {submitting ? '连接中…' : '连接'}
                </button>
                <button
                  type="button"
                  onClick={() => onSheetChange('accessCode')}
                  className={`mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-[13px] font-medium text-[#1C1C1E] ${PRESS}`}
                >
                  <KeyRound size={15} /> 手动输入访问码
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
                  placeholder="访问码"
                  autoComplete="off"
                  className="w-full rounded-2xl bg-[#EFEFF4] px-4 py-3 text-[15px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-[#8E8E93]">
                  访问码将作为 <code className="font-mono">x-access-token</code> 请求头发送，
                  并通过 /api/auth/session 换取会话凭证。
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
                  className={`mt-4 min-h-[44px] w-full rounded-2xl bg-[#007AFF] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50 ${PRESS}`}
                >
                  {submitting ? '连接中…' : '连接'}
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
