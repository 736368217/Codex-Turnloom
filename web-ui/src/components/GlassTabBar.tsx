import type { ReactNode } from 'react';
import { List, MessageCircle, Monitor, Settings, type LucideIcon } from 'lucide-react';
import { PRESS, cx } from '../lib/ui';

export type TabKey = 'chat' | 'sessions' | 'terminal' | 'settings';

export interface GlassTabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  /** 输入舱：与导航行放在同一个毛玻璃容器里，只有一条顶部边框。 */
  composer?: ReactNode;
}

const TABS: Array<{ key: TabKey; label: string; Icon: LucideIcon }> = [
  { key: 'chat', label: '对话', Icon: MessageCircle },
  { key: 'sessions', label: '会话', Icon: List },
  { key: 'terminal', label: '终端', Icon: Monitor },
  { key: 'settings', label: '设置', Icon: Settings },
];

/**
 * 底部拇指舱：输入舱 + 悬浮玻璃胶囊 4 Tab。
 * 玻璃背后是 daylight-canvas 的渐变，backdrop-blur 才有可折射的内容。
 * role=tab / data-tab / 按钮文字 / 44px 命中区保持不变，供 QA 断言。
 */
export default function GlassTabBar({ active, onChange, composer }: GlassTabBarProps) {
  return (
    <div className="glass-chrome z-20 shrink-0 border-t px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      {composer}
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
