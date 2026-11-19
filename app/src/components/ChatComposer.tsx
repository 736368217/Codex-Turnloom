import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, AtSign, Camera, Check, ChevronDown, Image as ImageIcon, Paperclip, Pin, Search, Square, X } from 'lucide-react';
import VaulSheet from './VaulSheet';
import { titleOfThread, previewOfThread } from '../lib/threadPreview';
import { useDataState } from '../state/dataStore';
import { COLORS } from '../theme/optionATokens';
import {
  resolveTurnPreference, supportsImages, effortLabel, isRunning, sendModelFields, plainBase64,
  EFFORT_LABEL,
  type ModelCatalog, type SendAttachment,
} from '../lib/chatContract';
import {
  ALL_PROVIDERS, sheetPreference, providerOptions, panelRows, filterModelRows,
  shortModelName, pickerTrayForResult, pickerErrorMessage,
  type ModelPanelRow,
} from '../lib/composerLogic';
import { pickAttachments, haptic, type NativeAttachmentResult } from '../lib/nativeBridge';
import { compressImageForUpload } from '../lib/imageUpload';
import { shouldSubmitOnEnter } from '../lib/composerSubmit';
import {
  useComposerState, selectComposer, setComposerText, setComposerAttachments,
  removeComposerAttachment, composerStateFor, currentComposerState,
  clientRequestIdFor, saveTurnPreference,
} from '../state/composerStore';
import { getModelCatalog, getThreadStatus } from '../state/runtimeStore';
import { refreshAll } from '../state/dataStore';
import { currentRequestContext } from '../state/sessionStore';
import { getSkills, getPlugins, type SkillEntry, type PluginEntry } from '../lib/turnloomApi';

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
 * One picker for provider → search → model → effort. Rows are exactly the models
 * the desktop added (served in its own order, pinned first); the only extra row is
 * the current selection when it is no longer in that set — a disabled status row,
 * never a selectable option. No full directory, no history of used models.
 */
export function ModelEffortSheet({ open, onClose, catalog, selected, onSelect }: ModelSheetProps) {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState(ALL_PROVIDERS);
  const providers = providerOptions(catalog);
  const multiProvider = providers.length > 2;
  const rows = panelRows(catalog, selected.model);
  const visible = filterModelRows(rows, provider, query);
  const current: ModelPanelRow | undefined = rows.find((entry) => entry.id === selected.model) || rows[0];
  const efforts = current && !current.offCatalog ? current.efforts : [];
  // A three-model PI list does not need a search box; a 270-row Codex list does.
  const showSearch = rows.length > 8 || Boolean(query);
  const loaded = Boolean(catalog?.models.length);

  // A provider that no longer exists must not leave an empty list.
  useEffect(() => {
    if (provider !== ALL_PROVIDERS && !providers.includes(provider)) setProvider(ALL_PROVIDERS);
  }, [provider, providers.join('|')]);

  return (
    <VaulSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="模型"
      subtitle={loaded ? `电脑端已加入的 ${catalog?.models.length} 个模型` : '正在读取模型目录'}>
      {multiProvider && (
        <div className="tl-mp-providers" role="group" aria-label="供应商">
          {providers.map((name) => (
            <button key={name} type="button" className="tl-press tl-mp-provider" aria-pressed={name === provider}
              onClick={() => { haptic('selection'); setProvider(name); }}>
              {name}
            </button>
          ))}
        </div>
      )}
      {showSearch && (
        <div className="tl-mp-search">
          <Search size={16} color={COLORS.labelSecondary} aria-hidden="true" />
          <input aria-label="搜索模型" type="search" value={query} placeholder="搜索模型名称或 ID"
            onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}
        </div>
      )}
      <div className="tl-mp-list" role="listbox" aria-label="模型">
        {!loaded && <p className="tl-mp-note">正在读取模型目录，或电脑端尚未提供模型列表。</p>}
        {loaded && !visible.length && <p className="tl-mp-note">没有匹配的模型</p>}
        {visible.map((entry) => {
          const active = entry.id === selected.model;
          const meta = [
            entry.offCatalog ? '电脑端未加入' : '',
            multiProvider ? (entry.providerLabel || entry.provider) : '',
            !entry.offCatalog && entry.supportsImages === false ? '仅文字' : '',
          ].filter(Boolean).join(' · ');
          if (entry.offCatalog) {
            // A status row: the current conversation still runs this model, but the
            // desktop no longer offers it. It is not a choice, so it cannot be picked.
            return (
              <div key={entry.id} role="option" aria-selected={active} aria-disabled="true"
                className="tl-mp-model tl-mp-model--offcatalog">
                <span className="tl-mp-model-text">
                  <span className="tl-mp-model-name">{shortModelName(entry)}</span>
                  <span className="tl-mp-model-meta">{meta}</span>
                </span>
              </div>
            );
          }
          return (
            <button key={entry.id} type="button" role="option" aria-selected={active}
              className="tl-press tl-mp-model" onClick={() => {
                const next = sheetPreference(catalog, selected, entry.id);
                haptic('selection');
                onSelect(next.model, next.effort);
              }}>
              <span className="tl-mp-model-text">
                <span className="tl-mp-model-name">{shortModelName(entry)}</span>
                {meta && <span className="tl-mp-model-meta">{meta}</span>}
              </span>
              {entry.pinned && <span className="tl-mp-pin" title="已置顶"><Pin size={14} /></span>}
              {active && <Check size={18} color={COLORS.blue} />}
            </button>
          );
        })}
      </div>
      {current && !current.offCatalog && (
        <div className="tl-mp-effort" role="group" aria-label={EFFORT_LABEL}>
          <div className="tl-mp-effort-label">{EFFORT_LABEL}</div>
          {efforts.length > 1 ? (
            <div className="tl-mp-segment">
              {efforts.map((level) => (
                <button key={level} type="button" aria-pressed={level === selected.effort}
                  onClick={() => { haptic('selection'); onSelect(current.id, level); }}>
                  {effortLabel(level)}
                </button>
              ))}
            </div>
          ) : (
            <p className="tl-mp-effort-note">
              {efforts.length === 1
                ? `该模型仅有「${effortLabel(efforts[0])}」这一档强度`
                : '该模型不提供可调思考强度'}
            </p>
          )}
        </div>
      )}
    </VaulSheet>
  );
}

