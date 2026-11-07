/**
 * Server contract types — verified against server.js and
 * docs/option-a/coordination/API_CONTRACT_VERIFIED.md.
 *
 * IMPORTANT: messages use `content`, NOT `text`; message `id` is usually null;
 * `/api/threads/:id/changes` returns ONLY `{ cursor, changed }`.
 */

export type ThreadStatus = {
  state?: 'running' | 'waiting' | 'ended' | 'unknown' | string;
  thinking?: boolean;
  interactionRequired?: boolean;
  turnId?: string | null;
  startedAtMs?: number | null;
  staleTurn?: boolean;
  statusSource?: string | null;
  queueLength?: number;
  queuedMessages?: Array<Record<string, unknown>>;
};

export type ThreadProject = {
  key?: string;
  id?: string;
  name?: string;
  native?: boolean;
} | null;

export type Thread = {
  id: string;
  title?: string;
  preview?: string;
  cwd?: string;
  updatedAtMs?: number;
  createdAtMs?: number;
  pinned?: boolean;
  source?: string;
  archived?: boolean;
  model?: string;
  project?: ThreadProject;
  status?: ThreadStatus;
};

export type ThreadsResponse = {
  threads: Thread[];
  total?: number;
  nextCursor?: string | null;
  codexHome?: string | null;
  codexHomeVersion?: string | null;
};

export type HealthResponse = {
  ok: boolean;
  authRequired?: boolean;
  allowWrite: boolean;
  backend?: { kind?: string; url?: string; profile?: string | null } | null;
  profile?: { id?: string; label?: string; backend?: string } | null;
  models?: Array<{ id: string; label?: string; efforts?: string[]; supportsImages?: boolean }>;
  defaultModel?: string;
  defaultEffort?: string;
  codexHome?: string | null;
  codexHomeVersion?: string | null;
  apkAvailable?: boolean;
  now?: string;
};

export type MessageRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'interaction'
  | 'notice'
  | 'system'
  | 'developer'
  | string;

export type Message = {
  id?: string | null;
  role: MessageRole;
  kind?: string;
  timestamp?: string | null;
  /** Server emits `content`. There is NO `text` field. */
  content?: string;
  title?: string;
  lineNumber?: number;
  turnId?: string | null;
  turnStartedAtMs?: number;
  source?: string;
  phase?: string;
  /** interaction-only fields */
  requestId?: string | null;
  approvalKind?: '' | 'command' | 'file' | 'permission' | string;
  canApprove?: boolean;
  requiresDesktopAction?: boolean;
  images?: Array<{ name?: string; url?: string; mimeType?: string; data?: string }>;
  files?: Array<{ path: string; size?: number; mimeType?: string; inline?: boolean }>;
};

export type MessagesStatus = {
  thinking?: boolean;
  turnId?: string | null;
  startedAtMs?: number | null;
  interactionRequired?: boolean;
  possibleDesktopAttention?: boolean;
  latestCompletedAtMs?: number | null;
  staleTurn?: boolean;
  state?: string;
  queueLength?: number;
  queuedMessages?: Array<Record<string, unknown>>;
};

export type MessagesResponse = {
  thread?: Thread | null;
  goal?: unknown;
  meta?: unknown;
  file?: string | null;
  size?: number;
  mtimeMs?: number;
  status?: MessagesStatus;
  messages: Message[];
  totalMessages?: number;
  truncated?: boolean;
  hasOlderMessages?: boolean;
  limit?: number;
  omittedMessages?: number;
  olderCursor?: string | null;
  hiddenMessages?: number;
};

export type ChangesResponse = {
  cursor: string;
  changed: boolean;
};

export type AccountResponse = {
  user?: { name?: string; email?: string; label?: string } | null;
  plan?: { type?: string; label?: string } | null;
  usage?: unknown;
  codexHome?: string | null;
  codexHomeVersion?: string | null;
};

export type Project = {
  id: string;
  name: string;
  root?: string;
  threadCount?: number;
};

export type ProjectsResponse = {
  projects: Project[];
};

export type SendMode = 'start' | 'queue' | 'steer';

export type SendResult = {
  ok?: boolean;
  threadId?: string | null;
  turnId?: string | null;
  mode?: string;
  newThread?: boolean;
  queued?: boolean;
  uncertain?: boolean;
  sent?: boolean;
  sentAt?: string;
  draft?: boolean;
};

export type NewThreadResult = {
  ok: boolean;
  mode?: string;
  draft?: boolean;
  threadId?: string | null;
  createdAt?: string;
};

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline';

export type ApprovalResult = {
  ok?: boolean;
  mode?: string;
  threadId?: string;
  requestId?: string;
  decision?: string;
  approvalKind?: string;
  decidedAt?: string;
};

export type HostDiffFile = {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
};

/** Verified client-side convention for `GET /api/host/diff` (public/app.js:5374-5400). */
export type HostDiffResponse = {
  repo?: string | null;
  clean?: boolean;
  files?: HostDiffFile[];
  diff?: string;
  patch?: string;
  payload?: { diff?: string; patch?: string; repo?: string; clean?: boolean; files?: HostDiffFile[] };
  error?: string;
};

/** `public/threads.js` threadStatusKind(): waiting / running / stale / ended / unknown. */
export type ThreadStatusKind = 'waiting' | 'running' | 'stale' | 'ended' | 'unknown';

export function threadStatusKind(status?: ThreadStatus | null): ThreadStatusKind {
  const value = status || {};
  if (value.interactionRequired) return 'waiting';
  if (value.thinking) return value.staleTurn ? 'stale' : 'running';
  if (value.state === 'ended') return 'ended';
  return 'unknown';
}

/** `public/runtime.js` runningTimeLabel() — zh variant used by the native app. */
export function runningTimeLabel(status?: MessagesStatus | ThreadStatus | null, now = Date.now(), language: 'zh' | 'en' = 'zh'): string {
  const start = status?.startedAtMs;
  if (!status?.thinking || typeof start !== 'number' || !Number.isFinite(start) || start <= 0) return '';
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return language === 'en'
    ? `Running ${minutes}m ${seconds % 60}s`
    : `已运行 ${minutes}分${seconds % 60}秒`;
}

/** Only real, server-supplied interaction rows are approvable. */
export function approvableMessages(messages: Message[]): Message[] {
  return messages.filter(
    (message) =>
      message.role === 'interaction' && Boolean(message.canApprove) && Boolean(message.requestId)
  );
}
