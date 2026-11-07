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

/** 底部拇指舱：输入舱 + 4 Tab 共用一条 bg-white/85 毛玻璃栏。 */
export default function GlassTabBar({ active, onChange, composer }: GlassTabBarProps) {
  return (
    <div className="z-20 shrink-0 border-t border-[#E5E5EA] bg-white/85 backdrop-blur-xl">
      {composer}
      <nav aria-label="主导航" className="flex items-stretch">
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
                'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
                isActive ? 'text-[#007AFF]' : 'text-[#8E8E93]',
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
