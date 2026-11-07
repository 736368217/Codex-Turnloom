import { useState } from 'react';
import { Segmented, SegmentedButton } from 'konsta/react';
import {
  Check,
  ChevronRight,
  KeyRound,
  Monitor,
  Pencil,
  Plus,
  QrCode,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  loadConnection,
  threadStatusKind,
  type HealthResponse,
  type Thread,
  type ThreadStatusKind,
} from '../lib/turnloomApi';
import { PRESS, StatusPill, cx, relativeTime, truncate } from '../lib/ui';

export interface TerminalEntry {
  id: string;
  name: string;
  url: string;
  token: string;
}
export type TerminalPatch = Partial<Pick<TerminalEntry, 'name' | 'url' | 'token'>>;

const TERMINALS_KEY = 'option-a:terminals:v1';
const ACTIVE_TERMINAL_KEY = 'option-a:selected-terminal:v1';

function readUrlToken(): string {
  try {
    return new URLSearchParams(window.location.search).get('token') || '';
  } catch {
    return '';
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadTerminals(): TerminalEntry[] {
  const store = safeStorage();
  try {
    const raw = store?.getItem(TERMINALS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const list = parsed
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          .map((item) => ({
            id: String(item.id || ''),
            name: String(item.name || '未命名终端'),
            url: String(item.url || ''),
            token: String(item.token || ''),
          }))
          .filter((item) => item.id);
        if (list.length) {
          const urlToken = readUrlToken();
          return urlToken ? list.map((item, i) => (i === 0 ? { ...item, token: urlToken } : item)) : list;
        }
      }
    }
  } catch {
    /* 存储不可用时使用内存默认值 */
  }
  const current = loadConnection();
  return [
    {
      id: 'local',
      name: '本机 · de',
      url: current.url || '',
      token: readUrlToken() || current.token || '',
    },
  ];
}

export function saveTerminals(list: TerminalEntry[]): void {
  const store = safeStorage();
  try {
    store?.setItem(TERMINALS_KEY, JSON.stringify(list));
  } catch {
    /* 存储禁用时仅保留内存状态 */
  }
}

export function readActiveTerminalId(): string | null {
  try {
    return safeStorage()?.getItem(ACTIVE_TERMINAL_KEY) || null;
  } catch {
    return null;
  }
}

export function writeActiveTerminalId(id: string): void {
  try {
    safeStorage()?.setItem(ACTIVE_TERMINAL_KEY, id);
  } catch {
    /* 存储禁用时仅保留内存状态 */
  }
}

const PILL_STYLE: Record<ThreadStatusKind, { label: string; tone: 'blue' | 'green' | 'gray' }> = {
  waiting: { label: '待合并', tone: 'green' },
  running: { label: '进行中', tone: 'blue' },
  stale: { label: '进行中', tone: 'blue' },
  ended: { label: '已完成', tone: 'gray' },
  unknown: { label: '空闲', tone: 'gray' },
};

const CARD = 'rounded-2xl border border-[#E5E5EA]/60 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]';

export function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-2 mt-4 px-1 text-[13px] font-semibold text-[#8E8E93]">{children}</h2>
  );
}

