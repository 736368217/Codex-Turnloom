/** Tab navigation state. No arbitrary local/http engine selector. */
import { createStore, useStore } from './store';

export type TabKey = 'threads' | 'devices' | 'settings';
export const TAB_LABELS: Record<TabKey, string> = {
  threads: '会话', devices: '设备', settings: '设置',
};
export const TAB_ORDER: TabKey[] = ['threads', 'devices', 'settings'];

export interface TabState {
  activeTab: TabKey;
  detailThreadId: string | null;
  detailTitle: string;
  /** A blank chat opened from the list's "+"; no thread exists yet. */
  composing: boolean;
  threadsQuery: string;
  threadsFilter: 'all' | 'running' | 'waiting' | 'done';
  /** 会话页视图放在 store 里：进出详情不再重置回默认值。 */
  threadsView: 'project' | 'time';
  /** 设备页「添加一台电脑」的全屏配对路由（AppRoot 渲染，避免嵌套两个 App 壳）。 */
  addMachine: boolean;
}

export const tabStore = createStore<TabState>({
  activeTab: 'threads', detailThreadId: null, detailTitle: '', composing: false,
  threadsQuery: '', threadsFilter: 'all', threadsView: 'project', addMachine: false,
});

export function setActiveTab(tab: TabKey): void {
  if (tab === tabStore.getState().activeTab) return;
  tabStore.setState({ activeTab: tab });
}
/** Open an empty chat: the first send creates the real thread. */
export function openNewThread(): void {
  tabStore.setState({ activeTab: 'threads', detailThreadId: null, detailTitle: '', composing: true });
}
export function openDetail(threadId: string, title = ''): void {
  tabStore.setState({ detailThreadId: threadId, detailTitle: title, composing: false });
}
export function closeDetail(): void {
  tabStore.setState({ detailThreadId: null, detailTitle: '', composing: false });
  // Drafts are scoped to a single detail page and never reused by a new thread.
}
export function setThreadsQuery(threadsQuery: string): void { tabStore.setState({ threadsQuery }); }
export function setThreadsFilter(threadsFilter: TabState['threadsFilter']): void { tabStore.setState({ threadsFilter }); }
export function setThreadsView(threadsView: TabState['threadsView']): void { tabStore.setState({ threadsView }); }
/** 添加电脑走全屏配对页：相机取景框塞不进半屏抽屉（报告第 3 节）。 */
export function openAddMachine(): void { tabStore.setState({ addMachine: true }); }
export function closeAddMachine(): void { tabStore.setState({ addMachine: false }); }
export function useTabState(): TabState { return useStore(tabStore); }
export default tabStore;
