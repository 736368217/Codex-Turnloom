/** Minimal external store built on React 18's useSyncExternalStore. */
import { useSyncExternalStore } from 'react';

export interface Store<T> {
  getState(): T;
  setState(patch: Partial<T> | ((prev: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(next) as (keyof T)[]) {
        if (!Object.is(state[key], next[key])) { changed = true; break; }
      }
      if (!changed) return;
      state = { ...state, ...next };
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Subscribe to the whole store (state is small; re-renders are cheap). */
export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Subscribe with a selector, with Object.is equality. */
export function useStoreSelector<T extends object, R>(store: Store<T>, selector: (state: T) => R): R {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
