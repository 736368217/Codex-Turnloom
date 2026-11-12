/**
 * Pure helpers for the v2 "one machine, one QR" connection flow.
 *
 * This is the TypeScript mirror of shared/machine-pairing.cjs. It is strict:
 * only canonical codex-turnloom://pair/add?v=2&... payloads are accepted, the
 * discovery response is validated in full, and no credential is included in a
 * returned error string. No React, DOM or bridge imports: the module can be
 * exercised by Node-based pure tests after a TypeScript build.
 */

export const PAIRING_PROTOCOL = 'codex-turnloom';
export const PAIRING_VERSION = 2;
export const DISCOVER_PATH = '/api/harnesses';
export const MAX_TOKEN_LENGTH = 256;
export const MAX_NAME_LENGTH = 120;
export const QR_PREFIX = `${PAIRING_PROTOCOL}://pair/add`;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const REQUIRED_QR_PARAMS = ['v', 'protocol', 'machine', 'url', 'token', 'discover'] as const;
const OPTIONAL_QR_PARAMS = ['mid', 'name'] as const;
const QR_PARAMS = new Set<string>([...REQUIRED_QR_PARAMS, ...OPTIONAL_QR_PARAMS]);

export interface MachinePairing {
  protocol: typeof PAIRING_PROTOCOL;
  version: typeof PAIRING_VERSION;
  /** QR includes a known machineId; manual pairing learns it from discovery. */
  source: 'qr' | 'manual';
  machineId: string;
  machineName: string;
  serverUrl: string;
  machineToken: string;
  discoverPath: typeof DISCOVER_PATH;
}

export interface Harness {
  id: string;
  name: string;
  token: string;
  kind: string;
  defaultHarness: boolean;
  online: boolean | null;
}

export interface Machine {
  machineId: string;
  machineName: string;
  harnesses: Harness[];
  defaultHarnessId: string;
}

export interface PairingFailure { ok: false; code: string; error: string }
export type PairingResult = { ok: true; value: MachinePairing } | PairingFailure;
export type DiscoveryResult = { ok: true; machine: Machine } | PairingFailure;
export type ManualPairingResult = PairingResult;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fail(code: string, error: string): PairingFailure {
  return { ok: false, code, error };
}

