/**
 * 会话列表 = 首页（2.2.2 IA）。时间倒序是默认视图；项目分组收进顶部筛选。
 * 归档只走长按，避免误触；列表白底铺满到 TabBar，行间分隔线由 CSS 负责。
 *
 * 2.4.0：搜索从滚动区搬进固定区，走 /api/search（标题 / 项目 / 正文），
 * 250ms 防抖；命中分「会话」「内容命中」两组并高亮。旧电脑端没有该接口时
 * 明确降级为标题/项目/预览匹配，不假装搜过正文。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, X, ChevronDown, ChevronRight, Archive, ArchiveRestore, Copy } from 'lucide-react';
import TaskStream, { titleOfThread } from '../components/TaskStream';
import SegmentedControl from '../components/SegmentedControl';
import RunningStrip from '../components/RunningStrip';
import KindAvatar from '../components/KindAvatar';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshThreads, loadMoreThreads } from '../state/dataStore';
import { useTabState, setThreadsQuery, setThreadsView, openNewThread, setActiveTab, openDetail } from '../state/tabStore';
import { useSessionState, currentRequestContext, selectedHarness } from '../state/sessionStore';
import { platformLabel } from '../lib/platforms';
import { haptic, pushNativeBackLayer } from '../lib/nativeBridge';
import { copyText } from '../lib/clipboard';
import { isArchivedThread, groupThreadsByProject, threadUpdatedAtMs, partitionPinned, formatThreadWhen } from '../lib/threadProjection';
import { isLocallyArchived, setThreadArchived, subscribeThreadArchive } from '../lib/threadArchive';
import { postThreadArchive, searchThreads } from '../lib/turnloomApi';
import {
  normalizeSearchHits, groupSearchHits, highlightParts, localThreadMatches,
  type SearchHit,
} from '../lib/searchResults';

type View = 'project' | 'time';
type Pending = { id: string; title: string; archived: boolean; stage: 'menu' | 'confirm' };
type SearchPhase = 'idle' | 'loading' | 'ready' | 'fallback' | 'error';

const isUncategorized = (key: string) => key.startsWith('uncategorized:');
/** 置顶组不是项目组，key 不能和 `project:` / `uncategorized:` 撞。 */
const PINNED_KEY = 'pinned';

