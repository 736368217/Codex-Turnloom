/**
 * 平台映射（2.2.6）：平台不是后端实体，是 `harness.kind` + 显示名。
 * 会话页头部和设备页必须用同一套映射，否则「Codex Desktop」两处写法会漂。
 */
import type { Harness } from './machinePairing';

export interface Platform {
  key: string;
  label: string;
  mark: string;
  harnesses: Harness[];
}

export const KIND_LABEL: Record<string, string> = {
  codex: 'Codex Desktop', pi: 'PI-Desktop', pidesk: 'PI-Desktop',
};
export const KIND_MARK: Record<string, string> = { codex: 'CX', pi: 'PI', pidesk: 'PI' };

/** 服务名只是显示；平台永远按 kind 分。 */
export function serviceLabel(name: string, kind: string, machineName: string): string {
  const clean = (name || '').trim();
  if (clean && clean.toLowerCase() !== (machineName || '').trim().toLowerCase()) return clean;
  return KIND_LABEL[(kind || '').toLowerCase()] || clean || '服务入口';
}

export function platformLabel(harness: Harness | undefined, machineName: string): string {
  if (!harness) return '未选择平台';
  const key = String(harness.kind || '').toLowerCase();
  return KIND_LABEL[key] || serviceLabel(harness.name, harness.kind, machineName);
}

/** 平台 = kind + 显示名映射；不按 name 猜平台。 */
export function platformsOf(harnesses: Harness[], machineName: string): Platform[] {
  const byKey = new Map<string, Platform>();
  for (const harness of harnesses) {
    const key = String(harness.kind || '').toLowerCase() || 'other';
    if (!byKey.has(key)) {
      const label = KIND_LABEL[key] || serviceLabel(harness.name, harness.kind, machineName);
      byKey.set(key, { key, label, mark: KIND_MARK[key] || label.slice(0, 2).toUpperCase(), harnesses: [] });
    }
    byKey.get(key)!.harnesses.push(harness);
  }
  return [...byKey.values()];
}