/** Normalize a user-entered or QR-supplied server address to an http(s) origin. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = clean(raw).replace(/\/+$/, '');
  if (!trimmed || CONTROL_CHARS.test(trimmed)) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return '';
  const bare = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(trimmed);
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : bare ? `http://${trimmed}` : '';
  if (!withScheme) return '';
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.pathname !== '/' && url.pathname !== '') return '';
    return url.origin.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function safeHarnessId(raw: unknown, fallback: string): string {
  return clean(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || fallback;
}

function normalizeHarnesses(list: unknown, defaultHarnessId: unknown): Harness[] {
  if (!Array.isArray(list) || list.length === 0 || list.length > 24) throw new Error('服务返回的服务列表无效');
  const usedIds = new Set<string>();
  const usedTokens = new Set<string>();
  const result: Harness[] = [];
  for (const [index, row] of list.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('服务返回的服务条目无效');
    const record = row as Record<string, unknown>;
    const token = clean(record.token);
    if (!token || token.length > MAX_TOKEN_LENGTH || CONTROL_CHARS.test(token) || usedTokens.has(token)) {
      throw new Error('服务返回的服务访问码无效');
    }
    usedTokens.add(token);
    const candidate = safeHarnessId(record.id ?? record.key ?? record.name, `harness-${index + 1}`);
    let id = candidate;
    let suffix = index + 1;
    while (usedIds.has(id)) id = `${candidate}-${suffix++}`;
    usedIds.add(id);
    const name = clean(record.name) || clean(record.label) || clean(record.key) || id;
    const kind = clean(record.kind) || clean(record.backend) || 'codex';
    if (CONTROL_CHARS.test(name) || CONTROL_CHARS.test(kind)) throw new Error('服务返回的服务字段无效');
    const onlineValue = record.online;
    if (onlineValue !== undefined && onlineValue !== null && typeof onlineValue !== 'boolean') {
      throw new Error('服务返回的服务状态无效');
    }
    result.push({
      id,
      name: name.slice(0, 80),
      token,
      kind: kind.slice(0, 40),
      defaultHarness: record.defaultHarness === true,
      online: typeof onlineValue === 'boolean' ? onlineValue : null,
    });
  }
  let selected: Harness | undefined;
  if (defaultHarnessId !== undefined && defaultHarnessId !== null) {
    if (typeof defaultHarnessId !== 'string' || !defaultHarnessId.trim()) throw new Error('默认服务标识无效');
    selected = result.find((item) => item.id === defaultHarnessId.trim());
    if (!selected) throw new Error('默认服务不在列表中');
  } else {
    selected = result.find((item) => item.defaultHarness) || result[0];
  }
  for (const item of result) item.defaultHarness = item === selected;
  return result;
}

/** Parse the canonical v2 machine QR only. Legacy/QR-as-login URLs are rejected. */
export function parseMachinePairingPayload(raw: string): PairingResult {
  const value = clean(raw);
  if (!value) return fail('empty', '扫码结果为空，请重新扫描机器配对码');
  if (value.length > 2048 || CONTROL_CHARS.test(value)) return fail('invalid-qr', '二维码格式无法识别');
  const lowered = value.replace(/^([A-Za-z][A-Za-z0-9+.-]*):/, (match) => match.toLowerCase());
  if (!lowered.startsWith(`${QR_PREFIX}?`)) return fail('invalid-qr', '这不是机器配对码，请扫描桌面端的一机一码');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('invalid-qr', '二维码内容不是有效的配对地址');
  }
  if (url.protocol !== `${PAIRING_PROTOCOL}:` || url.host !== 'pair' || url.pathname !== '/add') {
    return fail('invalid-scheme', '配对码协议或操作类型不受支持');
  }
  if (url.username || url.password || url.hash) return fail('invalid-qr', '配对码包含不允许的身份信息或片段');
  for (const key of url.searchParams.keys()) {
    if (!QR_PARAMS.has(key)) return fail('unknown-parameter', '配对码包含未知参数');
    if (url.searchParams.getAll(key).length !== 1) return fail('duplicate-parameter', '配对码参数重复');
  }
  for (const key of REQUIRED_QR_PARAMS) {
    if (!url.searchParams.has(key)) return fail('missing-parameter', '配对码缺少必要参数');
  }
  if (url.searchParams.get('v') !== String(PAIRING_VERSION)) return fail('unsupported-version', `仅支持 v${PAIRING_VERSION} 一机一码协议`);
  if (url.searchParams.get('protocol') !== PAIRING_PROTOCOL) return fail('invalid-protocol', '配对协议标识无效');
  if (url.searchParams.get('discover') !== DISCOVER_PATH) return fail('invalid-discover', '配对码的发现接口无效');
  const serverUrl = normalizeBaseUrl(url.searchParams.get('url') || '');
  if (!serverUrl) return fail('invalid-server-url', '配对码缺少有效的服务根地址');
  const token = clean(url.searchParams.get('token'));
  if (!token || token.length > MAX_TOKEN_LENGTH || CONTROL_CHARS.test(token)) return fail('invalid-token', '配对码缺少有效的机器访问码');
  const machine = url.searchParams.get('machine') || '';
  const mid = url.searchParams.get('mid');
  if (!machine || machine.length > MAX_NAME_LENGTH || CONTROL_CHARS.test(machine)) return fail('invalid-machine', '机器名称无效');
  if (mid !== null && (mid.length > MAX_NAME_LENGTH || CONTROL_CHARS.test(mid))) return fail('invalid-machine', '机器标识无效');
  return {
    ok: true,
    value: {
      protocol: PAIRING_PROTOCOL,
      version: PAIRING_VERSION,
      source: 'qr',
      machineId: clean(mid) || clean(machine),
      machineName: clean(machine),
      serverUrl,
      machineToken: token,
      discoverPath: DISCOVER_PATH,
    },
  };
}

/** Manual URL + machine access code uses exactly the same discovery contract. */
export function manualPairing(serverUrlRaw: string, machineTokenRaw: string, machineNameRaw = ''): ManualPairingResult {
  const serverUrl = normalizeBaseUrl(serverUrlRaw);
  const machineToken = clean(machineTokenRaw);
  const machineName = clean(machineNameRaw) || '我的机器';
  if (!serverUrl) return fail('invalid-server-url', '请输入完整的服务根地址，例如 http://192.168.1.10:8787');
  if (!machineToken || machineToken.length > MAX_TOKEN_LENGTH || CONTROL_CHARS.test(machineToken)) {
    return fail('invalid-token', '请输入桌面端显示的机器访问码');
  }
  if (machineName.length > MAX_NAME_LENGTH || CONTROL_CHARS.test(machineName)) return fail('invalid-machine', '机器名称无效');
  return {
    ok: true,
    value: {
      protocol: PAIRING_PROTOCOL,
      version: PAIRING_VERSION,
      source: 'manual',
      machineId: '',
      machineName,
      serverUrl,
      machineToken,
      discoverPath: DISCOVER_PATH,
    },
  };
}

