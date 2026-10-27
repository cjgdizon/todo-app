import { useSyncExternalStore } from "react";

/**
 * Which workspace the user last chose, kept per user in this browser. It is only a preference:
 * `useBootstrap` falls back to the oldest workspace when it is missing or no longer valid.
 */

const keyFor = (userId: string) => `todo-active-workspace:${userId}`;
const listeners = new Set<() => void>();

export function readActiveWorkspace(userId: string): string | null {
  try {
    return localStorage.getItem(keyFor(userId));
  } catch {
    return null; // storage can be blocked (private windows); the default workspace is used then
  }
}

export function setActiveWorkspace(userId: string, workspaceId: string | null): void {
  try {
    if (workspaceId === null) localStorage.removeItem(keyFor(userId));
    else localStorage.setItem(keyFor(userId), workspaceId);
  } catch {
    // Not saved, so the choice lasts only until the page reloads.
  }
  for (const listener of listeners) listener();
}

export function subscribeActiveWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useActiveWorkspace(userId: string): string | null {
  return useSyncExternalStore(
    subscribeActiveWorkspace,
    () => readActiveWorkspace(userId),
    () => null,
  );
}
