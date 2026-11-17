/**
 * 会话归档（手机端）。
 *
 * 为什么放在本机：PI 的 sessions 表只有 deleted_at（删除），没有 archived 列，
 * 服务端 /api/threads 因此拿不到可靠的归档标记；Codex 侧有 threads.archived，
 * 由 threadProjection.isArchivedThread 负责识别。手机端再补一份本机归档表，
 * 让「默认看不见、可手动切换」这件事对两种后端都成立。
 *
 * 只存 thread id，不存标题：标题会变，id 不会。最多保留 2000 条，避免无限增长。
 */
const STORAGE_KEY = 'turnloom.archivedThreads.v1';
const MAX_ENTRIES = 2000;
const listeners = new Set<() => void>();
let snapshot: string[] | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(): string[] {
  if (snapshot) return snapshot;
  const store = storage();
  if (!store) {
    snapshot = [];
    return snapshot;
  }
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
    snapshot = Array.isArray(parsed)
      ? parsed.map((value) => String(value || '').trim()).filter(Boolean).slice(-MAX_ENTRIES)
      : [];
  } catch {
    snapshot = [];
  }
  return snapshot;
}

function persist(ids: string[]): void {
  snapshot = ids.slice(-MAX_ENTRIES);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* 私有模式或配额满：内存态仍然生效 */
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* 订阅者异常不能影响其它订阅者 */
    }
  }
}

export function archivedThreadIds(): string[] {
  return [...read()];
}

export function isLocallyArchived(threadId: string): boolean {
  const id = String(threadId || '').trim();
  return id ? read().includes(id) : false;
}

export function setThreadArchived(threadId: string, archived: boolean): void {
  const id = String(threadId || '').trim();
  if (!id) return;
  const current = read();
  const has = current.includes(id);
  if (archived === has) return;
  persist(archived ? [...current, id] : current.filter((value) => value !== id));
}

export function subscribeThreadArchive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 退出登录/换机器时清空本机归档表，避免把别人的会话 id 带过去。 */
export function clearThreadArchive(): void {
  persist([]);
}
