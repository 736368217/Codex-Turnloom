/**
 * 每个会话独立的「模型 + 思考强度」偏好。
 *
 * 为什么要落盘：原版 Web 端就是按 threadId 保存 draft（含 model / effort），
 * 切回会话要恢复上次的选择；否则用户每进一个会话都得重选一次。
 * 存储用 localStore（原生 SecureStore / Web localStorage），值很小（< 200B）。
 */
import { localGet, localSet } from './localStore';

export type ThreadPrefs = {
  model?: string;
  effort?: string;
};

const PREFIX = 'threadPrefs.';

export async function readThreadPrefs(threadId: string): Promise<ThreadPrefs> {
  if (!threadId) return {};
  const raw = await localGet(PREFIX + threadId);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ThreadPrefs;
    return {
      model: typeof parsed?.model === 'string' ? parsed.model : undefined,
      effort: typeof parsed?.effort === 'string' ? parsed.effort : undefined,
    };
  } catch {
    return {};
  }
}

export async function writeThreadPrefs(threadId: string, prefs: ThreadPrefs): Promise<void> {
  if (!threadId) return;
  const next: ThreadPrefs = {};
  if (prefs.model) next.model = prefs.model;
  if (prefs.effort) next.effort = prefs.effort;
  await localSet(PREFIX + threadId, JSON.stringify(next));
}
