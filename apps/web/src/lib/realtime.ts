"use client";

import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, type TodoClient } from "@todo/data";
import { useEffect } from "react";

const DEBOUNCE_MS = 300;

/** Which cached lists a change to each table makes stale (a label link changes the task's labels). */
const TABLES = [
  ["tasks", ["tasks"]],
  ["task_labels", ["tasks"]],
  ["projects", ["projects", "tasks"]],
  ["sections", ["sections", "tasks"]],
  ["labels", ["labels", "tasks"]],
  ["saved_filters", ["savedFilters"]],
] as const;

/**
 * Keeps the open lists current when the workspace changes elsewhere (another tab, device or
 * member). A change only marks lists stale and they refetch, so the offline queue and the
 * normal read path stay the one way data comes in. Events missed while disconnected are not
 * replayed, so every reconnect refreshes everything.
 */
export function useRealtimeSync(client: TodoClient, workspaceId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;
    const stale = new Set<(typeof TABLES)[number][1][number]>();
    let timer: number | undefined;

    const flushStale = () => {
      timer = undefined;
      for (const name of stale) void queryClient.invalidateQueries({ queryKey: queryKeys[name](workspaceId) });
      stale.clear();
    };

    let channel = client.channel(`workspace:${workspaceId}`);
    for (const [table, lists] of TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` },
        () => {
          for (const name of lists) stale.add(name);
          timer ??= window.setTimeout(flushStale, DEBOUNCE_MS);
        },
      );
    }

    let connectedBefore = false;
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (connectedBefore) void queryClient.invalidateQueries();
      connectedBefore = true;
    });

    return () => {
      window.clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [client, workspaceId, queryClient]);
}
