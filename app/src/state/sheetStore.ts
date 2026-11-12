/** Global singleton bottom-sheet state. No centered modal is used. */
import { createStore, useStore } from './store';

export type SheetKey = 'newTask' | 'harness' | 'approval' | 'diagnostics' | 'interruptAll' | 'disconnect' | null;

export interface ApprovalRequest {
  id: string;
  threadId: string;
  title: string;
  command: string;
  reason?: string;
}

export interface SheetState {
  sheet: SheetKey;
  contextThreadId: string;
  approval: ApprovalRequest | null;
  notice: string;
}

export const sheetStore = createStore<SheetState>({
  sheet: null, contextThreadId: '', approval: null, notice: '',
});

export function openSheet(sheet: Exclude<SheetKey, null>, contextThreadId = ''): void {
  sheetStore.setState({ sheet, contextThreadId, notice: '' });
}
export function closeSheet(): void {
  sheetStore.setState({ sheet: null, approval: null, notice: '' });
}
export function openApproval(request: ApprovalRequest): void {
  sheetStore.setState({ sheet: 'approval', contextThreadId: request.threadId, approval: request, notice: '' });
}
export function setSheetNotice(notice: string): void { sheetStore.setState({ notice }); }
export function isAnySheetOpen(): boolean { return sheetStore.getState().sheet !== null; }
export function backFromSheet(): boolean {
  if (!isAnySheetOpen()) return false;
  closeSheet();
  return true;
}
export function useSheetState(): SheetState { return useStore(sheetStore); }
export default sheetStore;
