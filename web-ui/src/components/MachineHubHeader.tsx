import { List, ListItem, Segmented, SegmentedButton } from 'konsta/react';
import { Monitor, Plus, QrCode, Settings, Sparkles } from 'lucide-react';
import {
  threadStatusKind,
  type HealthResponse,
  type Thread,
  type ThreadStatusKind,
} from '../lib/turnloomApi';
import { HIT_AREA_44, PRESS, StatusPill, cx, relativeTime, truncate } from '../lib/ui';

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
  waiting: { label: '待合并', tone: 'green' },
  running: { label: '进行中', tone: 'blue' },
  stale: { label: '进行中', tone: 'blue' },
  ended: { label: '已完成', tone: 'gray' },
  unknown: { label: '空闲', tone: 'gray' },
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
  const title = selected?.title || '项目总览';
  const deviceName = machineName || 'DESKTOP-PC';
  const deviceStatus = health === null ? '电脑离线' : `${deviceName} 已连接`;
  const visibleThreads = threads.slice(0, 4);

  return (
    <div className="px-4 pt-1 pb-2">
      {/* iOS 大标题区：只渲染一份标题 + 一份副标题。滚动后收缩为毛玻璃栏，
          全程保留在 header 内，不会被滚动容器裁掉。 */}
      <div
        className={cx(
          '-mx-4 border-b px-4 transition-all duration-300',
          scrolled
            ? 'border-[#E5E5EA] bg-white/80 py-2 backdrop-blur-xl'
            : 'border-transparent bg-[#F2F2F7] pb-4 pt-2',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {scrolled ? (
              <p className="truncate text-[17px] font-semibold leading-tight text-[#1C1C1E]">
                {truncate(title, 18)}
              </p>
            ) : (
              <h1 className="truncate text-[30px] font-bold leading-tight tracking-tight text-[#1C1C1E]">
                {truncate(title, 14)}
              </h1>
            )}
            <p className="mt-1 truncate text-[13px] text-[#8E8E93]">Codex-Turnloom</p>
          </div>
          <button
            type="button"
            aria-label="切换会话"
            title="切换会话"
            onClick={onOpenThreads}
            className={cx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EFEFF4] text-[#1C1C1E]',
              HIT_AREA_44,
              PRESS,
            )}
          >
            <Settings size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* 机器状态卡 */}
      <section className="mt-4 rounded-2xl border border-[#E5E5EA]/60 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <span
          className={cx(
            'inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs font-medium',
            health === null ? 'bg-[#EFEFF4] text-[#8E8E93]' : 'bg-[#34C759]/12 text-[#248A3D]',
          )}
        >
          <span className={cx('h-2 w-2 shrink-0 rounded-full', health === null ? 'bg-[#C7C7CC]' : 'bg-[#34C759]')} />
          <span className="truncate">{deviceStatus}</span>
        </span>

        <Segmented strong className="mt-4">
          <SegmentedButton
            strong
            active={engine === 'codex'}
            onClick={() => onEngineChange('codex')}
            className={cx(PRESS, '!h-11 normal-case')}
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
            className={cx(PRESS, '!h-11 normal-case')}
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
            'mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#EFEFF4] px-4 py-2.5 text-[14px] font-medium text-[#1C1C1E]',
            PRESS,
          )}
        >
          <QrCode size={16} strokeWidth={1.8} />
          扫码配对
        </button>
        <button
          type="button"
          onClick={onNewTask}
          className={cx(
            'mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-4 py-2.5 text-[14px] font-semibold text-white',
            PRESS,
          )}
        >
          <Plus size={16} strokeWidth={2} />
          新建任务
        </button>

        {health?.allowWrite === false && (
          <p className="mt-3 rounded-xl bg-[#FF3B30]/12 px-3 py-2 text-[12px] leading-relaxed text-[#D70015]">
            只读模式：发送、中断与审批均已停用。
          </p>
        )}
      </section>

      {/* 会话列表 */}
      {threads.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-[#E5E5EA]/60 bg-white p-4 text-[13px] leading-relaxed text-[#8E8E93] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          暂无会话，扫码配对或新建任务
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
                title={<span className="block truncate">{thread.title || '未命名会话'}</span>}
                text={<span className="block truncate">{truncate(thread.preview || '', 120)}</span>}
                footer={relativeTime(thread.updatedAtMs)}
                after={<StatusPill label={pill.label} tone={pill.tone} />}
                onClick={() => onSelectThread(thread.id)}
                className={cx(
                  'w-full min-h-[44px] text-left',
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
            title={<span className="text-[#007AFF]">查看全部</span>}
            onClick={onOpenThreads}
            className={cx('w-full min-h-[44px] text-left', PRESS)}
            titleFontSizeIos="text-[15px]"
          />
        </List>
      )}
    </div>
  );
}
