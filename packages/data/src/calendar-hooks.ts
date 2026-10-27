import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useData } from "./hooks.ts";
import { disconnectCalendar, fetchCalendarIntegration, startCalendarConnection } from "./queries.ts";

/**
 * The person's Google Calendar connection. Connecting and disconnecting are server calls (they talk
 * to Google), so they need a connection and are never queued offline.
 */

export function useCalendarIntegration() {
  const { client, userId } = useData();
  return useQuery({
    queryKey: queryKeys.calendarIntegration(userId),
    queryFn: () => fetchCalendarIntegration(client),
  });
}

/** Resolves with the address of Google's consent screen; send the browser there. */
export function useStartCalendarConnection() {
  const { client, workspaceId } = useData();
  return useMutation({ mutationFn: () => startCalendarConnection(client, workspaceId) });
}

export function useDisconnectCalendar() {
  const { client, userId } = useData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (removeEvents: boolean) => disconnectCalendar(client, removeEvents),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.calendarIntegration(userId) }),
  });
}
