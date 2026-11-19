/**
 * 会话列表 = 首页（2.2.2 IA）。时间倒序是默认视图；项目分组收进顶部筛选。
 * 归档只走长按，避免误触；列表白底铺满到 TabBar，行间分隔线由 CSS 负责。
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, ChevronDown, ChevronRight, Archive, ArchiveRestore, Copy } from 'lucide-react';
import TaskStream, { titleOfThread } from '../components/TaskStream';
import SegmentedControl from '../components/SegmentedControl';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshThreads, loadMoreThreads } from '../state/dataStore';
import { useTabState, setThreadsQuery, setThreadsView, openNewThread } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { haptic, pushNativeBackLayer } from '../lib/nativeBridge';
import { copyText } from '../lib/clipboard';
import { isArchivedThread, groupThreadsByProject, threadUpdatedAtMs, partitionPinned } from '../lib/threadProjection';
import { isLocallyArchived, setThreadArchived, subscribeThreadArchive } from '../lib/threadArchive';
import { postThreadArchive } from '../lib/turnloomApi';

type View = 'project' | 'time';
type Pending = { id: string; title: string; archived: boolean; stage: 'menu' | 'confirm' };

const isUncategorized = (key: string) => key.startsWith('uncategorized:');
/** 置顶组不是项目组，key 不能和 `project:` / `uncategorized:` 撞。 */
const PINNED_KEY = 'pinned';

