"use client";

import type { OfflineFetch, OfflineState, RejectedWrite, TodoClient } from "@todo/data";
import { useEffect, useState } from "react";

/**
 * The browser's one offline write queue (see `createOfflineFetch` in @todo/data) and what the
 * UI needs from it. The queue only exists in the browser; on the server everything is a no-op.
 */

let queue: OfflineFetch | undefined;

type Listener<T> = (value: T) => void;
const rejectedListeners = new Set<Listener<RejectedWrite>>();
const conflictListeners = new Set<Listener<{ table: string; count: number }>>();

export function registerOfflineQueue(created: OfflineFetch): void {
  queue = created;
}

export function getOfflineQueue(): OfflineFetch | undefined {
  return queue;
}

export function emitRejected(write: RejectedWrite): void {
  for (const listener of rejectedListeners) listener(write);
}

export function emitConflict(conflict: { table: string; count: number }): void {
  for (const listener of conflictListeners) listener(conflict);
}

/** Calls `listener` for every stored write the server refused for good. */
export function onRejectedWrite(listener: Listener<RejectedWrite>): () => void {
  rejectedListeners.add(listener);
  return () => void rejectedListeners.delete(listener);
}

/** Calls `listener` when an offline edit overwrote rows another device changed meanwhile. */
export function onWriteConflict(listener: Listener<{ table: string; count: number }>): () => void {
  conflictListeners.add(listener);
  return () => void conflictListeners.delete(listener);
}

/** Signs out, first trying to save offline edits and asking before throwing away any that cannot be sent. */
export async function signOut(client: TodoClient): Promise<void> {
  if (queue && queue.pending() > 0) {
    await queue.flush();
    const left = queue.pending();
    if (left > 0 && !window.confirm(`${left} change(s) made offline are not saved yet and will be lost. Sign out anyway?`)) {
      return;
    }
  }
  await client.auth.signOut();
}

export interface SyncStatus extends OfflineState {
  online: boolean;
}

/** Whether the browser is online and how many offline edits still wait to be saved. */
export function useSyncStatus(): SyncStatus {
  const [online, setOnline] = useState(true);
  const [state, setState] = useState<OfflineState>({ pending: 0, flushing: false });

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!queue) return;
    setState({ pending: queue.pending(), flushing: false });
    return queue.subscribe(setState);
  }, []);

  return { online, ...state };
}
