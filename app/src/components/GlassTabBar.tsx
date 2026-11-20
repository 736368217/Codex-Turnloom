import { MessageSquare, Laptop, Settings } from 'lucide-react';
import type { ReactElement } from 'react';
import { COLORS } from '../theme/optionATokens';
import { haptic } from '../lib/nativeBridge';
import { setActiveTab, TAB_LABELS, TAB_ORDER, type TabKey } from '../state/tabStore';

const ICONS: Record<TabKey, ReactElement> = {
  threads: <MessageSquare size={22} strokeWidth={1.9} />,
  devices: <Laptop size={22} strokeWidth={1.9} />,
  settings: <Settings size={22} strokeWidth={1.9} />,
};

/**
 * Fixed bottom tab bar.
 *
 * Hand-rolled instead of Konsta's Tabbar: Konsta injected an opaque absolute
 * background layer (the glass blur could only be restored with `!important`
 * overrides) and rendered every tab as `role="link"` inside a `role="tablist"`,
 * which is the wrong semantic for screen readers. Plain buttons give us the
 * contract's 56px band, a real `role="tab"` + `aria-selected`, and a press
 * feedback that tints instead of transforming (a transform here changes the
 * pointer geometry mid-press, the old "tab bar suddenly shrinks" defect).
 */
export default function GlassTabBar({ activeTab }: { activeTab: TabKey }) {
  return (
    <nav className="tl-tabbar" role="tablist" aria-label="主导航">
      {TAB_ORDER.map((tab) => {
        const active = tab === activeTab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={TAB_LABELS[tab]}
            className={`tl-tabbar-item${active ? ' tl-tabbar-item--active' : ''}`}
            style={{ color: active ? COLORS.blue : COLORS.labelSecondary }}
            onClick={() => { haptic('selection'); setActiveTab(tab); }}
          >
            {ICONS[tab]}
            <span className="tl-tabbar-label">{TAB_LABELS[tab]}</span>
          </button>
        );
      })}
    </nav>
  );
}
