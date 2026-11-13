/** Global singleton bottom-sheet state. No centered modal or fake approval. */
import { createStore, useStore } from './store';
import { safeExternalUrl } from '../lib/externalUrl';

export type SheetKey = 'newTask' | 'harness' | 'diagnostics' | 'disconnect' | 'link' | null;

export interface SheetState {
  sheet: SheetKey;
  contextThreadId: string;
  linkUrl: string;
  notice: string;
}

export const sheetStore = createStore<SheetState>({
  sheet: null, contextThreadId: '', linkUrl: '', notice: '',
});

export function openSheet(sheet: Exclude<SheetKey, null>, contextThreadId = ''): void {
  sheetStore.setState({ sheet, contextThreadId, linkUrl: '', notice: '' });
}
export function openLinkSheet(value: string): void {
  const linkUrl = safeExternalUrl(value);
  if (linkUrl) sheetStore.setState({ sheet: 'link', contextThreadId: '', linkUrl, notice: '' });
}
export function closeSheet(): void {
  sheetStore.setState({ sheet: null, contextThreadId: '', linkUrl: '', notice: '' });
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