export default function ThreadsScreen() {
  const data = useDataState();
  const { threadsQuery, threadsView: view } = useTabState();
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState('');
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
  // 置顶组独立于两个视图：先摘出来，下面的项目组与时间列表就不会再渲染它。
  const { pinned: pinnedRows, rest: plainRows } = useMemo(() => partitionPinned(rows), [rows]);
  const groups = groupThreadsByProject(plainRows);
  const byTime = useMemo(() => [...plainRows].sort((a, b) => threadUpdatedAtMs(b) - threadUpdatedAtMs(a)), [plainRows]);
  // Projects first, 未归类 last; a group is collapsed unless it is the uncategorized one.
  // 置顶组默认展开，项目组默认收起。
  const orderedGroups = useMemo(
    () => [...groups].sort((a, b) => Number(isUncategorized(a.key)) - Number(isUncategorized(b.key))),
    [groups],
  );
  const isCollapsed = (key: string) => collapsed[key] ?? (key === PINNED_KEY ? false : !isUncategorized(key));

  const toggleGroup = (key: string) => {
    haptic('selection');
    setCollapsed((prev) => ({ ...prev, [key]: !isCollapsed(key) }));
  };

  const openThreadMenu = (threadId: string) => {
    const thread = data.threads.find((item) => item.id === threadId);
    setPending({
      id: threadId,
      title: thread ? titleOfThread(thread) : threadId,
      archived: thread ? archivedOf(thread) : false,
      stage: 'menu',
    });
  };

  const pinnedCollapsed = isCollapsed(PINNED_KEY);
  // 0 条置顶时整组不渲染（不是隐藏的空标题）；置顶行已从 plainRows 里摘走。
  const pinnedGroup = pinnedRows.length === 0 ? null : (
    <div className="tl-pinned-group" data-qa="pinned-group">
      <button type="button" className="tl-group-head tl-press" aria-expanded={!pinnedCollapsed} onClick={() => toggleGroup(PINNED_KEY)}>
        {pinnedCollapsed ? <ChevronRight size={16} color={COLORS.labelSecondary} /> : <ChevronDown size={16} color={COLORS.labelSecondary} />}
        <span className="tl-group-name">置顶</span>
        <span className="tl-group-count">{pinnedRows.length}</span>
      </button>
      {!pinnedCollapsed && (
        <TaskStream
          threads={pinnedRows}
          statusByThread={data.statusByThread}
          isArchived={archivedOf}
          onLongPress={openThreadMenu}
        />
      )}
    </div>
  );

  // Both layers (menu and confirm) close on Back and on a backdrop tap. A dialog that
  // only offers 取消 leaves the Android back button to exit the whole app.
  useEffect(() => {
    if (!pending) return;
    const pop = pushNativeBackLayer(() => setPending(null));
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPending(null); };
    window.addEventListener('keydown', onKey);
    return () => { pop(); window.removeEventListener('keydown', onKey); };
  }, [pending]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [notice]);

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
      <div className="tl-safe-top tl-thread-head">
        <div className="tl-thread-nav">
          <h1>会话</h1>
          <button type="button" className="tl-press tl-nav-action" aria-label="新建会话" onClick={() => { haptic('selection'); openNewThread(); }}>
            <Plus size={24} />
          </button>
        </div>
        {/* 固定区：切视图不该被列表滚动带走（2.2.6）。搜索留在滚动区顶部。 */}
        <div className="tl-thread-filters">
          <SegmentedControl<View>
            label="会话视图"
            value={view}
            options={[{ key: 'time', label: '按时间' }, { key: 'project', label: '按项目' }]}
            onChange={setThreadsView}
          />
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

        {rows.length === 0 ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', background: COLORS.surface }}>
            <TaskStream
              threads={[]}
              emptyTitle={query ? '没有匹配的会话' : '暂无会话'}
              emptyDescription={query ? '换个关键词试试' : data.offline ? '暂时未同步到会话，请检查电脑端连接后刷新' : '点右上角 + 开始一个新会话'}
            />
          </div>
        ) : (
          <div key={view} className="tl-thread-view">
            {view === 'time' ? (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: COLORS.surface }}>
                {pinnedGroup}
                <TaskStream
                  threads={byTime}
                  statusByThread={data.statusByThread}
                  isArchived={archivedOf}
                  onLongPress={openThreadMenu}
                />
                {listControls}
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: COLORS.surface }}>
                {pinnedGroup}
                {orderedGroups.map((group) => {
                  const collapsedNow = isCollapsed(group.key);
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
                          onLongPress={openThreadMenu}
                        />
                      )}
                    </div>
                  );
                })}
                {listControls}
              </div>
            )}
          </div>
        )}
      </div>

      {pending && (
        <div
          className="tl-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={pending.stage === 'menu' ? '会话操作' : '确认归档'}
          onClick={(event) => { if (event.target === event.currentTarget) setPending(null); }}
        >
          <div className="tl-confirm-card">
            {pending.stage === 'menu' ? (
              <>
                <div className="tl-confirm-title">{pending.title}</div>
                <button
                  type="button"
                  className="tl-confirm-row tl-press"
                  onClick={async () => {
                    haptic('selection');
                    const ok = await copyText(pending.id);
                    setPending(null);
                    setNotice(ok ? '已复制会话 ID' : '复制失败，请重试');
                  }}
                >
                  <Copy size={16} />
                  复制会话 ID
                </button>
                <button
                  type="button"
                  className="tl-confirm-row tl-press"
                  onClick={() => { haptic('warning'); setPending({ ...pending, stage: 'confirm' }); }}
                >
                  {pending.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  {pending.archived ? '取消归档' : '归档会话'}
                </button>
                <div className="tl-confirm-actions">
                  <button type="button" className="tl-confirm-cancel" onClick={() => setPending(null)}>取消</button>
                </div>
              </>
            ) : (
              <>
                <div className="tl-confirm-title">{pending.archived ? '取消归档' : '归档会话'}</div>
                <div className="tl-confirm-body">{pending.title}</div>
                <div className="tl-confirm-note">{pending.archived ? '取消后会重新出现在列表里。' : '归档后默认不再显示，可在「显示归档会话」里找回。'}</div>
                <div className="tl-confirm-actions">
                  <button type="button" className="tl-confirm-cancel" onClick={() => setPending({ ...pending, stage: 'menu' })}>返回</button>
                  <button type="button" className="tl-confirm-ok" onClick={() => { void doArchive(pending.id, !pending.archived); }}>
                    {pending.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    {pending.archived ? '恢复' : '归档'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {notice && <div className="tl-toast" role="status">{notice}</div>}
    </div>
  );
}
