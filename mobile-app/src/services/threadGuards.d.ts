export type SendRetryPayload = {
  threadId: string;
  message: string;
  mode: string;
  images?: Array<{ name: string; mimeType: string; data: string }>;
};
export function createRequestGate(): {
  issue(): number;
  isCurrent(ticket: number): boolean;
  invalidate(): void;
};
export function createRetryKey(makeId: () => string, now?: () => number, ttlMs?: number): {
  get(payload: SendRetryPayload): string;
  clear(): void;
};
