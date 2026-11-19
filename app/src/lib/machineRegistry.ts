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

export const REGISTRY_VERSION = 3;
export const MAX_MACHINES = 12;

export interface PersistedMachine {
  machineId: string;
  machineName: string;
  serverUrl: string;
  machineToken: string;
  harnesses: Harness[];
  defaultHarnessId: string;
  /** Epoch ms of the last successful activation; used only for ordering/UI. */
  lastUsedAt?: number;
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
  const defaultHarnessId = harnesses.some((item) => item.id === requestedDefault)
    ? requestedDefault
    : (harnesses.find((item) => item.defaultHarness) || harnesses[0]).id;
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
    lastUsedAt: machine.lastUsedAt || null,
  }));
}
