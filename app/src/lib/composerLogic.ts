/**
 * Pure composer decisions shared by ChatComposer and Node contract tests.
 * No React/JSX here: every branch can be executed without a WebView.
 */
import {
  validateAttachments, plainBase64,
  type ModelCatalog, type SendAttachment,
} from './chatContract';
import type { NativeAttachmentResult } from './nativeBridge';

/** Resolve the exact backend model ID and an effort that this model really offers. */
export function sheetPreference(
  catalog: ModelCatalog | null,
  selected: { model: string; effort: string },
  modelId: string,
  effort?: string,
): { model: string; effort: string } {
  const entry = catalog?.models.find((item) => item.id === modelId);
  if (!entry) return selected;
  const candidate = effort || (entry.id === selected.model ? selected.effort : '');
  const nextEffort = candidate && entry.efforts.includes(candidate)
    ? candidate : entry.efforts.includes(entry.defaultEffort) ? entry.defaultEffort : entry.efforts[0];
  return { model: entry.id, effort: nextEffort };
}

/** Case-insensitive search over real IDs and friendly labels; no invented rows. */
export function filterModels(catalog: ModelCatalog | null, query: string): ModelCatalog['models'] {
  const models = catalog?.models || [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return models;
  return models.filter((entry) => `${entry.id} ${entry.label}`.toLowerCase().includes(needle));
}

export const ALL_PROVIDERS = '全部';

/** Providers present in the real catalog, in first-seen order. */
export function providerOptions(catalog: ModelCatalog | null): string[] {
  const seen: string[] = [];
  for (const entry of catalog?.models || []) {
    const provider = String(entry.provider || '').trim();
    if (provider && !seen.includes(provider)) seen.push(provider);
  }
  return [ALL_PROVIDERS, ...seen];
}

/** Provider filter and text search compose; an unknown provider keeps all rows. */
export function filterModelsByProvider(
  catalog: ModelCatalog | null,
  provider: string,
  query: string,
): ModelCatalog['models'] {
  const rows = filterModels(catalog, query);
  if (!provider || provider === ALL_PROVIDERS) return rows;
  return rows.filter((entry) => entry.provider === provider);
}

/**
 * Short display name: drop a duplicated trailing provider suffix
 * ("DeepSeek V4 · 77625 free") and fall back to the ID's model segment.
 */
export function shortModelName(entry: Pick<ModelCatalog['models'][number], 'id' | 'label'> | null | undefined): string {
  if (!entry) return '';
  const label = String(entry.label || '').split(' · ')[0].trim();
  if (label) return label;
  const id = String(entry.id || '');
  const slash = id.lastIndexOf('/');
  return slash >= 0 ? id.slice(slash + 1) : id;
}

export interface PickerTrayOutcome {
  ignored: boolean;
  ok: boolean;
  error: string;
  attachments: SendAttachment[];
  targetScope: string;
  targetThread: string;
}

/**
 * A foreground picker can outlive navigation. Keep the origin scope/thread,
 * discard a late result if the selected conversation has changed, and always
 * write back to exactly the origin snapshot.
 */
export function pickerTrayForResult(input: {
  result: NativeAttachmentResult;
  kind: 'image' | 'file';
  originScope: string;
  originThread: string;
  selectedScope: string;
  selectedThread: string;
  existing: SendAttachment[];
  imageSupport: boolean | null;
}): PickerTrayOutcome {
  const base = {
    ignored: false,
    ok: false,
    error: '',
    attachments: input.existing,
    targetScope: input.originScope,
    targetThread: input.originThread,
  };
  if (input.result.status === 'cancelled') return { ...base, ignored: true };
  if (input.selectedScope !== input.originScope || input.selectedThread !== input.originThread) {
    return { ...base, ignored: true };
  }
  if (input.result.status === 'error') {
    return { ...base, error: input.result.error === 'picker-timeout' ? '选择超时，请重新打开选择器。' : '无法读取所选文件，请重试或更换文件。' };
  }
  const now = Date.now();
  const incoming: SendAttachment[] = (input.result.items || []).map((item, index) => {
    const data = plainBase64(item.dataUrl);
    return {
      id: `${input.kind}-${now}-${index}-${item.name}`,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: Number(item.sizeBytes) || Math.floor(data.length * 3 / 4),
      data,
      dataUrl: item.dataUrl,
      kind: input.kind,
    };
  });
  const validation = validateAttachments(input.existing, incoming, input.imageSupport);
  return {
    ...base,
    ok: validation.ok,
    error: validation.error,
    attachments: validation.attachments,
  };
}

export function pickerErrorMessage(result: NativeAttachmentResult): string {
  return result.status === 'error'
    ? result.error === 'picker-timeout' ? '选择超时，请重新打开选择器。' : '无法读取所选文件，请重试或更换文件。'
    : '';
}
