/**
 * Keeping the primary action reachable while the soft keyboard is up.
 *
 * The Android WebView resizes the layout viewport when the keyboard opens
 * (measured: 390dp phone 796 → 517 px, 320dp phone 552 → 293 px), so the
 * scroll container gets shorter and the submit button simply falls below the
 * fold. Nothing scrolls it back on focus — before 2.4.3 only expanding the
 * manual form ran a `scrollIntoView`, and that happens before the keyboard
 * animation, so the button ended up under the keyboard again.
 *
 * The decision itself is pure so it can be tested without a browser.
 */

export type RevealRect = { top: number; bottom: number };

/** Extra room left between the control and the keyboard edge. */
export const REVEAL_MARGIN = 12;

/**
 * How many pixels the scroll container must move so the control's bottom edge
 * sits at least `margin` above the keyboard. 0 when it is already clear.
 */
export function revealOffset(target: RevealRect, visibleBottom: number, margin: number = REVEAL_MARGIN): number {
  if (!Number.isFinite(visibleBottom)) return 0;
  const limit = visibleBottom - margin;
  if (target.bottom <= limit) return 0;
  return Math.ceil(target.bottom - limit);
}

/**
 * Whether the control is fully inside the visible band (keyboard excluded).
 * `top` is kept in the signature so a control scrolled off the top is reported
 * as needing a reveal too — that happens on 320dp where the form is taller
 * than the band.
 */
export function needsReveal(target: RevealRect, visibleBottom: number, margin: number = REVEAL_MARGIN): boolean {
  return revealOffset(target, visibleBottom, margin) > 0;
}

/**
 * The bottom edge of what the user can actually see. `visualViewport` tracks
 * the keyboard precisely on Android; `innerHeight` is the fallback for WebViews
 * that only resize the layout viewport.
 */
export function visibleBottomOf(view: { visualViewport?: { height: number; offsetTop: number } | null; innerHeight: number }): number {
  const vv = view.visualViewport;
  if (vv && Number.isFinite(vv.height) && vv.height > 0) return vv.height + (vv.offsetTop || 0);
  return view.innerHeight;
}
