/**
 * Multi-machine registry (pure data, no React / no native bridge).
 *
 * The phone remembers N paired machines and exactly one active machine. The
 * value lives in the historical `turnloom.machine.v2` secure-storage slot
 * because QA harnesses seed that key; the shape carries its own version so a
 * legacy single-object value is migrated in memory on read.
 *
 * Nothing here performs I/O: sessionStore owns secure storage and request
 * isolation, this module owns ordering, validation and the active pointer.
 */

import { normalizeBaseUrl, type Harness } from './machinePairing.ts';
import { platformsOf } from './platforms.ts';

export const REGISTRY_VERSION = 3;
export const MAX_MACHINES = 12;

export interface PersistedMachine {
  machineId: string;
  machineName: string;
  serverUrl: string;
  machineToken: string;
  harnesses: Harness[];
  defaultHarnessId: string;
  /**
   * True only when the user picked this harness themselves (device page).
   * PI-first is a rule, not a choice: keeping this false lets the rule decide
   * again when the desktop gains or loses a PI harness. Absent in every
   * registry written before 2.4.2 — that is what the one-time migration keys on.
   */
  harnessExplicit?: boolean;
  /** Epoch ms of the last successful activation; used only for ordering/UI. */
  lastUsedAt?: number;
}

/** What the persisted machine knows about the phone-side harness choice. */
export interface HarnessChoice {
  /** The user picked this harness on the device page; it outranks every rule. */
  explicit?: boolean;
  /** Persisted choice: honored when explicit, ignored when the rule decides. */
  preferredId?: string;
}

export interface HarnessSelection {
  harnessId: string;
  /** Whether the selection is (still) the user's own pick, or a rule fallback. */
  explicit: boolean;
}

export interface MachineRegistry {
  version: typeof REGISTRY_VERSION;
  activeMachineId: string;
  machines: PersistedMachine[];
}

export interface MachineSummary {
  /** Stable registry key: machineId when the server reported one, else its origin. */
  id: string;
  name: string;
  host: string;
  active: boolean;
  harnessCount: number;
  /** Last discovery's platform marks (CX/PI); non-active machines show these too. */
  platforms: { key: string; label: string; mark: string }[];
  lastUsedAt: number | null;
}

/** machineId can be empty for manual pairings; the origin then identifies the machine. */
export function machineKey(machine: Pick<PersistedMachine, 'machineId' | 'serverUrl'>): string {
  const id = String(machine.machineId || '').trim();
  return id || String(machine.serverUrl || '').trim();
}

export function hostOf(serverUrl: string): string {
  try { return new URL(serverUrl).host || ''; } catch { return ''; }
}

function cleanHarness(item: unknown): Harness | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const token = typeof row.token === 'string' ? row.token.trim() : '';
  if (!id || !name || !token) return null;
  return {
    id,
    name,
    token,
    kind: typeof row.kind === 'string' ? row.kind.trim() : '',
    defaultHarness: row.defaultHarness === true,
    online: typeof row.online === 'boolean' ? row.online : null,
  };
}

/** Desktop kinds that mean PI-Desktop; `pidesk` is PI-Desktop's historical id. */
export function isPiKind(kind: string): boolean {
  const key = String(kind || '').trim().toLowerCase();
  return key === 'pi' || key === 'pidesk';
}

/**
 * The one harness-preference rule for every path (pairing, cold start,
 * foreground retry, 401 self-heal):
 *
 *   explicit user choice > PI > the desktop's own default > first discovered
 *
 * `preferredId` only matters when the choice is explicit. A rule-selected
 * default is recomputed on every read so a newly added PI harness wins without
 * the user re-pairing, while an explicit Codex pick stays put.
 */
export function preferredHarnessId(harnesses: Harness[], choice: HarnessChoice = {}): string {
  if (!harnesses.length) return '';
  const requested = String(choice.preferredId || '').trim();
  const preferred = requested ? harnesses.find((item) => item.id === requested) : undefined;
  if (choice.explicit === true && preferred) return preferred.id;
  const pi = harnesses.find((item) => isPiKind(item.kind));
  if (pi) return pi.id;
  const desktopDefault = harnesses.find((item) => item.defaultHarness);
  return (desktopDefault || harnesses[0]).id;
}

