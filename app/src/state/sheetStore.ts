/** Global singleton bottom-sheet state. No centered modal or fake approval. */
import { createStore, useStore } from './store';

export type SheetKey = 'newTask' | 'harness' | 'diagnostics' | 'disconnect' | null;

export interface SheetState {
  sheet: SheetKey;
  contextThreadId: string;
  notice: string;
}

export const sheetStore = createStore<SheetState>({
  sheet: null, contextThreadId: '', notice: '',
});

export function openSheet(sheet: Exclude<SheetKey, null>, contextThreadId = ''): void {
  sheetStore.setState({ sheet, contextThreadId, notice: '' });
}
export function closeSheet(): void {
  sheetStore.setState({ sheet: null, contextThreadId: '', notice: '' });
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
