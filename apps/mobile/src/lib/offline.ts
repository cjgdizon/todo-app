import NetInfo from "@react-native-community/netinfo";
import { createOfflineFetch, type OfflineFetch, type OfflineState, type RejectedWrite } from "@todo/data";
import { onlineManager } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * The app's one offline write queue (see `createOfflineFetch` in @todo/data) and what the UI needs
 * from it. Connectivity comes from NetInfo, which also drives TanStack Query's online state.
 */

const STORAGE_KEY = "todo-offline-writes";

type Listener<T> = (value: T) => void;
const rejectedListeners = new Set<Listener<RejectedWrite>>();
const conflictListeners = new Set<Listener<{ table: string; count: number }>>();

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false && state.isInternetReachable !== false)),
);

export function createQueue(getAccessToken: () => Promise<string | null>): OfflineFetch {
  return createOfflineFetch({
    fetch: (input, init) => fetch(input, init),
    storage: localStorage,
    storageKey: STORAGE_KEY,
    getAccessToken,
    isOnline: () => onlineManager.isOnline(),
    onRejected: (write) => rejectedListeners.forEach((listener) => listener(write)),
    onConflict: (conflict) => conflictListeners.forEach((listener) => listener(conflict)),
  });
}

/** Calls `listener` for every stored write the server refused for good. */
export function onRejectedWrite(listener: Listener<RejectedWrite>): () => void {
  rejectedListeners.add(listener);
  return () => void rejectedListeners.delete(listener);
}

/** Calls `listener` when an offline edit replaced rows that changed elsewhere meanwhile. */
export function onWriteConflict(listener: Listener<{ table: string; count: number }>): () => void {
  conflictListeners.add(listener);
  return () => void conflictListeners.delete(listener);
}

export interface SyncStatus extends OfflineState {
  online: boolean;
}

/** Whether the phone is online and how many offline edits still wait to be saved. */
export function useSyncStatus(queue: OfflineFetch | undefined): SyncStatus {
  const [online, setOnline] = useState(onlineManager.isOnline());
  const [state, setState] = useState<OfflineState>({ pending: queue?.pending() ?? 0, flushing: false });

  useEffect(() => onlineManager.subscribe(setOnline), []);
  useEffect(() => {
    if (!queue) return;
    setState({ pending: queue.pending(), flushing: false });
    return queue.subscribe(setState);
  }, [queue]);

  return { online, ...state };
}
