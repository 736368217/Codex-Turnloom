/**
 * Pure composer decisions shared by ChatComposer and Node contract tests.
 * No React/JSX here: every branch can be executed without a WebView.
 */
import {
  validateAttachments, plainBase64, type ModelCatalog, type ModelCatalogEntry, type SendAttachment,
} from './chatContract';
import type { NativeAttachmentResult } from './nativeBridge';

export const ALL_PROVIDERS = '全部';

export interface ModelPanelRow extends ModelCatalogEntry {
  /**
   * The current selection is not in the served catalogue (removed/disabled on the
   * desktop). A status row only: it is never a selectable option.
   */
  offCatalog?: boolean;
}

/**
 * The exact rows the picker shows: the served catalogue in the host's own order,
 * plus one status row when — and only when — the current selection is no longer
 * in it. Listing the current model keeps the header chip findable in the panel
 * without ever re-introducing a full directory or a history of used models.
 */
export function panelRows(catalog: ModelCatalog | null, selectedModel: string): ModelPanelRow[] {
  const rows: ModelPanelRow[] = (catalog?.models || []).map((entry) => ({ ...entry }));
  const current = String(selectedModel || '').trim();
  // Only a loaded catalogue can tell us the selection is gone; before that the
  // panel says "reading" instead of accusing the desktop of removing anything.
  if (!current || !rows.length || rows.some((entry) => entry.id === current)) return rows;
  const slash = current.indexOf('/');
  const provider = slash > 0 ? current.slice(0, slash) : '';
  rows.unshift({
    id: current,
    // Empty label: the name is the bare model segment, not the full slug.
    label: '',
    provider,
    providerLabel: provider,
    modelId: slash >= 0 ? current.slice(slash + 1) : current,
    pinned: false,
    efforts: [],
    defaultEffort: '',
    supportsImages: null,
    offCatalog: true,
  });
  return rows;
}

/** Provider filter and text search over already-built panel rows. */
export function filterModelRows(rows: ModelPanelRow[], provider: string, query: string): ModelPanelRow[] {
  const needle = String(query || '').trim().toLowerCase();
  return rows.filter((entry) => {
    if (provider && provider !== ALL_PROVIDERS && entry.provider !== provider) return false;
    if (!needle) return true;
    return `${entry.id} ${entry.label} ${entry.providerLabel || ''} ${entry.modelId || ''}`
      .toLowerCase().includes(needle);
  });
}

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
    ? candidate : entry.efforts.includes(entry.defaultEffort) ? entry.defaultEffort : entry.efforts[0] || '';
  return { model: entry.id, effort: nextEffort };
}

/** Case-insensitive search over real IDs and friendly labels; no invented rows. */
export function filterModels(catalog: ModelCatalog | null, query: string): ModelCatalog['models'] {
  return filterModelRows(catalog?.models || [], ALL_PROVIDERS, query);
}

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
  return filterModelRows(catalog?.models || [], provider, query);
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
  kind: 'image' | 'file' | 'camera';
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
    return { ...base, error: pickerErrorMessage(input.result) };
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
      // A camera capture lands in the tray as an image attachment.
      kind: input.kind === 'file' ? 'file' : 'image',
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
  if (result.status !== 'error') return '';
  switch (result.error) {
    case 'picker-busy': return '文件选择器已打开，请先完成或取消当前选择。';
    case 'camera-permission-denied': return '没有相机权限，请在系统设置里允许后重试。';
    case 'camera-unavailable': return '这台设备打不开相机，请改用相册或附件。';
    case 'picker-unavailable': return '此设备暂时无法打开文件选择器，请稍后重试。';
    case 'bridge-not-ready': return '附件功能尚未就绪，请稍后重试。';
    case 'permission-denied': return '没有读取所选文件的权限，请重新选择。';
    case 'picker-timeout': return '选择超时，请重新打开选择器。';
    case 'too-many-files': return '一次最多选择 4 个附件，请减少数量后重试。';
    case 'file-too-large': return '单个附件不能超过 4 MB，请选择较小的文件。';
    case 'attachments-too-large': return '附件总大小不能超过 6 MB，请移除部分附件。';
    case 'invalid-mime-type': return '所选文件类型不受支持，请重新选择。';
    default: return '无法读取所选文件，请重试或更换文件。';
  }
}
