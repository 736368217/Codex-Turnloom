/**
 * Two-leg update check for 2.2.3+: the public R2 manifest first, the paired
 * computer's `/api/app/update` only as a fallback.
 *
 * The UI never inspects URLs: it reads `source`, `host`, `publicError` and the
 * state/message from one outcome, so "无需更新" can only appear after a real
 * manifest answered. A whitelist rejection keeps its own `reason` and never
 * degrades into a transport failure.
 */

import {
  PUBLIC_UPDATE_HOST, PUBLIC_UPDATE_MANIFEST, assessUpdate, validatePublicManifest,
  type InstalledApp, type UpdateAssessment,
} from './appUpdate';
import { getAppUpdate, getPublicUpdateManifest, type RequestContext } from './turnloomApi';

export type UpdateCheckReason =
  | 'ok'
  | 'public-invalid-url'
  | 'public-transport'
  | 'public-http'
  | 'public-schema'
  | 'server-invalid-url'
  | 'server-transport'
  | 'server-http'
  | 'server-schema'
  | 'not-paired';

export interface UpdateCheckOutcome extends UpdateAssessment {
  /** Human-readable reason the public leg was skipped/failed; '' when it answered. */
  publicError: string;
  reason: UpdateCheckReason;
}

export interface UpdateCheckOptions {
  installed: InstalledApp;
  /** Paired machine context, or null when the phone is not paired yet. */
  serverContext: RequestContext | null;
  /** Override for tests; defaults to the one public manifest. */
  publicUrl?: string;
}

function hostOf(origin: string): string {
  try { return new URL(origin).host; } catch { return ''; }
}

function publicFailureText(reason: UpdateCheckReason, status: number): string {
  switch (reason) {
    case 'public-invalid-url': return '公网更新地址不在允许列表内';
    case 'public-http': return `公网清单不可用（HTTP ${status}）`;
    case 'public-schema': return '公网清单格式不正确';
    default: return '公网不可达';
  }
}

export async function runUpdateCheck(options: UpdateCheckOptions): Promise<UpdateCheckOutcome> {
  const publicUrl = options.publicUrl || PUBLIC_UPDATE_MANIFEST;

  const pub = await getPublicUpdateManifest(publicUrl);
  let publicReason: UpdateCheckReason = 'ok';
  let publicError = '';

  if (pub.ok) {
    const normalized = validatePublicManifest(pub.data);
    if (normalized.ok) {
      return {
        ...assessUpdate(normalized.release, options.installed, { source: 'public', host: PUBLIC_UPDATE_HOST }),
        publicError: '',
        reason: 'ok',
      };
    }
    publicReason = 'public-schema';
    publicError = normalized.error;
  } else if (pub.error === 'invalid-public-url') {
    publicReason = 'public-invalid-url';
    publicError = publicFailureText(publicReason, 0);
  } else if (pub.offline || pub.status === 0) {
    publicReason = 'public-transport';
    publicError = publicFailureText(publicReason, 0);
  } else {
    publicReason = 'public-http';
    publicError = publicFailureText(publicReason, pub.status);
  }

  const context = options.serverContext;
  if (!context) {
    return {
      state: 'error',
      release: null,
      message: `${publicError}；尚未连接电脑，无备用更新通道`,
      downloadUrl: '',
      source: null,
      host: '',
      publicError,
      reason: 'not-paired',
    };
  }

  const host = hostOf(context.target.origin);
  const server = await getAppUpdate(context);
  if (!server.ok) {
    const reason: UpdateCheckReason = server.error === 'invalid-api-url'
      ? 'server-invalid-url'
      : (server.offline || server.status === 0 ? 'server-transport' : 'server-http');
    const text = reason === 'server-invalid-url'
      ? '电脑端更新地址无效'
      : reason === 'server-transport'
        ? '电脑端不可达'
        : `电脑端更新接口不可用（HTTP ${server.status}）`;
    return {
      state: 'error',
      release: null,
      message: `${publicError}；${text}`,
      downloadUrl: '',
      source: null,
      host,
      publicError,
      reason,
    };
  }

  const assessed = assessUpdate(server.data, options.installed, { source: 'server', host });
  return {
    ...assessed,
    publicError,
    // A schema-level rejection on the computer side is still a computer-side answer.
    reason: assessed.state === 'error' ? 'server-schema' : 'ok',
  };
}
