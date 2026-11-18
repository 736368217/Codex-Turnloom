/**
 * New task drawer. Reuses the exact composer state and /api/send body shape
 * (model, effort, images, files, stable clientRequestId); no offline draft.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, ChevronRight, FolderOpen } from 'lucide-react';
import { ComposerFields, useComposerFields, requestIdForIdentity } from './ChatComposer';
import { COLORS } from '../theme/optionATokens';
import { buildSendPayload, sendRequestIdentity, supportsImages } from '../lib/chatContract';
import { createThread, dataStore } from '../state/dataStore';
import { closeSheet } from '../state/sheetStore';
import { openDetail } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { clearComposerInputs, selectComposer } from '../state/composerStore';
import { getProjects, type ProjectInfo } from '../lib/turnloomApi';
import { haptic } from '../lib/nativeBridge';

const NEW_THREAD_ID = '__new_task__';

export default function NewTaskSheet() {
  const context = currentRequestContext();
  const scope = context?.scope || '';
  const fields = useComposerFields(scope, NEW_THREAD_ID);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState('');
  const [notice, setNotice] = useState<ReactNode>('');

  useEffect(() => { selectComposer(scope, NEW_THREAD_ID); }, [scope]);

  const loadProjects = async () => {
    if (!context) { setNotice('连接尚未验证，请稍后重试'); return; }
    const result = await getProjects(context);
    if (result.ok && Array.isArray(result.data.projects)) setProjects(result.data.projects);
    else setNotice('暂时无法读取项目列表，请检查电脑端连接');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = fields.composer.text.trim();
    const attachments = fields.composer.attachments;
    if (!value && !attachments.length) return;
    if (fields.busy || !context) return;
    if (supportsImages(fields.catalog, fields.preference.model) === false && attachments.some((item) => item.kind === 'image')) {
      fields.setError('当前模型仅支持文字。请移除图片或改用支持图片的模型。'); return;
    }
    const payload = buildSendPayload({
      message: value, clientRequestId: '', model: fields.preference.model,
      effort: fields.preference.effort, attachments,
    });
    const identity = sendRequestIdentity({ ...payload, newThread: true, projectId });
    payload.clientRequestId = requestIdForIdentity(identity);
    fields.setBusy(true); fields.setError(''); setNotice('');
    haptic('success');
    const id = await createThread(context, { ...payload, projectId });
    fields.setBusy(false);
    if (!id) {
      // The draft, attachments, model/effort and request ID are all preserved.
      setNotice(`${dataStore.getState().error || '任务未创建成功。'} 草稿与附件已保留。`);
      haptic('error');
      return;
    }
    clearComposerInputs(scope, NEW_THREAD_ID, fields.composer.text, attachments);
    closeSheet();
    openDetail(id, value.slice(0, 48));
  };

  const canSubmit = !fields.busy && Boolean(fields.composer.text.trim() || fields.composer.attachments.length);
  return (
    <form className="tl-newtask" onSubmit={(event) => { void submit(event); }}>
      <ComposerFields fields={fields} primary={
        <button type="submit" className="tl-press tl-composer-send" aria-label="创建任务" title="创建任务" disabled={!canSubmit}>
          <ArrowUp size={20} strokeWidth={2.4} />
        </button>
      } />
      <div className="tl-newtask-projects">
        <button type="button" className="tl-press tl-newtask-project-head" onClick={() => { void loadProjects(); }}>
          <FolderOpen size={16} color={COLORS.labelSecondary} />
          <span>{projects.length ? `项目 · ${projects.length} 个可用` : '选择项目（可选）'}</span>
          <ChevronRight size={16} color={COLORS.labelSecondary} />
        </button>
        {projects.length > 0 && (
          <div className="tl-newtask-project-list tl-no-scrollbar" role="listbox" aria-label="项目">
            {projects.map((project, index) => {
              const id = String(project.id || project.path || index);
              const active = projectId === id;
              return (
                <button key={id} type="button" role="option" aria-selected={active} className="tl-newtask-project"
                  onClick={() => { haptic('selection'); setProjectId(active ? '' : id); }}>
                  <span className="tl-newtask-project-name">{String(project.name || project.path || id)}</span>
                  {active && <span className="tl-newtask-project-check">已选</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {notice && <div role="alert" className="tl-composer-error">{notice}</div>}
    </form>
  );
}
