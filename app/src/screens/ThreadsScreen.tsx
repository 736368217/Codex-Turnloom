/** Threads: verified harness conversations, grouped by project, archived hidden by default. */
import { useEffect, useState } from 'react';
import { Search, Plus, X, MessageSquare, Archive } from 'lucide-react';
import TaskStream, { toneOfThread, titleOfThread } from '../components/TaskStream';
import { FilterSegmented } from '../components/Segmented';
import { EmptyState, SectionTitle } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshThreads, loadMoreThreads } from '../state/dataStore';
import { useTabState, setThreadsQuery, setThreadsFilter, type TabState } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { openSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';
import { isArchivedThread, groupThreadsByProject } from '../lib/threadProjection';
import { isLocallyArchived, setThreadArchived, subscribeThreadArchive } from '../lib/threadArchive';
const FILTERS: { key: TabState['threadsFilter']; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'running', label: '运行中' },
  { key: 'waiting', label: '待审批' }, { key: 'done', label: '已完成' },
];

export default function ThreadsScreen() {
  const data = useDataState();
  const { threadsQuery, threadsFilter } = useTabState();
  const [showArchived, setShowArchived] = useState(false);
  // 本机归档表存在 localStorage，改完后订阅回调让列表立即重排。
  const [archiveRevision, setArchiveRevision] = useState(0);
  useEffect(() => subscribeThreadArchive(() => setArchiveRevision((value) => value + 1)), []);
  const context = currentRequestContext();
  const query = threadsQuery.trim().toLowerCase();
  // 服务端 archived 标记（Codex 侧）+ 本机归档表（PI 侧没有 archived 列）。
  const archivedOf = (thread: { id?: string }): boolean =>
    isArchivedThread(thread) || isLocallyArchived(String(thread?.id || ''));
  const archivedCount = archiveRevision >= 0 ? data.threads.filter(archivedOf).length : 0;
  // 归档会话默认不可见，由用户显式切换后才参与筛选与分组。
  const visible = showArchived ? data.threads : data.threads.filter((thread) => !archivedOf(thread));
  const filtered = visible.filter((thread) => {
    if (query && !`${titleOfThread(thread)} ${String(thread.preview || '')} ${thread.id}`.toLowerCase().includes(query)) return false;
    if (threadsFilter === 'all') return true;
    const tone = toneOfThread(thread, data.statusByThread);
    if (threadsFilter === 'running') return tone === 'running';
    if (threadsFilter === 'waiting') return tone === 'waiting';
    return tone === 'done';
  });
  const groups = groupThreadsByProject(filtered);

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
        <div style={{ marginTop: 12 }}><FilterSegmented value={threadsFilter} options={FILTERS} onChange={setThreadsFilter} /></div>
        {archivedCount > 0 && (
          <button
            type="button"
            className="tl-press"
            aria-pressed={showArchived}
            onClick={() => { haptic('selection'); setShowArchived((value) => !value); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 40, marginTop: 8, padding: '0 10px', border: 0, borderRadius: 12, background: showArchived ? COLORS.fillSecondary : 'transparent', color: COLORS.labelSecondary, fontSize: 13 }}
          >
            <Archive size={15} />
            {showArchived ? `已显示归档会话（${archivedCount}）` : `显示归档会话（${archivedCount}）`}
          </button>
        )}
      </div>

      <SectionTitle>{query || threadsFilter !== 'all' ? `匹配会话 · ${filtered.length}` : `已加载 ${visible.length}${data.threadTotal !== null ? ` / ${data.threadTotal}` : ''} 个会话`}</SectionTitle>
      {filtered.length > 0 ? (
        groups.map((group) => (
          <div key={group.key}>
            <SectionTitle>{`${group.name} · ${group.rows.length}`}</SectionTitle>
            <TaskStream
              threads={group.rows}
              statusByThread={data.statusByThread}
              emptyTitle="没有匹配的会话"
              onArchive={(threadId, archived) => setThreadArchived(threadId, archived)}
              isArchived={(threadId) => archivedOf({ id: threadId })}
            />
          </div>
        ))
      ) : (
        <EmptyState
          title={visible.length ? '没有匹配的会话' : '暂无会话'}
          description={visible.length ? '试试其他关键词或状态筛选' : data.offline ? '暂时未同步到会话，请检查电脑端连接后刷新' : '点击右上角 + 新建任务'}
          icon={<MessageSquare size={26} />}
        />
      )}
      {data.error && <p role="alert" className="tl-page-note tl-page-note--error">{data.error}</p>}
      {data.nextCursor && <p className="tl-page-note">搜索与筛选当前已加载的 {visible.length} 个会话</p>}
      <div className="tl-list-actions">
        {data.nextCursor && <button type="button" className="tl-press" disabled={data.loading || data.loadingMore} onClick={() => { if (context) void loadMoreThreads(context); }}>
          {data.loadingMore ? '正在加载…' : '加载更早会话'}
        </button>}
        <button type="button" className="tl-press" disabled={data.loading || data.loadingMore} onClick={() => { if (context) { haptic('selection'); void refreshThreads(context); } }}>
          {data.loading ? '正在刷新…' : '刷新会话列表'}
        </button>
      </div>
    </div>
  );
}
