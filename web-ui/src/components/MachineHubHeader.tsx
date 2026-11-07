import { Settings } from 'lucide-react';
import type { HealthResponse } from '../lib/turnloomApi';
import { HIT_AREA_44, PRESS, cx } from '../lib/ui';

export interface MachineHubHeaderProps {
  health: HealthResponse | null;
  machineName?: string;
  onManage: () => void;
}

/**
 * Option A · iOS 大标题 + 机器状态胶囊顶栏。
 * 参考 docs/option-a/previews/02_*.jpg 左屏：大标题、副标题、绿色
 * 连接状态胶囊、毛玻璃导航。管理入口 aria-label 保持不变。
 */
export default function MachineHubHeader(props: MachineHubHeaderProps) {
  const { health, machineName, onManage } = props;
  const online = health !== null;
  const deviceName = machineName || '本机电脑';

  return (
    <div className="glass-chrome border-b px-5 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
            Codex-Turnloom
          </p>
          <h1 className="mt-0.5 truncate text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1C1C1E]">
            会话总控
          </h1>
          <p className="mt-0.5 truncate text-[12px] text-[#8E8E93]">
            日光 · 苹果雾白 · 远程指挥你的电脑
          </p>
        </div>
        <button
          type="button"
          aria-label="管理"
          title="管理"
          onClick={onManage}
          className={cx(
            'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/70 text-[#1C1C1E] shadow-[0_1px_4px_rgba(16,30,60,0.08)]',
            HIT_AREA_44,
            PRESS,
          )}
        >
          <Settings size={18} strokeWidth={1.8} />
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