/**
 * Whether `harnessId` is still the user's own pick. An explicit harness that
 * disappeared from discovery, or a 401 self-heal that had to fall back, must be
 * recorded as a rule choice (false) — a fallback wearing the user's name would
 * freeze it forever.
 */
export function explicitAfterFallback(choice: HarnessChoice, harnessId: string): boolean {
  const requested = String(choice.preferredId || '').trim();
  return choice.explicit === true && Boolean(requested) && harnessId === requested;
}

/** Resolve the rule and say whether the result is still the user's own pick. */
export function selectHarness(harnesses: Harness[], choice: HarnessChoice = {}): HarnessSelection {
  const harnessId = preferredHarnessId(harnesses, choice);
  return { harnessId, explicit: explicitAfterFallback(choice, harnessId) };
}

/**
 * 401 self-heal probe order: the rule's first pick, then every other saved
 * harness in discovery order. A dead first pick must not stop recovery.
 */
export function harnessProbeOrder(harnesses: Harness[], choice: HarnessChoice = {}): Harness[] {
  const head = harnesses.find((item) => item.id === preferredHarnessId(harnesses, choice));
  if (!head) return harnesses.slice();
  return [head, ...harnesses.filter((item) => item !== head)];
}

/**
 * The cold-start / foreground revalidation transform: a fresh discovery
 * replaces the harness list and must not silently replace the phone-side
 * choice — re-resolve it with the same rule and carry the honest flag.
 * Pure on purpose: 「显式 codex → 重校验后仍是 codex」是单测，不是手工。
 */
export function applyHarnessChoice(machine: PersistedMachine, harnesses: Harness[]): PersistedMachine {
  const choice = selectHarness(harnesses, {
    explicit: machine.harnessExplicit === true,
    preferredId: machine.defaultHarnessId,
  });
  return { ...machine, harnesses, defaultHarnessId: choice.harnessId, harnessExplicit: choice.explicit };
}

/** Validate one persisted machine; anything unusable is dropped rather than trusted. */
export function normalizeMachine(value: unknown): PersistedMachine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const serverUrl = normalizeBaseUrl(String(row.serverUrl || ''));
  const machineToken = typeof row.machineToken === 'string' ? row.machineToken.trim() : '';
  if (!serverUrl || !machineToken) return null;
  const rawHarnesses = Array.isArray(row.harnesses) ? row.harnesses : [];
  const harnesses = rawHarnesses.map(cleanHarness).filter((item): item is Harness => item !== null);
  if (harnesses.length === 0) return null;
  const requestedDefault = typeof row.defaultHarnessId === 'string' ? row.defaultHarnessId.trim() : '';
  // A registry written before 2.4.2 has no `harnessExplicit`. Migrate it once:
  // a PI harness takes over (PI-first is the new rule), otherwise keep whatever
  // default was working — never swap a live Codex for nothing. The field is
  // always serialized afterwards, so the migration cannot run twice.
  const migrated = Object.prototype.hasOwnProperty.call(row, 'harnessExplicit');
  const explicit = row.harnessExplicit === true;
  let defaultHarnessId: string;
  let harnessExplicit = false;
  if (!migrated) {
    const pi = harnesses.find((item) => isPiKind(item.kind));
    const kept = harnesses.find((item) => item.id === requestedDefault);
    const desktopDefault = harnesses.find((item) => item.defaultHarness);
    defaultHarnessId = (pi || kept || desktopDefault || harnesses[0]).id;
  } else {
    // An explicit id that disappeared is no longer an explicit choice: the rule
    // picks the replacement and the flag drops back to false with it.
    const choice = selectHarness(harnesses, { explicit, preferredId: requestedDefault });
    defaultHarnessId = choice.harnessId;
    harnessExplicit = choice.explicit;
  }
  const lastUsedAt = typeof row.lastUsedAt === 'number' && Number.isFinite(row.lastUsedAt) && row.lastUsedAt > 0
    ? row.lastUsedAt
    : undefined;
  return {
    machineId: typeof row.machineId === 'string' ? row.machineId.trim() : '',
    machineName: (typeof row.machineName === 'string' && row.machineName.trim()) || '我的机器',
    serverUrl,
    machineToken,
    harnesses,
    defaultHarnessId,
    harnessExplicit,
    ...(lastUsedAt ? { lastUsedAt } : {}),
  };
}

