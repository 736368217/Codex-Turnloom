/**
 * A tiny, bounded phone-side diagnostic log.
 *
 * The first image-send failure left nothing behind: the phone kept no record of
 * the 400 body, the byte count, or the timeout. This module keeps the last 200
 * redacted records in secure storage and uploads them to the paired host
 * (`POST /api/diagnostics`) after the next successful send, so the host's
 * `logs/phone/<machine>-<date>.jsonl` explains what the phone saw.
 *
 * Nothing here may carry message text, tokens, or file contents.
 */

import { secureGet, secureSet } from './nativeBridge';
import { postDiagnostics, type ApiResult, type RequestContext } from './turnloomApi';
import { sessionStore } from '../state/sessionStore';
import { APP_IDENTITY } from '../theme/optionATokens';

export const DIAGNOSTICS_KEY = 'turnloom.diagnostics.v1';
export const MAX_DIAGNOSTIC_RECORDS = 200;
export const MAX_DIAGNOSTIC_MESSAGE = 300;

export type DiagnosticKind = 'send' | 'timeout' | 'auth' | 'compress' | 'other';

export interface DiagnosticRecord {
  at: string;
  kind: DiagnosticKind;
  status?: number;
  code?: string;
  path?: string;
  message?: string;
  detail?: Record<string, string | number | boolean>;
}

export interface DiagnosticsPayload {
  machine: string;
  appVersion: string;
  records: DiagnosticRecord[];
}

const KINDS: DiagnosticKind[] = ['send', 'timeout', 'auth', 'compress', 'other'];

function clamp(value: unknown, max = MAX_DIAGNOSTIC_MESSAGE): string {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function detailValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const text = clamp(value, 80);
    return text || null;
  }
  return null;
}

/** Drop unknown fields, bound every string, never carry a credential. */
export function sanitizeDiagnostic(record: DiagnosticRecord): DiagnosticRecord | null {
  if (!record || typeof record !== 'object') return null;
  const kind = KINDS.includes(record.kind as DiagnosticKind) ? record.kind as DiagnosticKind : 'other';
  const message = clamp(record.message);
  if (/(?:access[_-]?token|token|authorization|bearer|password)\s*[:=]/i.test(message)) return null;
  const at = /^\d{4}-\d{2}-\d{2}T/.test(String(record.at || '')) ? String(record.at) : new Date().toISOString();
  const detail: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(record.detail || {})) {
    if (!/^[a-z][a-z0-9_.-]{0,23}$/i.test(key)) continue;
    const normalized = detailValue(value);
    if (normalized !== null) detail[key] = normalized;
  }
  return {
    at,
    kind,
    ...(Number.isFinite(Number(record.status)) ? { status: Number(record.status) } : {}),
    ...(record.code ? { code: clamp(record.code, 60) } : {}),
    ...(record.path ? { path: clamp(record.path, 120) } : {}),
    ...(message ? { message } : {}),
    ...(Object.keys(detail).length ? { detail } : {}),
  };
}

/** Keep the newest `max` records in chronological order. */
export function trimDiagnostics(records: DiagnosticRecord[], max = MAX_DIAGNOSTIC_RECORDS): DiagnosticRecord[] {
  const limit = Math.max(1, Math.min(MAX_DIAGNOSTIC_RECORDS, Math.trunc(max) || MAX_DIAGNOSTIC_RECORDS));
  return records.slice(Math.max(0, records.length - limit));
}

/** The exact body Atlas accepts: machine, version, and at most 200 records. */
export function buildDiagnosticsPayload(
  records: DiagnosticRecord[],
  machine = '',
  appVersion = '',
): DiagnosticsPayload {
  return {
    machine: clamp(machine, 64),
    appVersion: clamp(appVersion, 32),
    records: trimDiagnostics(records).map(sanitizeDiagnostic).filter((row): row is DiagnosticRecord => Boolean(row)),
  };
}

export function readDiagnostics(): DiagnosticRecord[] {
  try {
    const raw = secureGet(DIAGNOSTICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => sanitizeDiagnostic(row as DiagnosticRecord))
      .filter((row): row is DiagnosticRecord => Boolean(row));
  } catch {
    return [];
  }
}

function persist(records: DiagnosticRecord[]): void {
  try { secureSet(DIAGNOSTICS_KEY, JSON.stringify(trimDiagnostics(records))); } catch { /* best effort */ }
}

/** Append one record; called from failure paths and must never throw. */
export function recordDiagnostic(record: Omit<DiagnosticRecord, 'at'> & { at?: string }): void {
  try {
    const normalized = sanitizeDiagnostic({ ...record, at: record.at || new Date().toISOString() });
    if (!normalized) return;
    persist([...readDiagnostics(), normalized]);
  } catch { /* diagnostics never break a send */ }
}

export function clearDiagnostics(): void {
  try { secureSet(DIAGNOSTICS_KEY, '[]'); } catch { /* best effort */ }
}

/** Upload the pending records; a failure is swallowed and never flips offline. */
export async function uploadDiagnostics(context: RequestContext | null): Promise<number> {
  if (!context) return 0;
  const records = readDiagnostics();
  if (!records.length) return 0;
  const state = sessionStore.getState();
  // 版本要报「装在这台手机上的那个」，不是构建时常量：2.2.5 出包时常量还停在
  // 2.2.4/93，于是 2.2.5 上传的每一份诊断都标着旧版本。native getAppInfo 给的
  // appVersion 才是真的，常量只做兜底。
  const payload = buildDiagnosticsPayload(records, state.machineName, state.appVersion || APP_IDENTITY.versionName);
  if (!payload.records.length) { clearDiagnostics(); return 0; }
  const result: ApiResult<{ ok?: boolean; stored?: number }> = await postDiagnostics(context, payload);
  if (result.ok) {
    clearDiagnostics();
    return payload.records.length;
  }
  return 0;
}

export const diagnostics = {
  recordDiagnostic, readDiagnostics, clearDiagnostics, uploadDiagnostics,
  sanitizeDiagnostic, trimDiagnostics, buildDiagnosticsPayload,
};
