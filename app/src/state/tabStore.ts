/** Tab navigation state. No arbitrary local/http engine selector. */
import { createStore, useStore } from './store';

export type TabKey = 'home' | 'threads' | 'monitors' | 'settings';
export const TAB_LABELS: Record<TabKey, string> = {
  home: '首页', threads: '会话', monitors: '监控', settings: '设置',
};
export const TAB_ORDER: TabKey[] = ['home', 'threads', 'monitors', 'settings'];

export interface TabState {
  activeTab: TabKey;
  detailThreadId: string | null;
  detailTitle: string;
  threadsQuery: string;
  threadsFilter: 'all' | 'running' | 'waiting' | 'done';
  /** 会话页视图放在 store 里：进出详情不再重置回默认值。 */
  threadsView: 'project' | 'time';
}

export const tabStore = createStore<TabState>({
  activeTab: 'home', detailThreadId: null, detailTitle: '',
  threadsQuery: '', threadsFilter: 'all', threadsView: 'time',
});

export function setActiveTab(tab: TabKey): void {
  if (tab === tabStore.getState().activeTab) return;
  tabStore.setState({ activeTab: tab });
}
export function openDetail(threadId: string, title = ''): void {
  tabStore.setState({ detailThreadId: threadId, detailTitle: title });
}
export function closeDetail(): void {
  tabStore.setState({ detailThreadId: null, detailTitle: '' });
  // Drafts are scoped to a single detail page and never reused by a new thread.
}
export function setThreadsQuery(threadsQuery: string): void { tabStore.setState({ threadsQuery }); }
export function setThreadsFilter(threadsFilter: TabState['threadsFilter']): void { tabStore.setState({ threadsFilter }); }
export function setThreadsView(threadsView: TabState['threadsView']): void { tabStore.setState({ threadsView }); }
export function useTabState(): TabState { return useStore(tabStore); }
export default tabStore;
