/**
 * Update eligibility and download URL rules.
 *
 * Pure helpers shared by the Settings screen and cold foreground check.
 * Unknown/unavailable/bad metadata never becomes "已是最新版本".
 *
 * Two update sources exist, and only these two:
 *   1. the public R2 manifest (`https://dl.736.de5.net/turnloom/latest.json`),
 *   2. the paired computer's `/api/app/update` (fallback).
 * `tl.z736.cc.cd/api/app/update-public` is a relay of a computer, not a public
 * source, and is no longer part of this chain.
 */

import { normalizeBaseUrl } from './machinePairing';
import { isPublicUpdateUrl, PUBLIC_UPDATE_ORIGIN } from './nativeBridge';
import type { AppUpdateInfo } from './turnloomApi';

export interface InstalledApp {
  versionCode: number;
  packageName: string;
}

export type UpdateCheckState = 'checking' | 'available' | 'current' | 'unavailable' | 'error';

export interface UpdateChannelMeta {
  source: 'public' | 'server' | null;
  host: string;
}

export interface UpdateAssessment extends UpdateChannelMeta {
  state: UpdateCheckState;
  release: AppUpdateInfo | null;
  message: string;
  downloadUrl: string;
}

const SHA256_RE = /^[0-9a-f]{64}$/i;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const EXPECTED_PACKAGE = 'com.codex.turnloom.app';

/** The single public manifest this client trusts. */
export const PUBLIC_UPDATE_MANIFEST = `${PUBLIC_UPDATE_ORIGIN}/turnloom/latest.json`;
export const PUBLIC_UPDATE_HOST = 'dl.736.de5.net';

/** `/api/apk` on the paired machine, or an absolute URL on the R2 host. */
function isKnownApkUrl(url: string): boolean {
  return url === '/api/apk' || isPublicUpdateUrl(url);
}

export function validateAppUpdate(payload: unknown): { ok: true; release: AppUpdateInfo } | { ok: false; error: string } {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  if (!value) return { ok: false, error: '更新信息格式不正确' };
  const available = value.available === true;
  const packageName = typeof value.packageName === 'string' ? value.packageName : '';
  const versionName = typeof value.versionName === 'string' ? value.versionName : '';
  const apkUrl = typeof value.apkUrl === 'string' ? value.apkUrl : '';
  const sha256 = typeof value.sha256 === 'string' ? value.sha256 : '';
  const versionCode = typeof value.versionCode === 'number' && Number.isSafeInteger(value.versionCode) && value.versionCode > 0
    ? value.versionCode : 0;
  const sizeBytes = typeof value.sizeBytes === 'number' && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0
    ? value.sizeBytes : 0;
  const notes = typeof value.notes === 'string' ? value.notes.slice(0, 2000) : '';
  if (packageName !== EXPECTED_PACKAGE) return { ok: false, error: '更新包来源与当前应用不一致' };
  if (!available) {
    return {
      ok: true,
      release: { available: false, packageName, versionCode, versionName, apkUrl, sha256, sizeBytes, notes },
    };
  }
  if (!versionCode || !VERSION_RE.test(versionName)) return { ok: false, error: '更新包版本信息不完整' };
  if (!isKnownApkUrl(apkUrl) || !SHA256_RE.test(sha256) || !sizeBytes) {
    return { ok: false, error: '更新包校验信息不完整' };
  }
  return {
    ok: true,
    release: { available: true, packageName, versionCode, versionName, apkUrl, sha256, sizeBytes, notes },
  };
}

/**
 * Normalize the R2 manifest (`{version, versionCode, apk, size, sha256}`) into
 * `AppUpdateInfo`. A manifest that exists means "available": leaving `available`
 * undefined would surface the paired-machine wording "这台机器暂时没有可用的安装包".
 */
export function validatePublicManifest(
  payload: unknown,
  origin = PUBLIC_UPDATE_ORIGIN,
): { ok: true; release: AppUpdateInfo } | { ok: false; error: string } {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  if (!value) return { ok: false, error: '公网更新清单格式不正确' };
  const versionName = typeof value.version === 'string' ? value.version : '';
  const versionCode = typeof value.versionCode === 'number' && Number.isSafeInteger(value.versionCode) && value.versionCode > 0
    ? value.versionCode : 0;
  const apkKey = typeof value.apk === 'string' ? value.apk : '';
  const sha256 = typeof value.sha256 === 'string' ? value.sha256 : '';
  const sizeBytes = typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size > 0
    ? value.size : 0;
  const notes = typeof value.notes === 'string' ? value.notes.slice(0, 2000) : '';
  if (!versionCode || !VERSION_RE.test(versionName)) return { ok: false, error: '公网清单的版本信息不完整' };
  // Object keys only: never an absolute URL, never a path escape.
  if (!apkKey.startsWith('turnloom/') || apkKey.startsWith('/') || apkKey.includes('..') || apkKey.includes('\\')) {
    return { ok: false, error: '公网清单的安装包路径无效' };
  }
  const apkUrl = `${origin}/${apkKey}`;
  if (!isPublicUpdateUrl(apkUrl)) return { ok: false, error: '公网清单的安装包地址不在白名单内' };
  if (!SHA256_RE.test(sha256) || !sizeBytes) return { ok: false, error: '公网清单的校验信息不完整' };
  return {
    ok: true,
    release: {
      available: true,
      packageName: EXPECTED_PACKAGE,
      versionCode,
      versionName,
      apkUrl,
      sha256,
      sizeBytes,
      notes,
    },
  };
}

export function assessUpdate(
  payload: unknown,
  installed: InstalledApp,
  channel: UpdateChannelMeta = { source: null, host: '' },
): UpdateAssessment {
  const meta: UpdateChannelMeta = { source: channel.source, host: channel.host };
  const validated = validateAppUpdate(payload);
  if (!validated.ok) return { ...meta, state: 'error', release: null, message: validated.error, downloadUrl: '' };
  const release = validated.release;
  if (installed.packageName !== release.packageName) {
    return { ...meta, state: 'error', release: null, message: '更新包与当前应用不匹配', downloadUrl: '' };
  }
  if (!release.available) {
    return { ...meta, state: 'unavailable', release: null, message: '这台机器暂时没有可用的安装包', downloadUrl: '' };
  }
  if (release.versionCode <= installed.versionCode) {
    return {
      ...meta,
      state: 'current',
      release,
      message: `当前已是 ${release.versionName}，无需更新`,
      downloadUrl: '',
    };
  }
  return {
    ...meta,
    state: 'available',
    release,
    message: `发现新版本 ${release.versionName}${release.notes ? `：${release.notes}` : ''}`,
    downloadUrl: '',
  };
}

/** Absolute APK URL: public URLs pass through, `/api/apk` uses the paired origin. */
export function absoluteApkUrl(origin: string, apkPath: string, downloadUrl = ''): string {
  const path = downloadUrl || apkPath;
  if (isPublicUpdateUrl(path)) return path;
  const base = normalizeBaseUrl(origin);
  if (!base || path !== '/api/apk') return '';
  return `${base}${path}`;
}