/**
 * Phone photos are 3–8 MB and the host rejects >12 MP; shrink before the tray
 * validates size so a normal camera photo is accepted instead of "4 MB max".
 */
async function shrinkPickedImages(
  result: NativeAttachmentResult,
  kind: 'image' | 'file' | 'camera',
): Promise<NativeAttachmentResult> {
  // A camera capture is an image; only a file pick skips the shrink.
  if (kind === 'file' || result.status !== 'success' || !result.items?.length) return result;
  const items: NonNullable<NativeAttachmentResult['items']> = [];
  for (const item of result.items) {
    const source: SendAttachment = {
      id: '', name: item.name, mimeType: item.mimeType, sizeBytes: item.sizeBytes,
      data: plainBase64(item.dataUrl), dataUrl: item.dataUrl, kind: 'image',
    };
    const shrunk = await compressImageForUpload(source);
    items.push({
      name: shrunk.name,
      mimeType: shrunk.mimeType,
      sizeBytes: shrunk.sizeBytes,
      dataUrl: `data:${shrunk.mimeType};base64,${shrunk.data}`,
    });
  }
  return { ...result, items };
}

/** Shared chat/new-task inputs; attachment tray lives in the remount-safe store. */
export function useComposerFields(scope: string, threadId: string, threadModel?: unknown) {  const [catalog, setCatalog] = useState<ModelCatalog | null>(() => getModelCatalog(scope));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pickingRef = useRef(false);
  const [picking, setPicking] = useState(false);
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
  // 普通发送不带 model：会话自己的模型就是它正在跑的模型，带上会让电脑端
  // 每次都走一次「切换模型」（PI 侧是 dangerous 的 session/configure，会弹原生框）。
  const send = sendModelFields({
    catalog, preference, threadModel,
    explicit: Boolean(composer.preference?.model),
  });

  const select = (model: string, effort: string): void => {
    saveTurnPreference(scope, threadId, { model, effort });
    setError('');
  };

  const pick = async (kind: 'image' | 'file' | 'camera'): Promise<void> => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    try {
      // Capture origin synchronously: a foreground picker can switch thread/remount.
      const originScope = scope;
      const originThread = threadId;
      setError('');
      const picked = await pickAttachments(kind);
      const result = await shrinkPickedImages(picked, kind);
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
    } catch {
      setError(pickerErrorMessage({ status: 'error', error: 'picker-unavailable' }));
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };

  return {
    composer, catalog, preference, send, imageSupport, sheetOpen, setSheetOpen,
    busy, setBusy, picking, error, setError, select, pick, scope, threadId,
    removeAttachment: (id: string) => { removeComposerAttachment(id, scope, threadId); setError(''); },
  };
}

