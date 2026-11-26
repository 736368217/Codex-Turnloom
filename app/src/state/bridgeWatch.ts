/**
 * The one thing that answers "is this computer still there": a cheap authorised
 * GET every 3 s while the app is in front.
 *
 * Why the existing surfaces were not enough: `refreshAll()` only runs when
 * something asks for data, and the device page asks for nothing, so a dead
 * service stayed 在线 until the user tapped something (QA defect 1). Health
 * would answer the question too, but it rebuilds the Codex home context and the
 * model catalogue on every call — far too heavy for a 3 s beat, and it would put
 * 1200 request-log lines an hour into the host log.
 *
 * So: `/api/ping` (no Desktop dependency, no log line) + `setOnline()` as the
 * single writer. The device card, the offline banner and the "switching harness
 * will fail" note all read that one flag instead of computing their own.
 */
import { API_ENDPOINTS, requestWithContext } from '../lib/turnloomApi';
import { createBridgeWatch, reachabilityOf } from '../lib/bridgeHealth';
import type { Reachability } from '../lib/bridgeHealth';
import { currentRequestContext, setOnline } from './sessionStore';

/** 3 s matches the chat screen's own poll, so nothing new is being asked of the host. */
export const BRIDGE_PROBE_MS = 3000;
/** Under the beat, so a hung probe cannot stack up behind the timer. */
export const BRIDGE_PROBE_TIMEOUT_MS = 2500;

const watch = createBridgeWatch({
  warn: message => console.warn(message),
  info: message => console.info(message),
  debug: message => console.debug(message),
});

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let inFlight = false;

/**
 * One probe. Returns what it measured about the link, or null when it had
 * nothing to say (no ready session, or the attempt was already superseded).
 */
export async function probeBridge(): Promise<Reachability | null> {
  const context = currentRequestContext();
  // Not paired / mid-reconnect: that window is sessionStore's to report, and a
  // probe landing inside it would fight the connecting state.
  if (!context || inFlight) return null;
  inFlight = true;
  try {
    const result = await requestWithContext<{ ok?: boolean }>(context, API_ENDPOINTS.ping, {
      method: 'GET',
      timeoutMs: BRIDGE_PROBE_TIMEOUT_MS,
    });
    const reach = reachabilityOf(result);
    const event = watch.record(reach);
    if (event.transition === 'steady' && reach === 'unknown') return null;
    if (reach !== 'unknown') setOnline(reach === 'reachable');
    return reach;
  } catch {
    // A probe must never take the timer down with it; the next beat retries.
    return null;
  } finally {
    inFlight = false;
  }
}

function tick(): void {
  timer = null;
  if (!running) return;
  const step = document.visibilityState === 'visible' ? probeBridge() : Promise.resolve(null);
  void step.then(() => {
    if (running && timer === null) timer = setTimeout(tick, BRIDGE_PROBE_MS);
  });
}

/**
 * Start the beat; the returned function stops it. Mounted by AppShell on the
 * same `[scope, generation]` key as foreground revalidation, so a machine or
 * harness switch restarts it against the new context.
 */
export function startBridgeWatch(): () => void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  running = true;
  tick();
  return () => {
    running = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** True while the last measured state is "the computer answers". */
export function bridgeIsReachable(): boolean {
  return !watch.down;
}
