"use client";

import { useSyncStatus } from "@/lib/offline";

/** A quiet bar that says when edits are only on this device (offline) or still being sent. */
export function SyncStatus() {
  const { online, pending } = useSyncStatus();
  if (online && pending === 0) return null;

  const waiting = pending > 0 ? ` ${pending} ${pending === 1 ? "change is" : "changes are"} waiting to sync.` : "";
  return (
    <div role="status" className="border-b border-border bg-surface-subtle px-4 py-2 text-sm text-text-muted">
      {online
        ? `Syncing…${waiting}`
        : `You're offline. Changes are saved on this device and sync when you reconnect.${waiting}`}
    </div>
  );
}
