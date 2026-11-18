/**
 * Threads: 两种视图 —— 按项目（默认收起，最近用过的项目在前）与按时间（只按最近排序）。
 * 归档默认隐藏，展开后长按会话行才会出现归档/恢复入口，避免误触。
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, MessageSquare, ChevronDown, ChevronRight, Archive, ArchiveRestore } from 'lucide-react';
import TaskStream, { titleOfThread } from '../components/TaskStream';
import { EmptyState, SectionTitle } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshThreads, loadMoreThreads } from '../state/dataStore';
import { useTabState, setThreadsQuery } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { openSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';
import { isArchivedThread, groupThreadsByProject } from '../lib/threadProjection';
import { isLocallyArchived, setThreadArchived, subscribeThreadArchive } from '../lib/threadArchive';
import { postThreadArchive } from '../lib/turnloomApi';


type View = 'project' | 'time';

function timeOf(thread: { updatedAt?: unknown; status?: unknown }): number {
  const value = Number((thread as { updatedAt?: unknown }).updatedAt);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export default function ThreadsScreen() {
  const data = useDataState();
  const { threadsQuery } = useTabState();
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>('project');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<{ id: string; title: string; archived: boolean } | null>(null);
  const [archiveRevision, setArchiveRevision] = useState(0);
  const context = currentRequestContext();
  const query = threadsQuery.trim().toLowerCase();

  useEffect(() => subscribeThreadArchive(() => setArchiveRevision((value) => value + 1)), []);

  const archivedOf = (thread: { id?: string; archived?: unknown }): boolean =>
    isArchivedThread(thread) || isLocallyArchived(String(thread?.id || ''));

  const rows = useMemo(() => {
    const visible = showArchived ? data.threads : data.threads.filter((thread) => !archivedOf(thread));
    return visible.filter((thread) => !query || `${titleOfThread(thread)} ${String(thread.preview || '')} ${thread.id}`.toLowerCase().includes(query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.threads, query, showArchived, archiveRevision]);

  const archivedCount = data.threads.filter(archivedOf).length;
  const groups = groupThreadsByProject(rows);
  const byTime = useMemo(() => [...rows].sort((a, b) => timeOf(b) - timeOf(a)), [rows]);

  const toggleGroup = (key: string) => {
    haptic('selection');
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const doArchive = async (threadId: string, archived: boolean) => {
    setThreadArchived(threadId, archived);
    setPending(null);
    haptic('success');
    if (context) {
      const ok = await postThreadArchive(context, threadId, archived);
      if (ok) void refreshThreads(context);
    }
  };

  return (
    <div className="tl-screen tl-no-scrollbar">
      <div className="tl-safe-top" style={{ padding: '12px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="tl-large-title">会话</div><div style={{ flex: 1 }} />
          <button type="button" className="tl-press" aria-label="新建任务" onClick={() => { haptic('selection'); openSheet('newTask'); }} style={{ width: 40, height: 40, borderRadius: 20, border: 0, background: COLORS.blue, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={20} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, minHeight: 44, padding: '0 12px', borderRadius: 14, background: COLORS.fillSecondary }}>
          <Search size={17} color={COLORS.labelSecondary} />
          <input value={threadsQuery} onChange={(event) => setThreadsQuery(event.target.value)} placeholder="搜索会话" style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 15, color: COLORS.labelPrimary, minHeight: 44 }} />
          {threadsQuery.length > 0 && (
            <button type="button" className="tl-press" aria-label="清除搜索" onClick={() => { haptic('selection'); setThreadsQuery(''); }} style={{ width: 44, height: 44, border: 0, background: 'transparent', color: COLORS.labelSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="tl-view-switch" role="tablist" aria-label="会话视图">
          {(['project', 'time'] as View[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={`tl-view-switch__item${view === key ? ' is-active' : ''}`}
              onClick={() => { haptic('selection'); setView(key); }}
            >
              {key === 'project' ? '按项目' : '按时间'}
            </button>
          ))}
        </div>
      </div>

      <SectionTitle>{query ? `匹配会话 · ${rows.length}` : `已加载 ${rows.length}${data.threadTotal !== null ? ` / ${data.threadTotal}` : ''} 个会话`}</SectionTitle>

      {rows.length === 0 ? (
        <EmptyState
          title={query ? '没有匹配的会话' : '暂无会话'}
          description={query ? '换个关键词试试' : data.offline ? '暂时未同步到会话，请检查电脑端连接后刷新' : '点击右上角 + 新建任务'}
          icon={<MessageSquare size={26} />}
        />
      ) : view === 'time' ? (
        <TaskStream
          threads={byTime}
          statusByThread={data.statusByThread}
          isArchived={archivedOf}
          onLongPress={(threadId) => {
            const thread = data.threads.find((item) => item.id === threadId);
            setPending({ id: threadId, title: thread ? titleOfThread(thread) : threadId, archived: thread ? archivedOf(thread) : false });
          }}
        />
      ) : (
        groups.map((group) => {
          const collapsedNow = collapsed[group.key] !== false;
          return (
            <div key={group.key} className="tl-group">
              <button type="button" className="tl-group-head tl-press" aria-expanded={!collapsedNow} onClick={() => toggleGroup(group.key)}>
                {collapsedNow ? <ChevronRight size={16} color={COLORS.labelSecondary} /> : <ChevronDown size={16} color={COLORS.labelSecondary} />}
                <span className="tl-group-name">{group.name}</span>
                <span className="tl-group-count">{group.rows.length}</span>
              </button>
              {!collapsedNow && (
                <TaskStream
                  threads={group.rows}
                  statusByThread={data.statusByThread}
                  isArchived={archivedOf}
                  onLongPress={(threadId) => {
                    const thread = data.threads.find((item) => item.id === threadId);
                    setPending({ id: threadId, title: thread ? titleOfThread(thread) : threadId, archived: thread ? archivedOf(thread) : false });
                  }}
                />
              )}
            </div>
          );
        })
      )}

      {archivedCount > 0 && (
        <button
          type="button"
          className="tl-archive-toggle tl-press"
          aria-pressed={showArchived}
          onClick={() => { haptic('selection'); setShowArchived((value) => !value); }}
        >
          <Archive size={14} />
          {showArchived ? `隐藏归档会话（${archivedCount}）` : `显示归档会话（${archivedCount}）`}
        </button>
      )}

      {data.error && <p role="alert" className="tl-page-note tl-page-note--error">{data.error}</p>}

      <div className="tl-list-actions">
        {data.nextCursor && <button type="button" className="tl-press" disabled={data.loading || data.loadingMore} onClick={() => { if (context) void loadMoreThreads(context); }}>
          {data.loadingMore ? '正在加载…' : '加载更早会话'}
        </button>}
        <button type="button" className="tl-press" disabled={data.loading || data.loadingMore} onClick={() => { if (context) { haptic('selection'); void refreshThreads(context); } }}>
          {data.loading ? '正在刷新…' : '刷新会话列表'}
        </button>
      </div>

      {pending && (
        <div className="tl-confirm-backdrop" role="dialog" aria-modal="true" aria-label="确认归档">
          <div className="tl-confirm-card">
            <div className="tl-confirm-title">{pending.archived ? '取消归档' : '归档会话'}</div>
            <div className="tl-confirm-body">{pending.title}</div>
            <div className="tl-confirm-note">{pending.archived ? '取消后会重新出现在列表里。' : '归档后默认不再显示，可在「显示归档会话」里找回。'}</div>
            <div className="tl-confirm-actions">
              <button type="button" className="tl-confirm-cancel" onClick={() => setPending(null)}>取消</button>
              <button type="button" className="tl-confirm-ok" onClick={() => { void doArchive(pending.id, !pending.archived); }}>
                {pending.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                {pending.archived ? '恢复' : '归档'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
