/**
 * 会话归档（手机端）。
 *
 * 为什么放在本机：PI 的 sessions 表只有 deleted_at（删除），没有 archived 列，
 * 服务端 /api/threads 因此拿不到可靠的归档标记；Codex 侧有 threads.archived，
 * 由 threadProjection.isArchivedThread 负责识别。手机端再补一份本机归档表，
 * 让「默认看不见、可手动切换」这件事对两种后端都成立。
 *
 * 为什么 2.4.3 改走 native 槽（原来是 localStorage）：归档是关于「这台电脑上的
 * 哪个会话」的事，不是关于「页面从哪个地址加载」的事。localStorage 按页面 origin
 * 分区，所以只要 UI 是由服务端 origin 供的（浏览器里打开手机端页面、将来让壳直接
 * 加载远端 URL），同一台电脑换个入口（LAN 地址、反代域名、adb reverse 端口）就会
 * 读到一张空表——被隐藏的会话全部重新冒出来，切回去又消失。现在的 Android 壳把
 * 资源打包在 file:///android_asset，页面 origin 恒定，这个分区在壳里测不出来
 * （2026-11-26 实测：localStorage 探针跨入口存活）；改走 native 槽是为了不把这条
 * 不变量建立在「壳永远不换 origin」上。native 槽与 prefs 是同一处，不随 origin 变。
 * 旧版本留在 localStorage 里的 id 在首次读取时迁移一次，原键不删（可回退、可对账）。
 *
 * 只存 thread id，不存标题：标题会变，id 不会。最多保留 2000 条，避免无限增长。
 */
import { secureGet, secureSet } from './nativeBridge';

const STORAGE_KEY = 'turnloom.archivedThreads.v1';
const MAX_ENTRIES = 2000;
const listeners = new Set<() => void>();
let snapshot: string[] | null = null;

function normalize(parsed: unknown): string[] {
  return Array.isArray(parsed)
    ? parsed.map((value) => String(value || '').trim()).filter(Boolean).slice(-MAX_ENTRIES)
    : [];
}

/** `null` 表示这一处还没存过东西（区别于「存过，但是空表」）。 */
function parse(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalize(parsed) : null;
  } catch {
    return null;
  }
}

function legacyIds(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function read(): string[] {
  if (snapshot) return snapshot;
  const stored = parse(secureGet(STORAGE_KEY));
  if (stored) {
    snapshot = stored;
    return snapshot;
  }
  // 首次升级：把 2.4.2 及更早写在 localStorage 里的表搬过来。
  const legacy = legacyIds();
  snapshot = legacy;
  if (legacy.length) {
    try {
      secureSet(STORAGE_KEY, JSON.stringify(legacy));
    } catch {
      /* 内存态仍然生效，下次写入再试 */
    }
  }
  return snapshot;
}

function persist(ids: string[]): void {
  snapshot = ids.slice(-MAX_ENTRIES);
  try {
    secureSet(STORAGE_KEY, JSON.stringify(snapshot));
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
