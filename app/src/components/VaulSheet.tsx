import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { COLORS, SHEET_HANDLE } from '../theme/optionATokens';
import { pushNativeBackLayer } from '../lib/nativeBridge';

/**
 * VaulSheet — the ONE bottom drawer primitive used by CupertinoSheetHost.
 * No centered modal anywhere in this app.
 *
 * Performance/UX note: shouldScaleBackground is intentionally DISABLED.
 * Vaul scales [data-vaul-drawer-wrapper] on open; because the glass TabBar is
 * position:fixed inside that wrapper, the transform shrinks/moves the whole
 * bar (users saw it "suddenly shrink") and forces a full-screen repaint on
 * every animation frame. We use a light dim overlay instead, which is GPU
 * cheap and leaves the TabBar visually stable under the sheet.
 */
export default function VaulSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => { onOpenChangeRef.current = onOpenChange; });
  useLayoutEffect(() => {
    if (open) return pushNativeBackLayer(() => onOpenChangeRef.current(false));
  }, [open]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      dismissible
    >
      <Drawer.Portal>
        <Drawer.Overlay />
        <Drawer.Content
          aria-describedby={subtitle ? 'tl-sheet-subtitle' : undefined}
        >
          {/* Contract: exactly 36 x 6 px, #C7C7CC, >=44px drag hit area */}
          <Drawer.Handle
            style={{
              width: SHEET_HANDLE.width,
              height: SHEET_HANDLE.height,
              background: COLORS.sheetHandle,
            }}
          />
          <div className="tl-sheet-body">
            {title && (
              <Drawer.Title className="tl-sheet-title" style={{ color: COLORS.labelPrimary }}>
                {title}
              </Drawer.Title>
            )}
            {subtitle && (
              <Drawer.Description
                id="tl-sheet-subtitle"
                className="tl-sheet-subtitle"
                style={{ color: COLORS.labelSecondary }}
              >
                {subtitle}
              </Drawer.Description>
            )}
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
