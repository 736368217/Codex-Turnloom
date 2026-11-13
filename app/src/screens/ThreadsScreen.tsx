/** Threads: verified harness conversations + search + status filters. */
import { Search, Plus, X, MessageSquare } from 'lucide-react';
import TaskStream, { toneOfThread, titleOfThread } from '../components/TaskStream';
import { FilterSegmented } from '../components/Segmented';
import { EmptyState, SectionTitle } from '../components/ui';
import { COLORS } from '../theme/optionATokens';
import { useDataState, refreshThreads } from '../state/dataStore';
import { useTabState, setThreadsQuery, setThreadsFilter, type TabState } from '../state/tabStore';
import { currentRequestContext } from '../state/sessionStore';
import { openSheet } from '../state/sheetStore';
import { haptic } from '../lib/nativeBridge';

const FILTERS: { key: TabState['threadsFilter']; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'running', label: '运行中' },
  { key: 'waiting', label: '待审批' }, { key: 'done', label: '已完成' },
];

export default function ThreadsScreen() {
  const data = useDataState();
  const { threadsQuery, threadsFilter } = useTabState();
  const context = currentRequestContext();
  const query = threadsQuery.trim().toLowerCase();
  const filtered = data.threads.filter((thread) => {
    if (query && !`${titleOfThread(thread)} ${String(thread.preview || '')} ${thread.id}`.toLowerCase().includes(query)) return false;
    if (threadsFilter === 'all') return true;
    const tone = toneOfThread(thread);
    if (threadsFilter === 'running') return tone === 'running';
    if (threadsFilter === 'waiting') return tone === 'waiting';
    return tone === 'done';
  });

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
      </div>

      <SectionTitle>全部会话 · {filtered.length}</SectionTitle>
      {filtered.length > 0 ? (
        <TaskStream threads={filtered} emptyTitle="没有匹配的会话" />
      ) : (
        <EmptyState
          title={data.threads.length ? '没有匹配的会话' : '暂无会话'}
          description={data.threads.length ? '试试其他关键词或状态筛选' : data.offline ? '暂时未同步到会话，请检查电脑端连接后刷新' : '点击右上角 + 新建任务'}
          icon={<MessageSquare size={26} />}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
        <button type="button" className="tl-press" onClick={() => { if (context) { haptic('selection'); void refreshThreads(context); } }} style={{ minHeight: 44, padding: '0 12px', border: 0, background: 'transparent', color: COLORS.blue, fontSize: 13, fontWeight: 600 }}>
          刷新会话列表
        </button>
      </div>
    </div>
  );
}
