import { MessageSquare, Laptop, Settings } from 'lucide-react';
import type { ReactElement } from 'react';
import { haptic } from '../lib/nativeBridge';
import { setActiveTab, TAB_LABELS, TAB_ORDER, type TabKey } from '../state/tabStore';

const ICONS: Record<TabKey, ReactElement> = {
  threads: <MessageSquare size={22} />,
  devices: <Laptop size={22} />,
  settings: <Settings size={22} />,
};

/**
 * Fixed bottom tab bar.
 *
 * Hand-rolled instead of Konsta's Tabbar: Konsta injected an opaque absolute
 * background layer (the glass blur could only be restored with `!important`
 * overrides) and rendered every tab as `role="link"` inside a `role="tablist"`,
 * which is the wrong semantic for screen readers. Plain buttons give us the
 * contract's 56px band, a real `role="tab"` + `aria-selected`, and a press
 * feedback that dims instead of transforming (a transform here changes the
 * pointer geometry mid-press, the old "tab bar suddenly shrinks" defect).
 *
 * 2.4.2: colour lives in CSS, not inline. The inline `color` here beat the
 * stylesheet, and a forced-colour rule on every tab descendant then pinned
 * every icon grey — the tab looked selected only in its label. The component
 * now ships state (`aria-selected` + the modifier class) and the stylesheet
 * owns ink/grey/press, so there is one source for the pixels.
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
