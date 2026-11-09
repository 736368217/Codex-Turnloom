'use strict';

const REGISTRY_KEY = 'turnloom.pairing.registry.v1';
const ITEM_PREFIX = 'turnloom.pairing.device.';
const LEGACY_KEYS = {
  serverUrl: 'turnloom.pairing.serverUrl',
  token: 'turnloom.pairing.token',
  machineName: 'turnloom.pairing.machineName',
};

/** Store the index and each credential separately to stay within Keychain item limits. */
function createTerminalStore(storage, normalizeUrl, makeId) {
  let queue = Promise.resolve();
  function exclusive(action) {
    const result = queue.then(action, action);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  function parseObject(raw, label) {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
    throw new Error(`${label}损坏，请检查本机存储`);
  }
  async function getIndex() {
    const raw = await storage.get(REGISTRY_KEY);
    if (raw !== null && raw !== undefined) {
      const value = parseObject(raw, '终端列表');
      if (value.version !== 1 || !Array.isArray(value.ids) || value.ids.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(id))) {
        throw new Error('终端列表格式无效，请检查本机存储');
      }
      if (new Set(value.ids).size !== value.ids.length || (value.activeId !== null && !value.ids.includes(value.activeId))) {
        throw new Error('终端列表状态无效，请检查本机存储');
      }
      return { version: 1, ids: [...value.ids], activeId: value.activeId };
    }
    const [serverUrl, token, machineName] = await Promise.all([
      storage.get(LEGACY_KEYS.serverUrl), storage.get(LEGACY_KEYS.token), storage.get(LEGACY_KEYS.machineName),
    ]);
    const normalized = normalizeUrl(serverUrl || '');
    if (!normalized) return { version: 1, ids: [], activeId: null };
    const migrated = { id: 'legacy', serverUrl: normalized, token: token || '', machineName: machineName || '', cacheVersion: 0 };
    await storage.set(ITEM_PREFIX + migrated.id, JSON.stringify(migrated));
    const index = { version: 1, ids: [migrated.id], activeId: migrated.id };
    await storage.set(REGISTRY_KEY, JSON.stringify(index));
    return index;
  }
  async function getItem(id) {
    const raw = await storage.get(ITEM_PREFIX + id);
    if (!raw) throw new Error('终端信息不可用，请检查本机存储');
    const entry = parseObject(raw, '终端信息');
    const serverUrl = normalizeUrl(entry.serverUrl || '');
    if (entry.id !== id || !serverUrl || typeof entry.token !== 'string' || typeof entry.machineName !== 'string') {
      throw new Error('终端信息格式无效，请检查本机存储');
    }
    const cacheVersion = Number.isSafeInteger(entry.cacheVersion) && entry.cacheVersion >= 0 ? entry.cacheVersion : 0;
    return { id, serverUrl, token: entry.token, machineName: entry.machineName, cacheVersion };
  }
  async function readInternal() {
    const index = await getIndex();
    const terminals = await Promise.all(index.ids.map(getItem));
    return { terminals, activeId: index.activeId };
  }
  return {
    read() { return exclusive(readInternal); },
    upsert(input, options = {}) {
      return exclusive(async () => {
        const normalized = normalizeUrl(input.serverUrl || '');
        if (!normalized) throw new Error('服务地址格式不正确，请检查后重试');
        const index = await getIndex();
        const id = options.id || makeId();
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error('终端标识无效');
        const exists = index.ids.includes(id);
        if (options.id && !exists) throw new Error('终端不存在或已被删除');
        if (!options.id && exists) throw new Error('终端标识冲突，请重试');
        const previous = exists ? await storage.get(ITEM_PREFIX + id) : null;
        const previousEntry = exists ? await getItem(id) : null;
        const token = String(input.token || '');
        const changedConnection = previousEntry && (previousEntry.serverUrl !== normalized || previousEntry.token !== token);
        const cacheVersion = previousEntry ? previousEntry.cacheVersion + (changedConnection ? 1 : 0) : 0;
        const entry = { id, serverUrl: normalized, token, machineName: String(input.machineName || '').trim(), cacheVersion };
        const next = { version: 1, ids: exists ? index.ids : [...index.ids, id], activeId: options.activate ? id : index.activeId };
        await storage.set(ITEM_PREFIX + id, JSON.stringify(entry));
        try {
          await storage.set(REGISTRY_KEY, JSON.stringify(next));
        } catch (error) {
          try {
            if (previous !== null && previous !== undefined) await storage.set(ITEM_PREFIX + id, previous);
            else await storage.remove(ITEM_PREFIX + id);
          } catch { throw new Error('保存终端失败，且无法恢复原配置，请检查本机存储'); }
          throw error;
        }
        return entry;
      });
    },
    activate(id) {
      return exclusive(async () => {
        const index = await getIndex();
        if (!index.ids.includes(id)) throw new Error('终端不存在或已被删除');
        const entry = await getItem(id);
        await storage.set(REGISTRY_KEY, JSON.stringify({ ...index, activeId: id }));
        return entry;
      });
    },
    remove(id) {
      return exclusive(async () => {
        const index = await getIndex();
        if (!index.ids.includes(id)) return;
        if (id === 'legacy') {
          await Promise.all(Object.values(LEGACY_KEYS).map((key) => storage.remove(key)));
        }
        const remaining = index.ids.filter((item) => item !== id);
        const next = { version: 1, ids: remaining, activeId: index.activeId === id ? (remaining[0] || null) : index.activeId };
        await storage.set(REGISTRY_KEY, JSON.stringify(next));
        try {
          await storage.remove(ITEM_PREFIX + id);
        } catch (error) {
          await storage.set(REGISTRY_KEY, JSON.stringify(index));
          throw error;
        }
      });
    },
  };
}

module.exports = { createTerminalStore, REGISTRY_KEY, ITEM_PREFIX, LEGACY_KEYS };
