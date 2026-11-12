/**
 * Update eligibility and download URL rules.
 *
 * Pure helpers shared by the Settings screen and cold foreground check.
 * Unknown/unavailable/bad metadata never becomes "已是最新版本".
 */

import { normalizeBaseUrl } from './machinePairing';
import type { AppUpdateInfo } from './turnloomApi';

export interface InstalledApp {
  versionCode: number;
  packageName: string;
}

export type UpdateCheckState = 'checking' | 'available' | 'current' | 'unavailable' | 'error';

export interface UpdateAssessment {
  state: UpdateCheckState;
  release: AppUpdateInfo | null;
  message: string;
  downloadUrl: string;
}

const SHA256_RE = /^[0-9a-f]{64}$/i;
const EXPECTED_PACKAGE = 'com.codex.turnloom.app';

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
  if (!versionCode || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(versionName)) return { ok: false, error: '更新包版本信息不完整' };
  if (!/^\/api\/apk$/.test(apkUrl) || !SHA256_RE.test(sha256) || !sizeBytes) {
    return { ok: false, error: '更新包校验信息不完整' };
  }
  return {
    ok: true,
    release: { available: true, packageName, versionCode, versionName, apkUrl, sha256, sizeBytes, notes },
  };
}

export function assessUpdate(payload: unknown, installed: InstalledApp): UpdateAssessment {
  const validated = validateAppUpdate(payload);
  if (!validated.ok) return { state: 'error', release: null, message: validated.error, downloadUrl: '' };
  const release = validated.release;
  if (installed.packageName !== release.packageName) {
    return { state: 'error', release: null, message: '更新包与当前应用不匹配', downloadUrl: '' };
  }
  if (!release.available) {
    return { state: 'unavailable', release: null, message: '这台机器暂时没有可用的安装包', downloadUrl: '' };
  }
  if (release.versionCode <= installed.versionCode) {
    return {
      state: 'current',
      release,
      message: `当前已是 ${release.versionName}，无需更新`,
      downloadUrl: '',
    };
  }
  return {
    state: 'available',
    release,
    message: `发现新版本 ${release.versionName}${release.notes ? `：${release.notes}` : ''}`,
    downloadUrl: '',
  };
}

/** Absolute APK URL uses the configured origin; token is sent only as a header. */
export function absoluteApkUrl(origin: string, apkPath: string, downloadUrl = ''): string {
  const base = normalizeBaseUrl(origin);
  const path = downloadUrl || apkPath;
  if (!base || !/^\/api\/apk$/.test(path)) return '';
  return `${base}${path}`;
}
