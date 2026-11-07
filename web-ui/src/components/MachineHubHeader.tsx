import { Settings } from 'lucide-react';
import type { HealthResponse } from '../lib/turnloomApi';
import { HIT_AREA_44, PRESS, cx } from '../lib/ui';

export interface MachineHubHeaderProps {
  health: HealthResponse | null;
  machineName?: string;
  onManage: () => void;
}

/** 日常首屏顶栏：只有一行「终端名 + 状态点 + 管理入口」。 */
export default function MachineHubHeader(props: MachineHubHeaderProps) {
  const { health, machineName, onManage } = props;
  const online = health !== null;
  const deviceName = machineName || '本机电脑';

  return (
    <div className="flex min-h-[44px] shrink-0 items-center gap-2 border-b border-[#E5E5EA] bg-white/80 px-4 backdrop-blur-xl">
      <span
        aria-hidden="true"
        className={cx('h-2 w-2 shrink-0 rounded-full', online ? 'bg-[#34C759]' : 'bg-[#C7C7CC]')}
      />
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#8E8E93]">
        {deviceName} · {online ? '已连接' : '离线'}
      </h1>
      <button
        type="button"
        aria-label="管理"
        title="管理"
        onClick={onManage}
        className={cx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EFEFF4] text-[#1C1C1E]',
          HIT_AREA_44,
          PRESS,
        )}
      >
        <Settings size={18} strokeWidth={1.8} />
      </button>
    </div>
  );
}
