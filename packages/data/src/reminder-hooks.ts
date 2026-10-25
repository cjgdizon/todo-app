import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useData } from "./hooks.ts";
import type { Reminder } from "./models.ts";
import { clearTaskReminder, fetchReminders, setTaskReminder } from "./queries.ts";

/**
 * The signed-in user's reminders. Setting one is a server call (the database works out the time
 * and refuses one that has already passed), so it needs a connection and is not queued offline;
 * the lists still update at once and roll back with the error if the server says no.
 */

export function useReminders() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.reminders(workspaceId),
    queryFn: (): Promise<Reminder[]> => fetchReminders(client, workspaceId),
  });
}

function useRemindersCache() {
  const { workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.reminders(workspaceId);

  return {
    async apply(update: (reminders: Reminder[]) => Reminder[]) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Reminder[]>(key);
      queryClient.setQueryData<Reminder[]>(key, (reminders) => update(reminders ?? []));
      return { previous };
    },
    rollback(context: { previous: Reminder[] | undefined } | undefined) {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    settle: () => queryClient.invalidateQueries({ queryKey: key }),
  };
}

export function useSetReminder() {
  const { client } = useData();
  const cache = useRemindersCache();

  return useMutation({
    mutationFn: ({ taskId, offsetMin }: { taskId: string; offsetMin: number }) =>
      setTaskReminder(client, taskId, offsetMin),
    // The real time arrives with the refetch; until then only the offset matters.
    onMutate: ({ taskId, offsetMin }) =>
      cache.apply((reminders) => [
        ...reminders.filter((reminder) => reminder.taskId !== taskId),
        { taskId, offsetMin, remindAt: new Date(), sent: false },
      ]),
    onError: (_error, _variables, context) => cache.rollback(context),
    onSettled: cache.settle,
  });
}

export function useClearReminder() {
  const { client } = useData();
  const cache = useRemindersCache();

  return useMutation({
    mutationFn: (taskId: string) => clearTaskReminder(client, taskId),
    onMutate: (taskId) => cache.apply((reminders) => reminders.filter((reminder) => reminder.taskId !== taskId)),
    onError: (_error, _taskId, context) => cache.rollback(context),
    onSettled: cache.settle,
  });
}
