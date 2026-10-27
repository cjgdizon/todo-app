import { countByDay, currentStreak, minutesByDay } from "@todo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useData, useTasks } from "./hooks.ts";
import type { TimeEntry } from "./models.ts";
import { fetchTimeEntries, insertTimeEntry, updateTimeEntry } from "./queries.ts";

/**
 * The signed-in user's tracked time. Starting and stopping are plain writes with client-made ids
 * and times, so they work offline and replay in order. There is at most one running timer per
 * person (a database rule), so starting a timer stops the running one first.
 */

const HISTORY_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

export function useTimeEntries() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.timeEntries(workspaceId),
    queryFn: () => fetchTimeEntries(client, workspaceId, new Date(Date.now() - HISTORY_DAYS * DAY_MS)),
  });
}

/** The timer that is running now, if any. */
export function useRunningTimer(): TimeEntry | undefined {
  return useTimeEntries().data?.find((entry) => entry.endedAt === null);
}

function useTimeEntriesCache() {
  const { workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.timeEntries(workspaceId);

  return {
    async apply(update: (entries: TimeEntry[]) => TimeEntry[]) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TimeEntry[]>(key);
      queryClient.setQueryData<TimeEntry[]>(key, (entries) => update(entries ?? []));
      return { previous };
    },
    rollback(context: { previous: TimeEntry[] | undefined } | undefined) {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    settle: () => queryClient.invalidateQueries({ queryKey: key }),
  };
}

/** Ends the running timer, if there is one, at `at`. */
const stopped = (entries: TimeEntry[], at: Date): TimeEntry[] =>
  entries.map((entry) => (entry.endedAt === null ? { ...entry, endedAt: at } : entry));

export function useStartTimer() {
  const { client, workspaceId, userId } = useData();
  const cache = useTimeEntriesCache();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, taskId, at }: { id: string; taskId: string; at: Date }) => {
      const running = queryClient
        .getQueryData<TimeEntry[]>(queryKeys.timeEntries(workspaceId))
        ?.find((entry) => entry.endedAt === null && entry.id !== id);
      // Stop first: the database allows one running timer per person.
      if (running) await updateTimeEntry(client, running.id, { endedAt: at });
      await insertTimeEntry(client, { id, workspaceId, taskId, userId, startedAt: at });
    },
    onMutate: ({ id, taskId, at }) =>
      cache.apply((entries) => [{ id, taskId, startedAt: at, endedAt: null }, ...stopped(entries, at)]),
    onError: (_error, _variables, context) => cache.rollback(context),
    onSettled: cache.settle,
  });
}

export function useStopTimer() {
  const { client } = useData();
  const cache = useTimeEntriesCache();

  return useMutation({
    mutationFn: ({ id, at }: { id: string; at: Date }) => updateTimeEntry(client, id, { endedAt: at }),
    onMutate: ({ at }) => cache.apply((entries) => stopped(entries, at)),
    onError: (_error, _variables, context) => cache.rollback(context),
    onSettled: cache.settle,
  });
}

/** Tasks completed and minutes tracked on each of the last `days` days, and the current streak. */
export function useStats(days: number) {
  const { timeZone } = useData();
  const tasks = useTasks().data ?? [];
  const entries = useTimeEntries().data ?? [];
  const now = new Date();
  const completed = countByDay(
    tasks.flatMap((task) => (task.completedAt ? [task.completedAt] : [])),
    now,
    timeZone,
    days,
  );
  return { completed, tracked: minutesByDay(entries, now, timeZone, days), streak: currentStreak(completed) };
}
