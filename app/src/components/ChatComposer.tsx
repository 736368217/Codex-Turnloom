import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Check, ChevronDown, Image as ImageIcon, Paperclip, Search, Square, X } from 'lucide-react';
import VaulSheet from './VaulSheet';
import { COLORS } from '../theme/optionATokens';
import {
  resolveTurnPreference, supportsImages, effortLabel, isRunning,
  EFFORT_LABEL,
  type ModelCatalog, type ModelCatalogEntry, type SendAttachment,
} from '../lib/chatContract';
import {
  ALL_PROVIDERS, sheetPreference, providerOptions, filterModelsByProvider,
  shortModelName, pickerTrayForResult, pickerErrorMessage,
} from '../lib/composerLogic';
import { pickAttachments, haptic } from '../lib/nativeBridge';
import {
  useComposerState, selectComposer, setComposerText, setComposerAttachments,
  removeComposerAttachment, composerStateFor, currentComposerState,
  clientRequestIdFor, saveTurnPreference,
} from '../state/composerStore';
import { getModelCatalog, getThreadStatus } from '../state/runtimeStore';
import { refreshAll } from '../state/dataStore';
import { currentRequestContext } from '../state/sessionStore';

function AttachmentTray({ attachments, onRemove }: { attachments: SendAttachment[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="tl-composer-tray" aria-label="待发送附件">
      {attachments.map((item) => (
        <div key={item.id} className="tl-composer-attachment">
          {item.kind === 'image' && item.dataUrl
            ? <img src={item.dataUrl} alt="" />
            : <Paperclip size={14} aria-hidden="true" />}
          <span className="tl-composer-attachment-name">{item.name || '附件'}</span>
          <button type="button" aria-label={`移除 ${item.name || '附件'}`} onClick={() => onRemove(item.id)}><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}

interface ModelSheetProps {
  open: boolean;
  onClose: () => void;
  catalog: ModelCatalog | null;
  selected: { model: string; effort: string };
  onSelect: (model: string, effort: string) => void;
}

/**
 * One picker for provider → search → model → effort. The effort control is a
 * sticky segmented row above the sheet edge so it stays reachable with 270+
 * real PI models; nothing is duplicated into the composer chrome.
 */
export function ModelEffortSheet({ open, onClose, catalog, selected, onSelect }: ModelSheetProps) {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState(ALL_PROVIDERS);
  const providers = providerOptions(catalog);
  const rows = filterModelsByProvider(catalog, provider, query);
  const current: ModelCatalogEntry | undefined = catalog?.models.find((entry) => entry.id === selected.model)
    || catalog?.models[0];
  const efforts = current?.efforts || [];

  // A provider that no longer exists must not leave an empty list.
  useEffect(() => {
    if (provider !== ALL_PROVIDERS && !providers.includes(provider)) setProvider(ALL_PROVIDERS);
  }, [provider, providers.join('|')]);

  return (
    <VaulSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="模型与思考强度" subtitle="筛选供应商，再选择模型与强度">
      <div className="tl-mp-providers" role="group" aria-label="供应商">
        {providers.map((name) => (
          <button key={name} type="button" className="tl-press tl-mp-provider" aria-pressed={name === provider}
            onClick={() => { haptic('selection'); setProvider(name); }}>
            {name}
          </button>
        ))}
      </div>
      <div className="tl-mp-search">
        <Search size={16} color={COLORS.labelSecondary} aria-hidden="true" />
        <input aria-label="搜索模型" type="search" value={query} placeholder="搜索模型名称或 ID"
          onChange={(event) => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}
      </div>
      <div className="tl-mp-list" role="listbox" aria-label="模型">
        {!catalog?.models.length && <p className="tl-mp-note">正在读取模型目录，或电脑端尚未提供模型列表。</p>}
        {Boolean(catalog?.models.length) && !rows.length && <p className="tl-mp-note">没有匹配的模型</p>}
        {rows.map((entry) => (
          <button key={entry.id} type="button" role="option" aria-selected={entry.id === selected.model}
            className="tl-press tl-mp-model" onClick={() => {
              const next = sheetPreference(catalog, selected, entry.id);
              haptic('selection');
              onSelect(next.model, next.effort);
            }}>
            <span className="tl-mp-model-text">
              <span className="tl-mp-model-name">{shortModelName(entry)}</span>
              <span className="tl-mp-model-meta">{entry.id}{entry.supportsImages === false ? ' · 仅文字' : ''}</span>
            </span>
            {entry.id === selected.model && <Check size={18} color={COLORS.blue} />}
          </button>
        ))}
      </div>
      {current && efforts.length > 0 && (
        <div className="tl-mp-effort" role="group" aria-label={EFFORT_LABEL}>
          <div className="tl-mp-effort-label">{EFFORT_LABEL}</div>
          <div className="tl-mp-segment">
            {efforts.map((level) => (
              <button key={level} type="button" aria-pressed={level === selected.effort}
                onClick={() => { haptic('selection'); onSelect(current.id, level); }}>
                {effortLabel(level)}
              </button>
            ))}
          </div>
        </div>
      )}
    </VaulSheet>
  );
}

/** Shared chat/new-task inputs; attachment tray lives in the remount-safe store. */
export function useComposerFields(scope: string, threadId: string, threadModel?: unknown) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(() => getModelCatalog(scope));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const composer = useComposerState();

  useEffect(() => { selectComposer(scope, threadId); }, [scope, threadId]);
  useEffect(() => {
    let cancelled = false;
    const context = currentRequestContext();
    if (context && !getModelCatalog(scope)) {
      void refreshAll(context).then(() => { if (!cancelled) setCatalog(getModelCatalog(scope)); });
    } else setCatalog(getModelCatalog(scope));
    return () => { cancelled = true; };
  }, [scope]);

  const preference = resolveTurnPreference(catalog, composer.preference, threadModel);
  const imageSupport = supportsImages(catalog, preference.model);

  const select = (model: string, effort: string): void => {
    saveTurnPreference(scope, threadId, { model, effort });
    setError('');
  };

  const pick = async (kind: 'image' | 'file'): Promise<void> => {
    // Capture origin synchronously: a foreground picker can switch thread/remount.
    const originScope = scope;
    const originThread = threadId;
    setError('');
    const result = await pickAttachments(kind);
    const selectedState = currentComposerState();
    const base = composerStateFor(originScope, originThread);
    const outcome = pickerTrayForResult({
      result, kind, originScope, originThread,
      selectedScope: selectedState.scope, selectedThread: selectedState.threadId,
      existing: base.attachments, imageSupport: supportsImages(catalog, preference.model),
    });
    if (outcome.ignored) return;
    if (outcome.error) { setError(outcome.error || pickerErrorMessage(result)); return; }
    setComposerAttachments(outcome.attachments, outcome.targetScope, outcome.targetThread);
  };

  return {
    composer, catalog, preference, imageSupport, sheetOpen, setSheetOpen,
    busy, setBusy, error, setError, select, pick, scope, threadId,
    removeAttachment: (id: string) => { removeComposerAttachment(id, scope, threadId); setError(''); },
  };
}

export type ComposerFieldsApi = ReturnType<typeof useComposerFields>;

/** Composer chrome: one card, one primary action, quiet icon/text controls. */
export function ComposerFields({ fields, primary }: {
  fields: ComposerFieldsApi;
  primary: ReactNode;
}) {
  const { composer, catalog, preference, imageSupport, sheetOpen, setSheetOpen, error, setError, pick, removeAttachment, select } = fields;
  const entry = catalog?.models.find((row) => row.id === preference.model);
  const name = shortModelName(entry) || '选择模型';
  const effort = effortLabel(preference.effort);
  const stateLabel = `${name}${effort ? ` · ${effort}` : ''}`;
  return (
    <>
      <div className="tl-composer-card">
        <textarea className="tl-composer-input tl-selectable" aria-label="消息" placeholder="发送消息…" rows={1} value={composer.text}
          onChange={(event) => { setComposerText(event.target.value); fields.setError(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              const form = event.currentTarget.closest('form');
              if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
            }
          }} enterKeyHint="send" />
        <AttachmentTray attachments={composer.attachments} onRemove={removeAttachment} />
        <div className="tl-composer-tools">
          <button type="button" className="tl-press tl-model-trigger" aria-label={`模型与思考强度：${stateLabel}`}
            aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
            <span className="tl-model-trigger-name">{name}</span>
            {effort && <span className="tl-model-trigger-effort">{effort}</span>}
            <ChevronDown size={13} color={COLORS.labelSecondary} aria-hidden="true" />
          </button>
          <button type="button" className="tl-press tl-composer-icon" aria-label="图片" title="图片"
            onClick={() => {
              // Explain a known text-only model before opening the native picker.
              if (imageSupport === false) {
                setError('当前模型仅支持文字，请先切换支持图片的模型。');
                return;
              }
              haptic('selection'); void pick('image');
            }}><ImageIcon size={18} /></button>
          <button type="button" className="tl-press tl-composer-icon" aria-label="附件" title="附件"
            onClick={() => { haptic('selection'); void pick('file'); }}><Paperclip size={18} /></button>
          <span className="tl-composer-spacer" />
          {primary}
        </div>
      </div>
      {error && <div role="alert" className="tl-composer-error">{error}</div>}
      <ModelEffortSheet open={sheetOpen} onClose={() => setSheetOpen(false)} catalog={catalog} selected={preference}
        onSelect={(model, effortValue) => select(model, effortValue)} />
    </>
  );
}

/** ONE primary action: SEND when idle, STOP only for an authoritative running turn. */
export function ChatPrimaryButton({ scope, threadId, fields }: {
  scope: string;
  threadId: string;
  fields: ComposerFieldsApi;
}) {
  const running = isRunning(getThreadStatus(scope, threadId));
  const hasInput = Boolean(fields.composer.text.trim() || fields.composer.attachments.length);
  return (
    <button type="submit" aria-label={running ? '停止' : '发送'} title={running ? '停止' : '发送'}
      className={`tl-press tl-composer-send${running ? ' tl-composer-send--stop' : ''}`}
      disabled={!running && (!hasInput || fields.busy)}>
      {running ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} strokeWidth={2.4} />}
    </button>
  );
}

/** Stable retry ID for byte-identical user input. */
export function requestIdForIdentity(identity: string): string {
  return clientRequestIdFor(identity);
}

export function preventComposerSubmit(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
}