export type ComposerFieldsApi = ReturnType<typeof useComposerFields>;

/** The header's model chip: current provider model + effort, one tap to the sheet. */
export function ModelChip({ fields }: { fields: ComposerFieldsApi }) {
  const { catalog, preference } = fields;
  const entry = catalog?.models.find((row) => row.id === preference.model);
  // A saved choice the desktop has since removed stays visible (never silently
  // swapped) and says so, exactly like its status row in the panel.
  const removed = Boolean(preference.model) && Boolean(catalog?.models.length) && !entry;
  const name = shortModelName(entry || { id: preference.model, label: '' }) || '选择模型';
  const effort = effortLabel(preference.effort);
  return (
    <button
      type="button"
      className="tl-press tl-header-model"
      aria-label={`模型与思考强度：${name}${removed ? '（电脑端未加入）' : ''}${effort ? ` · ${effort}` : ''}`}
      aria-haspopup="dialog"
      onClick={() => { haptic('selection'); fields.setSheetOpen(true); }}
    >
      <span className="tl-header-model-name">{name}</span>
      {removed && <span className="tl-header-model-removed">已移除</span>}
      {effort && <span className="tl-header-model-effort">{effort}</span>}
      <ChevronDown size={12} color={COLORS.labelSecondary} aria-hidden="true" />
    </button>
  );
}

/**
 * 「引用」：插入一段纯文本引用块。宿主不解析 `@thread:` 这类语法，所以这里**不是**可跳转的
 * mention——菜单标题、副标题与插入内容都按「引用一段上下文」写，不给用户「会切换会话」的暗示。
 */
