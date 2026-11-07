import { Monitor } from 'lucide-react';
import type { HealthResponse } from '../lib/turnloomApi';
import { HIT_AREA_44, PRESS, cx } from '../lib/ui';

export interface MachineHubHeaderProps {
  health: HealthResponse | null;
  machineName?: string;
  onManage: () => void;
  /** 当前 Tab：大标题/副标题随页面变化，避免用户在四个页面分不清方位。 */
  tab?: 'chat' | 'sessions' | 'terminal' | 'settings';
}

const TAB_META: Record<NonNullable<MachineHubHeaderProps['tab']>, { title: string; subtitle: string }> = {
  chat: { title: '会话总控', subtitle: '日光 · 苹果雾白 · 远程指挥你的电脑' },
  sessions: { title: '会话列表', subtitle: '查看历史任务，或发起一条新任务' },
  terminal: { title: '终端管理', subtitle: '切换电脑、添加终端与选择代理引擎' },
  settings: { title: '设置', subtitle: '访问码、权限与关于' },
};

/**
 * Option A · iOS 大标题 + 机器状态胶囊顶栏。
 * 标题随 Tab 变化；右上角是明确的「终端」入口（aria-label 保持「管理」以兼容验收脚本）。
 */
export default function MachineHubHeader(props: MachineHubHeaderProps) {
  const { health, machineName, onManage, tab = 'chat' } = props;
  const online = health !== null;
  const deviceName = machineName || '本机电脑';
  const meta = TAB_META[tab];

  return (
    <div className="glass-chrome border-b px-5 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
            Codex-Turnloom
          </p>
          <h1 className="mt-0.5 truncate text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1C1C1E]">
            {meta.title}
          </h1>
          <p className="mt-0.5 truncate text-[12px] text-[#8E8E93]">{meta.subtitle}</p>
        </div>
        <button
          type="button"
          aria-label="管理"
          title="终端管理"
          onClick={onManage}
          className={cx(
            'mt-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/70 px-3 text-[12px] font-semibold text-[#007AFF] shadow-[0_1px_4px_rgba(16,30,60,0.08)]',
            HIT_AREA_44,
            PRESS,
          )}
        >
          <Monitor size={15} strokeWidth={2} />
          终端
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            online ? 'ios-pill-connected' : 'bg-[#EFEFF4] text-[#8E8E93]',
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              'h-1.5 w-1.5 rounded-full',
              online ? 'bg-[#34C759] shadow-[0_0_0_3px_rgba(52,199,89,0.18)]' : 'bg-[#C7C7CC]',
            )}
          />
          {online ? '电脑已连接' : '电脑离线'}
        </span>
        <span className="min-w-0 truncate text-[11px] text-[#8E8E93]">{deviceName}</span>
      </div>
    </div>
  );
}