export function TerminalPicker({
  terminals,
  onPick,
  onScanAdd,
}: {
  terminals: TerminalEntry[];
  onPick: (entry: TerminalEntry) => void;
  onScanAdd: () => void;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-12 pb-6">
      <h1 className="text-[26px] font-bold tracking-tight text-[#1C1C1E]">选择终端</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[#8E8E93]">
        选好终端即可开始聊天；之后可在「终端」里修改或切换。
      </p>
      <div className="mt-7 space-y-2">
        {terminals.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onPick(entry)}
            className={cx(
              `flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left ${CARD}`,
              PRESS,
            )}
          >
            <Monitor size={18} className="shrink-0 text-[#007AFF]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-[#1C1C1E]">
                {entry.name}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-[#8E8E93]">
                {entry.url || '当前服务'}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-[#8E8E93]" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onScanAdd}
        className={cx(
          'mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-4 text-[14px] font-medium text-[#007AFF]',
          PRESS,
        )}
      >
        <QrCode size={16} /> 扫码添加
      </button>
    </main>
  );
}

export function SessionsPage({
  threads,
  selectedThreadId,
  onSelectThread,
  onNewTask,
}: {
  threads: Thread[];
  selectedThreadId: string;
  onSelectThread: (id: string) => void;
  onNewTask: () => void;
}) {
  return (
    <div className="pb-2">
      <SectionTitle>会话列表</SectionTitle>
      <button
        type="button"
        onClick={onNewTask}
        className={cx(
          `mb-3 flex min-h-[44px] w-full items-center justify-center gap-2 ${CARD} px-4 text-[14px] font-medium text-[#007AFF]`,
          PRESS,
        )}
      >
        <Plus size={16} /> 新建任务
      </button>
      {threads.length === 0 ? (
        <div className={cx(CARD, 'px-4 py-6 text-center text-[13px] leading-relaxed text-[#8E8E93]')}>
          暂无会话，可在上方新建任务
        </div>
      ) : (
        <div className={cx(CARD, 'divide-y divide-[#E5E5EA]/70 overflow-hidden')}>
          {threads.map((thread) => {
            const pill = PILL_STYLE[threadStatusKind(thread.status)];
            const active = thread.id === selectedThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelectThread(thread.id)}
                className={cx(
                  'flex min-h-[44px] w-full items-start gap-2 px-4 py-3 text-left',
                  active && 'bg-[#007AFF]/5',
                  PRESS,
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#1C1C1E]">
                      {thread.title || '未命名会话'}
                    </span>
                    <StatusPill label={pill.label} tone={pill.tone} />
                  </span>
                  <span className="mt-1 block truncate text-[12px] text-[#8E8E93]">
                    {truncate(thread.preview || '', 100)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#8E8E93]">
                    {relativeTime(thread.updatedAtMs)}
                  </span>
                </span>
                {active && <Check size={16} className="mt-0.5 shrink-0 text-[#007AFF]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TerminalPage({
  terminals,
  activeId,
  health,
  engine,
  onEngineChange,
  onSelect,
  onAdd,
  onEdit,
  onRemove,
  onReconnect,
}: {
  terminals: TerminalEntry[];
  activeId: string;
  health: HealthResponse | null;
  engine: 'codex' | 'pi';
  onEngineChange: (engine: 'codex' | 'pi') => void;
  onSelect: (entry: TerminalEntry) => void;
  onAdd: () => void;
  onEdit: (id: string, patch: TerminalPatch) => void;
  onRemove: (id: string) => void;
  onReconnect: () => void;
}) {
  const [editingId, setEditingId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');

  const startEdit = (entry: TerminalEntry) => {
    setEditingId(entry.id);
    setName(entry.name);
    setUrl(entry.url);
    setToken(entry.token);
  };
  const commitEdit = () => {
    if (!editingId) return;
    onEdit(editingId, { name: name.trim() || '未命名终端', url: url.trim(), token: token.trim() });
    setEditingId('');
  };

  return (
    <div className="pb-2">
      <SectionTitle>连接状态</SectionTitle>
      <div className={cx(CARD, 'flex min-h-[44px] items-center gap-2 px-4 py-3')}>
        <span className={cx('h-2 w-2 shrink-0 rounded-full', health === null ? 'bg-[#C7C7CC]' : 'bg-[#34C759]')} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-[#1C1C1E]">
          {health === null ? '电脑离线' : '电脑已连接'}
        </span>
        <span className="shrink-0 text-[11px] text-[#8E8E93]">
          服务后端 {health?.backend?.kind ? String(health.backend.kind) : '—'}
        </span>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        className={cx(
          'mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#EFEFF4] px-4 text-[14px] font-medium text-[#1C1C1E]',
          PRESS,
        )}
      >
        重新连接
      </button>

      <SectionTitle>已保存终端 · 点击切换</SectionTitle>
      <div className="space-y-2">
        {terminals.map((entry) => {
          const active = entry.id === activeId;
          return (
            <div key={entry.id} className={cx(CARD, 'p-3', active && 'border-[#007AFF]/40')}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  className={cx('flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left', PRESS)}
                >
                  <Monitor size={17} className={cx('shrink-0', active ? 'text-[#007AFF]' : 'text-[#8E8E93]')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-[#1C1C1E]">
                      {entry.name}
                    </span>
                    <span className="block truncate text-[11px] text-[#8E8E93]">
                      {entry.url || '当前服务'}
                    </span>
                  </span>
                  {active && <Check size={16} className="shrink-0 text-[#007AFF]" />}
                </button>
                <button
                  type="button"
                  aria-label={`修改 ${entry.name}`}
                  title={`修改 ${entry.name}`}
                  onClick={() => startEdit(entry)}
                  className={cx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFEFF4] text-[#8E8E93]',
                    PRESS,
                  )}
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${entry.name}`}
                  title={`删除 ${entry.name}`}
                  disabled={terminals.length <= 1}
                  onClick={() => onRemove(entry.id)}
                  className={cx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FF3B30]/10 text-[#D70015] disabled:opacity-40',
                    PRESS,
                  )}
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {editingId === entry.id && (
                <div className="mt-2 space-y-2 border-t border-[#E5E5EA] pt-3">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="终端名称"
                    aria-label="终端名称"
                    className="min-h-[44px] w-full rounded-xl bg-[#EFEFF4] px-3 text-[14px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                  />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="服务地址（留空为当前服务）"
                    aria-label="服务地址"
                    className="min-h-[44px] w-full rounded-xl bg-[#EFEFF4] px-3 text-[13px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                  />
                  <input
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="访问码"
                    aria-label="访问码"
                    className="min-h-[44px] w-full rounded-xl bg-[#EFEFF4] px-3 text-[13px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/20 select-text"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId('')}
                      className={cx(
                        'min-h-[44px] flex-1 rounded-xl bg-[#EFEFF4] px-4 text-[14px] font-medium text-[#1C1C1E]',
                        PRESS,
                      )}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={commitEdit}
                      className={cx(
                        'min-h-[44px] flex-1 rounded-xl bg-[#007AFF] px-4 text-[14px] font-semibold text-white',
                        PRESS,
                      )}
                    >
                      保存修改
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className={cx(
          'mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#007AFF] px-4 text-[14px] font-semibold text-white',
          PRESS,
        )}
      >
        <QrCode size={16} /> 扫码新增终端
      </button>

      <SectionTitle>代理引擎</SectionTitle>
      <Segmented strong>
        <SegmentedButton
          strong
          active={engine === 'codex'}
          onClick={() => onEngineChange('codex')}
          className={cx(PRESS, '!h-11 normal-case')}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <Monitor size={15} /> Codex CLI
          </span>
        </SegmentedButton>
        <SegmentedButton
          strong
          active={engine === 'pi'}
          onClick={() => onEngineChange('pi')}
          className={cx(PRESS, '!h-11 normal-case')}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <Sparkles size={15} /> Pi Agent
          </span>
        </SegmentedButton>
      </Segmented>
      <p className="mt-2 px-1 text-[11px] leading-relaxed text-[#8E8E93]">
        切换、新增、修改终端与引擎都在这里完成。
      </p>
    </div>
  );
}

export function SettingsPage({
  health,
  readOnly,
  terminalName,
  onAccessCode,
}: {
  health: HealthResponse | null;
  readOnly: boolean;
  terminalName: string;
  onAccessCode: () => void;
}) {
  return (
    <div className="pb-2">
      <SectionTitle>访问码</SectionTitle>
      <div className={cx(CARD, 'divide-y divide-[#E5E5EA]/70')}>
        <div className="flex min-h-[44px] items-center justify-between gap-2 px-4 py-3">
          <span className="text-[13px] text-[#8E8E93]">当前终端</span>
          <span className="min-w-0 truncate text-[13px] font-medium text-[#1C1C1E]">
            {terminalName || '—'}
          </span>
        </div>
        <button
          type="button"
          onClick={onAccessCode}
          className={cx('flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left', PRESS)}
        >
          <KeyRound size={16} className="shrink-0 text-[#007AFF]" />
          <span className="min-w-0 flex-1 text-[14px] font-medium text-[#007AFF]">修改访问码</span>
          <ChevronRight size={16} className="shrink-0 text-[#8E8E93]" />
        </button>
      </div>
      <p className="mt-2 px-1 text-[11px] leading-relaxed text-[#8E8E93]">
        访问码将作为 <code className="font-mono">x-access-token</code> 请求头发送。
      </p>

      <SectionTitle>权限</SectionTitle>
      <div className={cx(CARD, 'px-4 py-3')}>
        <p className="text-[13px] font-medium text-[#1C1C1E]">
          {readOnly ? '只读模式' : health ? '写入权限' : '未连接'}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">
          {readOnly
            ? '只读模式下发送、中断与审批均已停用。'
            : health
              ? '可发送消息、中断运行中的任务并审批改动。'
              : '请先在「终端」页检查连接状态。'}
        </p>
      </div>

      <SectionTitle>关于</SectionTitle>
      <div className={cx(CARD, 'px-4 py-3')}>
        <p className="text-[14px] font-semibold text-[#1C1C1E]">Codex-Turnloom</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">
          会话总控 · 日光 · 苹果雾白。远程查看并指挥电脑端代理。
        </p>
      </div>
    </div>
  );
}