/** Validate discovery before any credential or harness list is persisted. */
export function normalizeDiscovery(payload: unknown, pairing: MachinePairing): DiscoveryResult {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  if (!pairing?.serverUrl || !pairing.machineToken) return fail('missing-pairing', '缺少机器配对上下文');
  if (body.ok !== true) return fail('invalid-response', '服务未返回有效的发现结果');
  if (body.protocol !== PAIRING_PROTOCOL) return fail('invalid-protocol', '服务端不支持一机一码协议 v2');
  if (body.version !== PAIRING_VERSION) return fail('unsupported-version', `服务端协议版本不是 v${PAIRING_VERSION}`);
  if (typeof body.machineId !== 'string' || !body.machineId.trim()) return fail('invalid-machine', '服务端未返回机器标识');
  const discoveredId = body.machineId.trim();
  if (discoveredId.length > MAX_NAME_LENGTH || CONTROL_CHARS.test(discoveredId)) return fail('invalid-machine', '服务端未返回有效的机器标识');
  if (pairing.source === 'qr' && discoveredId !== clean(pairing.machineId)) {
    return fail('machine-mismatch', '服务端返回的机器身份与配对码不一致');
  }
  if (body.machineName !== undefined && (typeof body.machineName !== 'string' || CONTROL_CHARS.test(body.machineName))) {
    return fail('invalid-machine', '服务端返回的机器名称无效');
  }
  if (body.defaultHarnessId !== undefined && body.defaultHarnessId !== null && typeof body.defaultHarnessId !== 'string') {
    return fail('invalid-default', '服务端返回的默认服务无效');
  }
  let harnesses: Harness[];
  try {
    harnesses = normalizeHarnesses(body.harnesses, body.defaultHarnessId ?? null);
  } catch (error) {
    return fail('invalid-harnesses', error instanceof Error ? error.message : '服务列表无效');
  }
  if (harnesses.length > 1 && harnesses.some((item) => item.token === clean(pairing.machineToken))) {
    return fail('machine-token-reuse', '多服务模式下机器访问码不能同时作为服务访问码');
  }
  const selected = harnesses.find((item) => item.defaultHarness) || harnesses[0];
  return {
    ok: true,
    machine: {
      machineId: discoveredId,
      machineName: clean(body.machineName) || pairing.machineName || discoveredId,
      harnesses,
      defaultHarnessId: selected.id,
    },
  };
}

/** Short, actionable Chinese copy for transport/discovery failures. */
export function connectionErrorMessage(status: number, error: string): string {
  const code = clean(error).toLowerCase();
  if (code === 'tls_error') return '无法验证电脑的 HTTPS 证书，请检查服务证书或使用同一局域网的地址。';
  if (code === 'http_origin_not_paired' || code === 'cleartext_blocked_by_policy') return '此地址未获得局域网连接许可，请重新输入电脑配对页上的地址。';
  if (status === 502 || status === 503 || status === 504) return '电脑上的服务暂时不可用，请稍后重试或选择其他服务。';
  if (status === 0 || code === 'offline' || code === 'timeout') {
    return '连不上这台机器。请确认手机与电脑在同一网络、服务已启动，然后重试。';
  }
  if (status === 401 || code.includes('token') || code.includes('unauthorized')) {
    return '机器访问码不正确或已更换。请在电脑端查看最新的机器访问码后重试。';
  }
  if (status === 429) return '尝试次数过多，请稍等片刻再连接。';
  if (code.includes('machine-token-requires-discovery')) return '机器访问码只能用于发现服务，请使用发现到的服务重新连接。';
  if (code.includes('harness') || status === 502) return '电脑上的服务暂时不可用，请检查桌面端服务状态后重试。';
  if (code === 'invalid-response' || code.startsWith('invalid-') || code.startsWith('machine-') || code === 'unsupported-version') {
    return `连接校验未通过：${clean(error)}。请确认桌面端已升级到支持一机一码的版本。`;
  }
  if (status === 404) return '未找到所需服务，请确认桌面端已升级到最新版本后重试。';
  if (status >= 500) return '电脑端服务返回了错误，请检查桌面端状态后重试。';
  return clean(error) || '连接未通过验证，请检查地址与访问码后重试。';
}

export function redactSecrets(value: unknown): string {
  const seen = new Set<unknown>();
  function walk(node: unknown): unknown {
    if (node === null || typeof node !== 'object') return node;
    if (seen.has(node)) return '[circular]';
    seen.add(node);
    if (Array.isArray(node)) return node.map(walk);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (/^(token|machineToken|accessCode|payload|headers)$/i.test(key)) out[key] = '***';
      else if (/^(url|serverUrl)$/i.test(key) && typeof child === 'string' && /token|login|accessCode/i.test(child)) out[key] = '***';
      else out[key] = walk(child);
    }
    return out;
  }
  try {
    return JSON.stringify(walk(value));
  } catch {
    return '';
  }
}