function QuoteSheet({ open, onClose, onPick }: {
  open: boolean;
  onClose: () => void;
  onPick: (block: string) => void;
}) {
  const data = useDataState();
  const [tab, setTab] = useState<'thread' | 'skill' | 'plugin'>('thread');
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  // "this host does not list them" is not "this machine has none": a relay answers
  // 200 with `unavailable`/`codexHome:null`, a local host answers with a real path.
  const [skillList, setSkillList] = useState<'idle' | 'ready' | 'unavailable'>('idle');
  const [pluginList, setPluginList] = useState<'idle' | 'ready' | 'unavailable'>('idle');
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);
  const needle = query.trim().toLowerCase();

  // The menu is read-only and closes: one fetch per open is enough, cached afterwards.
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    const context = currentRequestContext();
    if (!context) return;
    setLoading(true);
    void (async () => {
      const [skillResult, pluginResult] = await Promise.all([getSkills(context), getPlugins(context)]);
      if (skillResult.ok) {
        const value = skillResult.data;
        if (Array.isArray(value)) {
          setSkills(value);
          setSkillList('ready');
        } else {
          setSkills(value.skills || []);
          setSkillList(value.unavailable || value.codexHome === null ? 'unavailable' : 'ready');
        }
      } else {
        setSkillList('unavailable');
      }
      if (pluginResult.ok) {
        const value = pluginResult.data;
        if (Array.isArray(value)) {
          setPlugins(value);
          setPluginList('ready');
        } else {
          setPlugins(value.plugins || []);
          setPluginList(value.unavailable || value.codexHome === null ? 'unavailable' : 'ready');
        }
      } else {
        setPluginList('unavailable');
      }
      setLoading(false);
    })();
  }, [open]);

  const threads = (data.threads || [])
    .map((thread) => ({ id: String(thread.id || ''), title: titleOfThread(thread), preview: previewOfThread(thread) }))
    .filter((row) => !needle || `${row.title} ${row.preview}`.toLowerCase().includes(needle))
    .slice(0, 80);
  const skillRows = skills
    .map((row) => ({ name: row.name || '', label: row.displayName || row.name || '', note: row.description || '', uri: row.uri || '' }))
    .filter((row) => !needle || `${row.label} ${row.note}`.toLowerCase().includes(needle))
    .slice(0, 200);
  const pluginRows = plugins
    .map((row) => ({ name: row.name || '', label: row.displayName || row.name || '', note: row.description || row.marketplace || '', uri: row.uri || '' }))
    .filter((row) => !needle || `${row.label} ${row.note}`.toLowerCase().includes(needle))
    .slice(0, 60);

  return (
    <VaulSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="引用上下文" subtitle="插入一段纯文本，不会跳转或切换会话">
      <div className="tl-quote-tabs" role="tablist" aria-label="引用类型">
        {([['thread', '会话'], ['skill', '技能'], ['plugin', '插件']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            className={`tl-quote-tab tl-press${tab === key ? ' is-active' : ''}`}
            onClick={() => { haptic('selection'); setTab(key); }}>
            {label}
          </button>
        ))}
      </div>
      <div className="tl-quote-search">
        <Search size={15} aria-hidden="true" />
        <input aria-label="搜索要引用的对象" type="search" value={query} placeholder={tab === 'thread' ? '搜索会话' : tab === 'skill' ? '搜索技能' : '搜索插件'}
          onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="tl-quote-list" role="listbox" aria-label="可引用的对象">
        {tab === 'thread' && threads.length === 0 && <p className="tl-quote-empty">没有可引用的会话</p>}
        {tab === 'thread' && threads.map((row) => (
          <button key={row.id} type="button" role="option" aria-selected={false} className="tl-quote-row tl-press"
            onClick={() => { haptic('selection'); onPick(`@会话 ${row.id.slice(0, 8)}「${row.title}」\n> 最近：${row.preview || '（无预览）'}\n`); }}>
            <span className="tl-quote-title">{row.title}</span>
            <span className="tl-quote-preview">{row.preview || '（无预览）'}</span>
          </button>
        ))}
        {tab === 'skill' && (loading && skillRows.length === 0
          ? <p className="tl-quote-empty">正在读取技能…</p>
          : skillRows.length === 0
            ? <p className="tl-quote-empty">{skillList === 'unavailable' ? '当前连接方式不列出技能' : '没有可引用的技能'}</p>
            : null)}
        {tab === 'skill' && skillRows.map((row) => (
          <button key={`skill-${row.name}`} type="button" role="option" aria-selected={false} className="tl-quote-row tl-press"
            onClick={() => { haptic('selection'); onPick(`@技能 ${row.label}\nuri: ${row.uri || `skill://${row.name}`}\n`); }}>
            <span className="tl-quote-title">{row.label}</span>
            <span className="tl-quote-preview">{row.note || row.uri}</span>
          </button>
        ))}
        {tab === 'plugin' && (loading && pluginRows.length === 0
          ? <p className="tl-quote-empty">正在读取插件…</p>
          : pluginRows.length === 0
            ? <p className="tl-quote-empty">{pluginList === 'unavailable' ? '当前连接方式不列出插件' : '没有可引用的插件'}</p>
            : null)}
        {tab === 'plugin' && pluginRows.map((row) => (
          <button key={`plugin-${row.name}`} type="button" role="option" aria-selected={false} className="tl-quote-row tl-press"
            onClick={() => { haptic('selection'); onPick(`@插件 ${row.label}\nuri: ${row.uri || `plugin://${row.name}`}\n`); }}>
            <span className="tl-quote-title">{row.label}</span>
            <span className="tl-quote-preview">{row.note || row.uri}</span>
          </button>
        ))}
      </div>
    </VaulSheet>
  );
}


/** Composer chrome: one card, one primary action, quiet icon/text controls. */
export function ComposerFields({ fields, primary, enterKeyHint = 'send', autoFocus = false }: {
  fields: ComposerFieldsApi;
  primary: ReactNode;
  enterKeyHint?: 'send' | 'done' | 'next';
  /** A brand-new chat focuses the input so the keyboard opens with it. */
  autoFocus?: boolean;
}) {
  const { composer, catalog, preference, imageSupport, sheetOpen, setSheetOpen, error, setError, pick, removeAttachment, select } = fields;
  // The model trigger lives in the chat header now (ModelChip); the composer keeps
  // only the textarea, the attachment row and the primary action.
  const [quoteOpen, setQuoteOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The quote block is plain text at the caret: the agent reads it as context, nothing
  // in the host turns it into a link or a conversation switch.
  const insertQuote = (block: string) => {
    const text = composer.text;
    const el = inputRef.current;
    const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : text.length;
    const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : text.length;
    const next = `${text.slice(0, start)}${block}${text.slice(end)}`;
    setComposerText(next);
    setQuoteOpen(false);
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      const caret = start + block.length;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };
  return (
    <>
      <div className="tl-composer-card">
        <textarea ref={inputRef} className="tl-composer-input tl-selectable" aria-label="消息" placeholder="发送消息…" rows={1} value={composer.text}
          autoFocus={autoFocus}
          onChange={(event) => { setComposerText(event.target.value); fields.setError(''); }}
          onKeyDown={(event) => {
            if (shouldSubmitOnEnter({
              key: event.key,
              shiftKey: event.shiftKey,
              isComposing: event.nativeEvent.isComposing,
              keyCode: event.nativeEvent.keyCode,
            })) {
              event.preventDefault();
              const form = event.currentTarget.closest('form');
              if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
            }
          }} enterKeyHint={enterKeyHint} />
        <AttachmentTray attachments={composer.attachments} onRemove={removeAttachment} />
        <div className="tl-composer-tools">
          <button type="button" className="tl-press tl-quote-trigger" aria-label="引用会话、技能或插件" title="引用"
            aria-haspopup="dialog" onClick={() => { haptic('selection'); setQuoteOpen(true); }}>
            <AtSign size={18} />
          </button>
          <button type="button" className="tl-press tl-composer-icon" aria-label="拍照" title="拍照"
            disabled={fields.picking}
            style={{ width: 44, minWidth: 44, height: 44, minHeight: 44 }}
            onClick={() => {
              if (imageSupport === false) {
                setError('当前模型仅支持文字，请先切换支持图片的模型。');
                return;
              }
              haptic('selection'); void pick('camera');
            }}><Camera size={18} /></button>
          <button type="button" className="tl-press tl-composer-icon" aria-label="图片" title="图片"
            disabled={fields.picking}
            style={{ width: 44, minWidth: 44, height: 44, minHeight: 44 }}
            onClick={() => {
              // Explain a known text-only model before opening the native picker.
              if (imageSupport === false) {
                setError('当前模型仅支持文字，请先切换支持图片的模型。');
                return;
              }
              haptic('selection'); void pick('image');
            }}><ImageIcon size={18} /></button>
          <button type="button" className="tl-press tl-composer-icon" aria-label="附件" title="附件"
            disabled={fields.picking}
            style={{ width: 44, minWidth: 44, height: 44, minHeight: 44 }}
            onClick={() => { haptic('selection'); void pick('file'); }}><Paperclip size={18} /></button>
          <span className="tl-composer-spacer" />
          {primary}
        </div>
      </div>
      {error && <div role="alert" className="tl-composer-error">{error}</div>}
      <ModelEffortSheet open={sheetOpen} onClose={() => setSheetOpen(false)} catalog={catalog} selected={preference}
        onSelect={(model, effortValue) => select(model, effortValue)} />
      <QuoteSheet open={quoteOpen} onClose={() => setQuoteOpen(false)} onPick={insertQuote} />
    </>
  );
}

function primaryStyle(): CSSProperties {
  // 44×44 真实命中区（不是靠伪元素撑出来的），停止/发送/创建共用。
  return { width: 44, minWidth: 44, height: 44, minHeight: 44, borderRadius: 22 };
}

/** One primary action: form submit sends; Stop is a separate explicit button. */
export function ChatPrimaryButton({ scope, threadId, fields, onStop }: {
  scope: string;
  threadId: string;
  fields: ComposerFieldsApi;
  onStop?: () => void | Promise<void>;
}) {
  const running = isRunning(getThreadStatus(scope, threadId));
  const hasInput = Boolean(fields.composer.text.trim() || fields.composer.attachments.length);
  if (running) {
    return (
      <button type="button" aria-label="停止" title="停止" onClick={() => { void onStop?.(); }}
        style={primaryStyle()}
        className="tl-press tl-composer-send tl-composer-send--stop" disabled={fields.busy || !onStop}>
        <Square size={14} fill="currentColor" />
      </button>
    );
  }
  return (
    <button type="submit" aria-label="发送" title="发送"
      style={primaryStyle()}
      className="tl-press tl-composer-send" disabled={!hasInput || fields.busy}>
      <ArrowUp size={20} strokeWidth={2.4} />
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
