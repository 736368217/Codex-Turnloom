import { List, Monitor, Settings, type LucideIcon } from 'lucide-react';
import { PRESS, cx } from '../lib/ui';

/**
 * 方案 A（微信/QQ 模型）：底栏只属于「一级页」，3 个 Tab。
 * 「对话」= 会话列表（很多会话）；点某条会话进入全屏聊天详情页，
 * 详情页完全不渲染本组件（无底栏），只有紧凑顶栏 + 消息流 + 输入舱。
 */
export type TabKey = 'chat' | 'terminal' | 'settings';

export interface GlassTabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

const TABS: Array<{ key: TabKey; label: string; Icon: LucideIcon }> = [
  { key: 'chat', label: '对话', Icon: List },
  { key: 'terminal', label: '终端', Icon: Monitor },
  { key: 'settings', label: '设置', Icon: Settings },
];

export default function GlassTabBar({ active, onChange }: GlassTabBarProps) {
  return (
    <div className="glass-chrome z-20 shrink-0 border-t px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      <nav aria-label="主导航" className="ios-floating-tabs mt-2 flex items-stretch p-1">
        {TABS.map(({ key, label, Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              data-tab={key}
              role="tab"
              aria-label={label}
              aria-selected={isActive}
              onClick={() => onChange(key)}
              className={cx(
                'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] py-1.5',
                isActive
                  ? 'bg-[#007AFF]/12 text-[#007AFF] shadow-[inset_0_1px_2px_rgba(0,122,255,0.10)]'
                  : 'text-[#8E8E93]',
                PRESS,
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className={cx('text-[10px] leading-none', isActive && 'font-semibold')}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
