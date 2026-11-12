import type { ReactNode, CSSProperties, ButtonHTMLAttributes, ReactElement } from 'react';
import { COLORS, CARD_SHADOW, MIN_TAP_SIZE, PRESS, RADIUS } from '../theme/optionATokens';

/** Shared inline-style helpers so every component uses contract section 4 tokens. */

export const cardStyle: CSSProperties = {
  background: COLORS.surface,
  borderRadius: RADIUS.card,
  boxShadow: CARD_SHADOW,
};

export const canvasStyle: CSSProperties = { background: COLORS.canvas };
export const secondaryTextStyle: CSSProperties = { color: COLORS.labelSecondary };
export const primaryTextStyle: CSSProperties = { color: COLORS.labelPrimary };
export const blueTextStyle: CSSProperties = { color: COLORS.blue };
export const separatorStyle: CSSProperties = { background: COLORS.separator };

export const pressStyle: CSSProperties = {
  transition: `transform ${PRESS.durationMs}ms ease, opacity ${PRESS.durationMs}ms ease`,
  minHeight: MIN_TAP_SIZE,
  minWidth: MIN_TAP_SIZE,
  touchAction: 'manipulation',
};

export const rowStyle: CSSProperties = { minHeight: MIN_TAP_SIZE };

/** Lightweight tappable row with press feedback and >=44px hit area. */
export interface TapRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  inset?: number;
}

export function TapRow({ children, leading, trailing, inset = 16, style, ...rest }: TapRowProps) {
  return (
    <button
      type="button"
      className="tl-press"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        minHeight: MIN_TAP_SIZE,
        padding: `8px ${inset}px`,
        border: 0,
        background: 'transparent',
        textAlign: 'left',
        color: COLORS.labelPrimary,
        ...pressStyle,
        ...style,
      }}
      {...rest}
    >
      {leading != null && <span style={{ flex: '0 0 auto', display: 'flex' }}>{leading}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {trailing != null && <span style={{ flex: '0 0 auto', display: 'flex' }}>{trailing}</span>}
    </button>
  );
}

/** Section label used above grouped cards. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="tl-section-title" style={{ padding: '18px 20px 8px' }}>
      {children}
    </div>
  );
}

/** Status pill: neutral / blue / green / red, all light-mode safe. */
export type PillTone = 'neutral' | 'blue' | 'green' | 'red';

export function StatusPill({
  children,
  tone = 'neutral',
  active = false,
}: {
  children: ReactNode;
  tone?: PillTone;
  active?: boolean;
}) {
  const palette: Record<PillTone, { fg: string; bg: string }> = {
    neutral: { fg: COLORS.labelSecondary, bg: COLORS.fillSecondary },
    blue: { fg: COLORS.actionBlue, bg: active ? '#DCEBFF' : COLORS.fillSecondary },
    green: { fg: COLORS.actionGreen, bg: active ? '#E1F7E8' : COLORS.fillSecondary },
    red: { fg: COLORS.actionRed, bg: active ? '#FFE4E2' : COLORS.fillSecondary },
  };
  const p = palette[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        minHeight: 28,
        padding: '0 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: p.fg,
        background: p.bg,
      }}
    >
      {children}
    </span>
  );
}

export type ActionVariant = 'primary' | 'green' | 'red' | 'neutral';

/** Primary / destructive / neutral full-width action button, >=44px tall. */
export function ActionButton({
  children,
  variant = 'primary',
  icon,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ActionVariant;
  icon?: ReactElement;
}) {
  const backgrounds: Record<ActionVariant, string> = {
    primary: COLORS.actionBlue,
    green: COLORS.actionGreen,
    red: COLORS.actionRed,
    neutral: COLORS.fillSecondary,
  };
  const foregrounds: Record<ActionVariant, string> = {
    primary: '#FFFFFF',
    green: '#FFFFFF',
    red: '#FFFFFF',
    neutral: COLORS.labelPrimary,
  };
  return (
    <button
      type="button"
      className="tl-press"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        minHeight: 50,
        padding: '0 18px',
        border: 0,
        borderRadius: RADIUS.card,
        background: backgrounds[variant],
        color: foregrounds[variant],
        fontSize: 16,
        fontWeight: 600,
        ...pressStyle,
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** Empty state / offline degraded state card. */
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="tl-card tl-empty-card" style={{ ...cardStyle, padding: 16, textAlign: 'center', margin: '0 16px' }}>
      {icon && <div data-empty-icon style={{ color: COLORS.labelSecondary, marginBottom: 6 }}>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.labelPrimary }}>{title}</div>
      {description && <div style={{ fontSize: 12, lineHeight: 17, color: COLORS.labelSecondary, marginTop: 4 }}>{description}</div>}
    </div>
  );
}
