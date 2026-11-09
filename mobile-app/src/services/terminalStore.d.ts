export interface StoredTerminal {
  id: string;
  serverUrl: string;
  token: string;
  machineName: string;
  cacheVersion: number;
}
export interface TerminalConfig {
  serverUrl: string;
  token: string;
  machineName: string;
}
export interface TerminalSnapshot {
  terminals: StoredTerminal[];
  activeId: string | null;
}
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface TerminalStore {
  read(): Promise<TerminalSnapshot>;
  upsert(input: TerminalConfig, options?: { id?: string; activate?: boolean }): Promise<StoredTerminal>;
  activate(id: string): Promise<StoredTerminal>;
  remove(id: string): Promise<void>;
}
export function createTerminalStore(storage: StorageAdapter, normalizeUrl: (raw: string) => string, makeId: () => string): TerminalStore;
