/**
 * "Can the phone reach this computer" is a different question from "is Codex
 * Desktop usable", and the two must never collapse into one flag.
 *
 * QA 2026-11-26 (defect 1): the device card said 在线 for two minutes after the
 * service was killed, because the only thing that ever wrote that flag was a
 * failed request — and sitting on the device page sends none. Conversely, a
 * 4xx/5xx means the service answered, i.e. the link is *fine*; the single-app
 * contract forbids reading that as offline.
 *
 * This module is the pure half: turn one probe result into reachability, and
 * turn a stream of reachability readings into at most one log line per state
 * change (defect 5's lesson — a 3 s probe must never fill the log).
 */

export type Reachability = 'reachable' | 'unreachable' | 'unknown';

export interface ProbeResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * What one probe proved about the link.
 *
 * `unknown` is a real answer: an attempt that belongs to a superseded
 * machine/harness says nothing about this one, so it must not flip the badge.
 */
export function reachabilityOf(result: ProbeResult): Reachability {
  if (result.ok) return 'reachable';
  if (result.status !== 0) return 'reachable'; // the service answered; 4xx/5xx is business, not transport
  const error = String(result.error || '').toLowerCase();
  if (error === 'stale-context') return 'unknown';
  return 'unreachable';
}

export interface BridgeLogSink {
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

export type BridgeTransition = 'steady' | 'went-down' | 'repeat-down' | 'came-up';
export type BridgeLevel = 'none' | 'warn' | 'info' | 'debug';

export interface BridgeEvent {
  transition: BridgeTransition;
  level: BridgeLevel;
  failures: number;
}

/**
 * Edge detector for the link state.
 *
 * First failure is a warn (the user-visible state just changed), repeats of the
 * same failure drop to debug, recovery is one info line. No backoff anywhere:
 * the probe *is* the recovery detector, and backing off would only make the
 * badge slower to come back.
 */
export function createBridgeWatch(sink: BridgeLogSink, label = 'bridge') {
  let down = false;
  let failures = 0;

  return {
    get down(): boolean {
      return down;
    },
    get failures(): number {
      return failures;
    },
    record(reach: Reachability): BridgeEvent {
      if (reach === 'unknown') return { transition: 'steady', level: 'none', failures };
      if (reach === 'unreachable') {
        failures += 1;
        if (!down) {
          down = true;
          sink.warn(`[${label}] no answer from the computer; the device card reads 离线 until it answers.`);
          return { transition: 'went-down', level: 'warn', failures };
        }
        sink.debug(`[${label}] still no answer (probe #${failures}).`);
        return { transition: 'repeat-down', level: 'debug', failures };
      }
      // The event reports the state after the transition (0 failures), but the
      // line keeps how long the link was down — a 3-second blip and a 10-minute
      // outage should not read the same in the log.
      const outage = failures;
      failures = 0;
      if (!down) return { transition: 'steady', level: 'none', failures };
      down = false;
      sink.info(`[${label}] the computer answers again (after ${outage} failed probe${outage === 1 ? '' : 's'}).`);
      return { transition: 'came-up', level: 'info', failures };
    },
  };
}

export type BridgeWatch = ReturnType<typeof createBridgeWatch>;