function dedupe(machines: PersistedMachine[]): PersistedMachine[] {
  const seen = new Set<string>();
  const result: PersistedMachine[] = [];
  for (const machine of machines) {
    const key = machineKey(machine);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(machine);
  }
  return result;
}

/**
 * Parse either the registry shape or a legacy single-machine object. Returns
 * null when nothing valid is stored, so callers keep the unpaired state.
 */
export function parseRegistry(raw: string | null | undefined): MachineRegistry | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const rows = Array.isArray(body.machines) ? body.machines : [value];
  const machines = dedupe(rows.map(normalizeMachine).filter((item): item is PersistedMachine => item !== null))
    .slice(0, MAX_MACHINES);
  if (machines.length === 0) return null;
  const requestedActive = typeof body.activeMachineId === 'string' ? body.activeMachineId.trim() : '';
  const active = machines.find((item) => machineKey(item) === requestedActive);
  const byRecent = [...machines].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  return {
    version: REGISTRY_VERSION,
    activeMachineId: machineKey(active || byRecent[0] || machines[0]),
    machines,
  };
}

export function serializeRegistry(registry: MachineRegistry): string {
  return JSON.stringify({
    version: REGISTRY_VERSION,
    activeMachineId: registry.activeMachineId,
    machines: registry.machines.map((machine) => ({
      machineId: machine.machineId,
      machineName: machine.machineName,
      serverUrl: machine.serverUrl,
      machineToken: machine.machineToken,
      harnesses: machine.harnesses,
      defaultHarnessId: machine.defaultHarnessId,
      harnessExplicit: machine.harnessExplicit === true,
      ...(machine.lastUsedAt ? { lastUsedAt: machine.lastUsedAt } : {}),
    })),
  });
}

export function activeMachine(registry: MachineRegistry | null): PersistedMachine | null {
  if (!registry) return null;
  return registry.machines.find((item) => machineKey(item) === registry.activeMachineId) || registry.machines[0] || null;
}

/**
 * Insert or replace a machine and make it active. When the list is full the
 * least recently used non-active machine is evicted; the active one is kept.
 */
export function upsertMachine(
  registry: MachineRegistry | null,
  machine: PersistedMachine,
  now = Date.now(),
): MachineRegistry {
  const key = machineKey(machine);
  const base = registry ? registry.machines.slice() : [];
  const index = base.findIndex((item) => machineKey(item) === key);
  const next = { ...machine, lastUsedAt: now };
  if (index >= 0) base[index] = next;
  else base.push(next);
  let machines = dedupe(base);
  if (machines.length > MAX_MACHINES) {
    const evictable = [...machines]
      .filter((item) => machineKey(item) !== key)
      .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
    while (machines.length > MAX_MACHINES && evictable.length) {
      const victim = evictable.shift();
      if (!victim) break;
      machines = machines.filter((item) => machineKey(item) !== machineKey(victim));
    }
  }
  return { version: REGISTRY_VERSION, activeMachineId: key, machines };
}

/** Remove one machine; the newest remaining machine becomes active. */
export function removeMachine(registry: MachineRegistry, key: string): MachineRegistry {
  const machines = registry.machines.filter((item) => machineKey(item) !== key);
  if (machines.length === 0) {
    return { version: REGISTRY_VERSION, activeMachineId: '', machines: [] };
  }
  const active = machines.find((item) => machineKey(item) === registry.activeMachineId);
  const fallback = active || [...machines].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))[0];
  return { version: REGISTRY_VERSION, activeMachineId: machineKey(fallback), machines };
}

export function machineSummaries(registry: MachineRegistry | null): MachineSummary[] {
  if (!registry) return [];
  return registry.machines.map((machine) => ({
    id: machineKey(machine),
    name: machine.machineName,
    host: hostOf(machine.serverUrl),
    active: machineKey(machine) === registry.activeMachineId,
    harnessCount: machine.harnesses.length,
    platforms: platformsOf(machine.harnesses, machine.machineName).map((platform) => ({
      key: platform.key, label: platform.label, mark: platform.mark,
    })),
    lastUsedAt: machine.lastUsedAt || null,
  }));
}
