/**
 * 会话列表 = 首页（2.2.2 IA）。时间倒序是默认视图；项目分组收进顶部筛选。
 * 归档只走长按，避免误触；列表白底铺满到 TabBar，行间分隔线由 CSS 负责。
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, ChevronDown, ChevronRight, Archive, ArchiveRestore } from 'lucide-react';
import TaskStream, { titleOfThread } from '../components/TaskStream';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshThreads, loadMoreThreads } from '../state/dataStore';
import { useTabState, setThreadsQuery, setThreadsView, openNewThread } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { haptic } from '../lib/nativeBridge';
import { isArchivedThread, groupThreadsByProject, threadUpdatedAtMs } from '../lib/threadProjection';
import { isLocallyArchived, setThreadArchived, subscribeThreadArchive } from '../lib/threadArchive';
import { postThreadArchive } from '../lib/turnloomApi';

type View = 'project' | 'time';

export default function ThreadsScreen() {
  const data = useDataState();
  const { threadsQuery, threadsView: view } = useTabState();
  const [showArchived, setShowArchived] = useState(false);
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
  const byTime = useMemo(() => [...rows].sort((a, b) => threadUpdatedAtMs(b) - threadUpdatedAtMs(a)), [rows]);

  const toggleGroup = (key: string) => {
    haptic('selection');
    setCollapsed((prev) => ({ ...prev, [key]: prev[key] !== true }));
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

  const listControls = (
    <>
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
    </>
  );

  return (
    <div className="tl-thread-screen">
      <div className="tl-safe-top" style={{ flex: '0 0 auto' }}>
        <div className="tl-thread-nav">
          <h1>会话</h1>
          <button type="button" className="tl-press tl-nav-action" aria-label="新建会话" onClick={() => { haptic('selection'); openNewThread(); }}>
            <Plus size={24} />
          </button>
        </div>
      </div>

      <div className="tl-thread-scroll" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="tl-thread-search">
          <Search size={16} aria-hidden="true" />
          <input value={threadsQuery} onChange={(event) => setThreadsQuery(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" />
          {threadsQuery.length > 0 && (
            <button type="button" aria-label="清除搜索" onClick={() => { haptic('selection'); setThreadsQuery(''); }}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="tl-thread-filters" role="tablist" aria-label="会话视图">
          {(['time', 'project'] as View[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={`tl-filter-chip tl-press${view === key ? ' is-active' : ''}`}
              onClick={() => { haptic('selection'); setThreadsView(key); }}
            >
              {key === 'time' ? '按时间' : '按项目'}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', background: COLORS.surface }}>
            <TaskStream
              threads={[]}
              emptyTitle={query ? '没有匹配的会话' : '暂无会话'}
              emptyDescription={query ? '换个关键词试试' : data.offline ? '暂时未同步到会话，请检查电脑端连接后刷新' : '点右上角 + 开始一个新会话'}
            />
          </div>
        ) : view === 'time' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: COLORS.surface }}>
            <TaskStream
              threads={byTime}
              statusByThread={data.statusByThread}
              isArchived={archivedOf}
              onLongPress={(threadId) => {
                const thread = data.threads.find((item) => item.id === threadId);
                setPending({ id: threadId, title: thread ? titleOfThread(thread) : threadId, archived: thread ? archivedOf(thread) : false });
              }}
            />
            {listControls}
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: COLORS.surface }}>
            {groups.map((group) => {
              const collapsedNow = collapsed[group.key] === true;
              return (
                <div key={group.key}>
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
            })}
            {listControls}
          </div>
        )}
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
