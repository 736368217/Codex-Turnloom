import { List, ListItem, Navbar, Segmented, SegmentedButton } from 'konsta/react';
import { Monitor, Plus, QrCode, Settings, Sparkles } from 'lucide-react';
import {
  threadStatusKind,
  type HealthResponse,
  type Thread,
  type ThreadStatusKind,
} from '../lib/turnloomApi';
import { PRESS, StatusPill, cx, relativeTime, truncate } from '../lib/ui';

export interface MachineHubHeaderProps {
  health: HealthResponse | null;
  machineName?: string;
  threads: Thread[];
  selectedThreadId: string;
  engine: 'codex' | 'pi';
  onEngineChange: (engine: 'codex' | 'pi') => void;
  onScanQr: () => void;
  onSelectThread: (id: string) => void;
  onOpenThreads: () => void;
  onNewTask: () => void;
  scrolled: boolean;
}

const PILL_STYLE: Record<
  ThreadStatusKind,
  { label: string; tone: 'blue' | 'green' | 'gray' }
> = {
  waiting: { label: 'Merge Request', tone: 'green' },
  running: { label: 'Active', tone: 'blue' },
  stale: { label: 'Active', tone: 'blue' },
  ended: { label: 'Completed', tone: 'gray' },
  unknown: { label: 'Idle', tone: 'gray' },
};

export default function MachineHubHeader(props: MachineHubHeaderProps) {
  const {
    health,
    machineName,
    threads,
    selectedThreadId,
    engine,
    onEngineChange,
    onScanQr,
    onSelectThread,
    onOpenThreads,
    onNewTask,
    scrolled,
  } = props;

  const selected = threads.find((thread) => thread.id === selectedThreadId);
  const title = selected?.title || 'Project Overview';
  const visibleThreads = threads.slice(0, 4);

  return (
    <div className="px-4 pt-1 pb-2">
      {/* iOS large title → compact frosted bar. No hamburger, no horizontal nav. */}
      <div
        className={cx(
          '-mx-4 border-b transition-all duration-300',
          scrolled
            ? 'border-[#E5E5EA] bg-white/80 backdrop-blur-xl'
            : 'border-transparent bg-[#F2F2F7]',
        )}
      >
        <Navbar
          large
          transparent
          title={title}
          subtitle="Codex-Turnloom"
          outline={false}
          className="!bg-transparent"
          right={
            <button
              type="button"
              aria-label="Switch thread"
              title="Switch thread"
              onClick={onOpenThreads}
              className={cx(
                'flex h-9 w-9 items-center justify-center rounded-full bg-[#EFEFF4] text-[#1C1C1E]',
                PRESS,
              )}
            >
              <Settings size={18} strokeWidth={1.8} />
            </button>
          }
        />
        {!scrolled && (
          <div className="px-4 pb-4">
            <h1 className="text-3xl font-bold tracking-tight text-[#1C1C1E]">
              {title}
            </h1>
            <p className="mt-1 text-[13px] text-[#8E8E93]">Codex-Turnloom</p>
          </div>
        )}
      </div>

      {/* Machine status card */}
      <section className="mt-4 rounded-2xl border border-[#E5E5EA]/60 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {health === null ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-[#EFEFF4] px-3 py-1 text-xs font-medium text-[#8E8E93]">
            <span className="h-2 w-2 rounded-full bg-[#C7C7CC]" />
            DESKTOP-PC OFFLINE
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-[#34C759]/12 px-3 py-1 text-xs font-medium text-[#248A3D]">
            <span className="h-2 w-2 rounded-full bg-[#34C759]" />
            {machineName || 'DESKTOP-PC'} CONNECTED
          </span>
        )}

        <Segmented strong className="mt-4">
          <SegmentedButton
            strong
            active={engine === 'codex'}
            onClick={() => onEngineChange('codex')}
            className={PRESS}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <Monitor size={15} strokeWidth={1.8} />
              Codex CLI
            </span>
          </SegmentedButton>
          <SegmentedButton
            strong
            active={engine === 'pi'}
            onClick={() => onEngineChange('pi')}
            className={PRESS}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <Sparkles size={15} strokeWidth={1.8} />
              Pi Agent
            </span>
          </SegmentedButton>
        </Segmented>

        <button
          type="button"
          onClick={onScanQr}
          className={cx(
            'mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#EFEFF4] px-4 py-2.5 text-[14px] font-medium text-[#1C1C1E]',
            PRESS,
          )}
        >
          <QrCode size={16} strokeWidth={1.8} />
          Scan QR to Pair
        </button>
        <button
          type="button"
          onClick={onNewTask}
          className={cx(
            'mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-4 py-2.5 text-[14px] font-semibold text-white',
            PRESS,
          )}
        >
          <Plus size={16} strokeWidth={2} />
          New Task
        </button>

        {health?.allowWrite === false && (
          <p className="mt-3 rounded-xl bg-[#FF3B30]/12 px-3 py-2 text-[12px] leading-relaxed text-[#D70015]">
            Read-only mode — sending, interrupts and approvals are disabled.
          </p>
        )}
      </section>

      {/* Session rows */}
      {threads.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-[#E5E5EA]/60 bg-white p-4 text-[13px] leading-relaxed text-[#8E8E93] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          No conversations yet. Scan a QR code or start a new task.
        </div>
      ) : (
        <List strongIos insetIos className="!mx-0 !my-4">
          {visibleThreads.map((thread) => {
            const isSelected = thread.id === selectedThreadId;
            const pill = PILL_STYLE[threadStatusKind(thread.status)];
            return (
              <ListItem
                key={thread.id}
                component="button"
                title={<span className="block truncate">{thread.title || 'Untitled conversation'}</span>}
                text={<span className="block truncate">{truncate(thread.preview || '', 120)}</span>}
                footer={relativeTime(thread.updatedAtMs)}
                after={<StatusPill label={pill.label} tone={pill.tone} />}
                onClick={() => onSelectThread(thread.id)}
                className={cx(
                  'w-full text-left',
                  PRESS,
                  isSelected
                    ? 'border-l-[3px] border-l-[#007AFF] bg-[#007AFF]/5'
                    : 'border-l-[3px] border-l-transparent',
                )}
                titleFontSizeIos="text-[15px]"
              />
            );
          })}
          <ListItem
            component="button"
            link
            title={<span className="text-[#007AFF]">View all</span>}
            onClick={onOpenThreads}
            className={cx('w-full text-left', PRESS)}
            titleFontSizeIos="text-[15px]"
          />
        </List>
      )}
    </div>
  );
}
