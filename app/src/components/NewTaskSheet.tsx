import { useState } from 'react';
import { Sparkles, FolderOpen } from 'lucide-react';
import { COLORS } from '../theme/optionATokens';
import { ActionButton } from './ui';
import { createThread } from '../state/dataStore';
import { closeSheet } from '../state/sheetStore';
import { openDetail } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { haptic } from '../lib/nativeBridge';
import { getProjects, type ProjectInfo, type RequestContext } from '../lib/turnloomApi';

/** New task drawer: real host thread creation only; no offline draft. */
export default function NewTaskSheet() {
  const context = currentRequestContext();
  const [message, setMessage] = useState('');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadProjects = async () => {
    if (!context) { setError('连接尚未验证，请稍后重试'); return; }
    const result = await getProjects(context);
    if (result.ok && Array.isArray(result.data.projects)) setProjects(result.data.projects);
    else setError('暂时无法读取项目列表，请检查电脑端连接');
  };

  const submit = async () => {
    const value = message.trim();
    if (!value || busy || !context) return;
    setBusy(true); setError(''); haptic('success');
    const id = await createThread(context as RequestContext, value, projectId);
    setBusy(false);
    if (!id) { setError('任务未创建成功，请检查电脑端连接后重试'); haptic('error'); return; }
    closeSheet();
    openDetail(id, value.slice(0, 48));
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: COLORS.labelSecondary, margin: '0 0 10px' }}>任务会在当前电脑上创建，成功后打开会话。</div>
      <textarea
        value={message} onChange={(event) => setMessage(event.target.value)}
        placeholder="例如：为登录流程补充单元测试…" className="tl-selectable"
        style={{ width: '100%', minHeight: 108, border: 0, borderRadius: 16, background: COLORS.fillSecondary, color: COLORS.labelPrimary, padding: 14, fontSize: 16, outline: 'none', resize: 'vertical' }}
      />
      <button type="button" className="tl-press" onClick={() => { void loadProjects(); }} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 12, padding: '0 12px', border: 0, borderRadius: 12, background: COLORS.surface, color: COLORS.blue, fontSize: 13, width: '100%' }}>
        <FolderOpen size={16} /><span style={{ flex: 1, textAlign: 'left' }}>{projects.length ? `选择项目（${projects.length} 个可用）` : '加载可用项目'}</span>
      </button>
      {projects.length > 0 && (
        <div className="tl-no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 10 }}>
          {projects.map((project, index) => {
            const id = String(project.id || project.path || index);
            return (
              <button key={id} type="button" className="tl-press" onClick={() => { haptic('selection'); setProjectId(id); }} style={{ minHeight: 44, padding: '0 14px', border: 0, borderRadius: 999, background: projectId === id ? COLORS.blue : COLORS.fillSecondary, color: projectId === id ? '#FFFFFF' : COLORS.labelPrimary, fontSize: 13, whiteSpace: 'nowrap' }}>
                {String(project.name || project.path || id)}
              </button>
            );
          })}
        </div>
      )}
      {error && <div style={{ color: COLORS.red, fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div className="tl-sheet-actions" style={{ marginTop: 18 }}>
        <ActionButton icon={<Sparkles size={18} />} onClick={() => { void submit(); }} disabled={busy || !context || !message.trim()} style={{ opacity: busy || !context || !message.trim() ? 0.5 : 1 }}>
          {busy ? '创建中…' : '创建任务'}
        </ActionButton>
      </div>
    </div>
  );
}