/** 高亮片段：服务端文本先当纯文本，绝不拼 HTML。 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = highlightParts(text, query);
  return <>{parts.map((part, index) => (part.hit
    ? <mark key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>))}</>;
}

export default function ThreadsScreen() {
  const data = useDataState();
  const session = useSessionState();
  const { threadsQuery, threadsView: view } = useTabState();
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState('');
  const [archiveRevision, setArchiveRevision] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle');
  const [searchError, setSearchError] = useState('');
  const searchSeq = useRef(0);
  const context = currentRequestContext();
  const query = threadsQuery.trim();
  const harness = selectedHarness(session) || undefined;

  useEffect(() => subscribeThreadArchive(() => setArchiveRevision((value) => value + 1)), []);

  const archivedOf = (thread: { id?: string; archived?: unknown }): boolean =>
    isArchivedThread(thread) || isLocallyArchived(String(thread?.id || ''));

  const visibleRows = useMemo(
    () => (showArchived ? data.threads : data.threads.filter((thread) => !archivedOf(thread))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.threads, showArchived, archiveRevision],
  );

  // Old hosts and failed searches still show something honest: local matching
  // on title / project / preview, never on the thread id (P2).
  const localRows = useMemo(() => localThreadMatches(visibleRows, query), [visibleRows, query]);

  const rows = useMemo(() => (query ? localRows : visibleRows), [query, localRows, visibleRows]);

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

  // 250ms 防抖 + 序号守卫：快速改词只认最后一次请求。
  useEffect(() => {
    const q = threadsQuery.trim();
    if (!q) {
      searchSeq.current += 1;
      setHits([]);
      setSearchPhase('idle');
      setSearchError('');
      return;
    }
    const seq = ++searchSeq.current;
    setSearchPhase('loading');
    setSearchError('');
    const timer = setTimeout(() => {
      if (!context) {
        setSearchPhase('error');
        setSearchError('还没有连上电脑');
        return;
      }
      void searchThreads(context, q, 30).then((result) => {
        if (seq !== searchSeq.current) return;
        if (result.ok) {
          setHits(normalizeSearchHits(result.data?.results));
          setSearchPhase('ready');
          return;
        }
        if (result.status === 404) {
          setSearchPhase('fallback');
          setSearchError('这台电脑的服务端还没有正文搜索，先按标题、项目和预览匹配。');
          return;
        }
        setSearchPhase('error');
        setSearchError(`搜索未完成：${result.error || '请稍后重试'}`);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [threadsQuery, context?.scope, context?.generation]);

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
      {data.error && <p role="alert" className="tl-page-note tl-page-note--error">{data.error}</p>}
      <div className="tl-list-actions">
        {data.nextCursor && <button type="button" className="tl-press" disabled={data.loading || data.loadingMore} onClick={() => { if (context) void loadMoreThreads(context); }}>
          {data.loadingMore ? '正在加载…' : '加载更早会话'}
        </button>}
      </div>
    </>
  );

  const searchGroups = useMemo(() => groupSearchHits(hits), [hits]);
  const searchEmpty = searchPhase === 'ready' && hits.length === 0;
  const fallbackMode = searchPhase === 'fallback' || searchPhase === 'error';

  const searchBody = (
    <div className="tl-search-panel" role="region" aria-label={`搜索 ${query}`}>
      {searchPhase === 'loading' && <div className="tl-search-status">正在搜索「{query}」…</div>}
      {fallbackMode && (
        <>
          <div className={searchPhase === 'error' ? 'tl-search-status tl-search-status--error' : 'tl-search-status'}>{searchError}</div>
          <TaskStream
            threads={localRows}
            statusByThread={data.statusByThread}
            isArchived={archivedOf}
            onLongPress={openThreadMenu}
            emptyTitle="没有匹配的会话"
            emptyDescription="标题、项目和预览里都没有这个词。"
          />
        </>
      )}
      {searchPhase === 'ready' && (
        <>
          {searchGroups.threads.length > 0 && (
            <section className="tl-search-group" aria-label="会话命中">
              <div className="tl-search-head">会话<span>{searchGroups.threads.length}</span></div>
              {searchGroups.threads.map((hit, index) => (
                <button
                  key={`t:${hit.threadId}:${index}`}
                  type="button"
                  className="tl-search-row tl-press"
                  onClick={() => { haptic('selection'); openDetail(hit.threadId, hit.title); }}
                >
                  <span className="tl-search-main">
                    <span className="tl-search-title"><Highlighted text={hit.title} query={query} /></span>
                    <span className="tl-search-meta">
                      {hit.project || '未归类'}
                      {hit.field === 'title' ? ' · 标题命中' : hit.field === 'project' ? ' · 项目命中' : ''}
                    </span>
                  </span>
                  <span className="tl-search-at">{formatThreadWhen({ updatedAt: hit.at })}</span>
                </button>
              ))}
            </section>
          )}
          {searchGroups.messages.length > 0 && (
            <section className="tl-search-group" aria-label="内容命中">
              <div className="tl-search-head">内容命中<span>{searchGroups.messages.length}</span></div>
              {searchGroups.messages.map((hit, index) => (
                <button
                  key={`m:${hit.threadId}:${index}`}
                  type="button"
                  className="tl-search-row tl-search-row--snippet tl-press"
                  onClick={() => { haptic('selection'); openDetail(hit.threadId, hit.title); }}
                >
                  <span className="tl-search-main">
                    <span className="tl-search-title"><Highlighted text={hit.title} query={query} /></span>
                    <span className="tl-search-meta">{hit.project || '未归类'}{hit.at ? ` · ${formatThreadWhen({ updatedAt: hit.at })}` : ''}</span>
                    <span className="tl-search-snippet"><Highlighted text={hit.snippet || '…'} query={query} /></span>
                  </span>
                </button>
              ))}
            </section>
          )}
          {searchEmpty && (
            <div className="tl-search-empty" role="status">
              <div className="tl-search-empty-title">没有匹配「{query}」</div>
              <div className="tl-search-empty-copy">已搜索会话标题、项目和消息正文，换个词试试。</div>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="tl-thread-screen">
      <div className="tl-safe-top tl-thread-head">
        <div className="tl-thread-nav">
          <h1>会话</h1>
          <button type="button" className="tl-press tl-nav-action" aria-label="新建会话" onClick={() => { haptic('selection'); openNewThread(); }}>
            <Plus size={22} />
          </button>
        </div>
        {/* 2.2.6：标题下常驻一行「电脑 · 平台」。2.4.0 左侧加平台头像，
            右侧换成 ›：它执行的是跳页，不是下拉。 */}
        {session.machineName && (
          <button
            type="button"
            className="tl-current-device tl-press"
            onClick={() => { haptic('selection'); setActiveTab('devices'); }}
          >
            <span className="tl-current-device-dot" data-online={session.online ? 'true' : 'false'} aria-hidden="true" />
            <KindAvatar kind={harness?.kind} label={harness?.name || session.machineName} size={20} />
            <span className="tl-current-device-name">{session.machineName}</span>
            <span className="tl-current-device-sep" aria-hidden="true">·</span>
            <span className="tl-current-device-platform">{platformLabel(harness, session.machineName)}</span>
            <ChevronRight size={14} className="tl-current-device-caret" aria-hidden="true" />
          </button>
        )}
        {/* 固定区：搜索是会话页最高频动作，不再被列表滚动带走。
            输入时收起分段与运行条，只留输入框和结果（NB3 §9.1）。 */}
        {!query && (
          <div className="tl-thread-filters">
            <SegmentedControl<View>
              label="会话视图"
              value={view}
              options={[{ key: 'time', label: '按时间' }, { key: 'project', label: '按项目' }]}
              onChange={setThreadsView}
            />
          </div>
        )}
        <div className="tl-thread-search">
          <Search size={16} aria-hidden="true" />
          <input value={threadsQuery} onChange={(event) => setThreadsQuery(event.target.value)} placeholder="搜索会话、项目或消息内容" aria-label="搜索会话、项目或消息内容" />
          {threadsQuery.length > 0 && (
            <button type="button" aria-label="清除搜索" onClick={() => { haptic('selection'); setThreadsQuery(''); }}>
              <X size={16} />
            </button>
          )}
        </div>
        {/* 运行条不随查询词隐藏：搜东西时更需要知道有活卡着等你（审计 §13.3）。 */}
        <RunningStrip />
      </div>

      <div className="tl-thread-scroll" style={{ display: 'flex', flexDirection: 'column' }}>
        {query ? searchBody : rows.length === 0 ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', background: COLORS.surface }}>
            <TaskStream
              threads={[]}
              emptyTitle="暂无会话"
              emptyDescription={data.offline ? '暂时未同步到会话，请检查电脑端连接后刷新' : '点右上角 + 开始一个新会话'}
            />
          </div>
        ) : (
          <div key={view} className="tl-thread-view">
            {view === 'time' ? (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: COLORS.surface }}>
                <button
                  type="button"
                  className="tl-archive-toggle tl-press"
                  aria-pressed={showArchived}
                  onClick={() => { haptic('selection'); setShowArchived((value) => !value); }}
                  style={{ display: archivedCount > 0 ? undefined : 'none' }}
                >
                  <Archive size={14} />
                  {showArchived ? `隐藏归档会话（${archivedCount}）` : `显示归档会话（${archivedCount}）`}
                </button>
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
                <button
                  type="button"
                  className="tl-archive-toggle tl-press"
                  aria-pressed={showArchived}
                  onClick={() => { haptic('selection'); setShowArchived((value) => !value); }}
                  style={{ display: archivedCount > 0 ? undefined : 'none' }}
                >
                  <Archive size={14} />
                  {showArchived ? `隐藏归档会话（${archivedCount}）` : `显示归档会话（${archivedCount}）`}
                </button>
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
                    {pending.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
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
