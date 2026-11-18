import { Tabbar, TabbarLink } from 'konsta/react';
import { Home, MessageSquare, Activity, Settings } from 'lucide-react';
import type { ReactElement } from 'react';
import { COLORS } from '../theme/optionATokens';
import { haptic } from '../lib/nativeBridge';
import { setActiveTab, TAB_LABELS, TAB_ORDER, type TabKey } from '../state/tabStore';

const ICONS: Record<TabKey, ReactElement> = {
  home: <Home size={22} strokeWidth={1.9} />,
  threads: <MessageSquare size={22} strokeWidth={1.9} />,
  monitors: <Activity size={22} strokeWidth={1.9} />,
  settings: <Settings size={22} strokeWidth={1.9} />,
};

/**
 * Fixed bottom TabBar. Deliberately no .tl-press class here: its
 * `transform: scale(.98)` changes the CSS layout box while a pointer is down,
 * which is the observed "tab bar suddenly shrinks" defect. Konsta's own
 * `active:opacity-30` is overridden by an opacity-neutral highlight in CSS.
 * elementFromPoint / getBoundingClientRect therefore stay identical.
 */
export default function GlassTabBar({ activeTab }: { activeTab: TabKey }) {
  return (
    <div className="tl-tabbar" role="tablist" aria-label="主导航">
      <Tabbar labels icons className="tl-tabbar-inner-reset" style={{ position: 'relative', width: '100%', background: 'transparent', paddingBottom: 0 }}>
        {TAB_ORDER.map((tab) => {
          const active = tab === activeTab;
          return (
            <TabbarLink
              key={tab}
              component="button"
              active={active}
              label={TAB_LABELS[tab]}
              icon={ICONS[tab]}
              style={{ color: active ? COLORS.blue : COLORS.labelSecondary, minHeight: 56, minWidth: 44 }}
              linkProps={{
                type: 'button', role: 'tab',
                'aria-selected': active,
                'aria-label': TAB_LABELS[tab],
              }}
              onClick={() => { haptic('selection'); setActiveTab(tab); }}
            />
          );
        })}
      </Tabbar>
    </div>
  );
}
