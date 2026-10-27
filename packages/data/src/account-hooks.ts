import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useData } from "./hooks.ts";
import { deleteAccount, fetchDeletionBlockers, transferWorkspace } from "./queries.ts";

export { DELETE_ACCOUNT_CONFIRMATION } from "./queries.ts";

/**
 * Leaving the app for good. Deleting an account and handing over a workspace are server calls, so
 * they need a connection and are never queued offline.
 */

/** The shared workspaces the person still owns; deleting the account is possible once this is empty. */
export function useDeletionBlockers() {
  const { client, userId } = useData();
  return useQuery({
    queryKey: queryKeys.deletionBlockers(userId),
    queryFn: () => fetchDeletionBlockers(client),
  });
}

export function useDeleteAccount() {
  const { client } = useData();
  return useMutation({ mutationFn: (confirmation: string) => deleteAccount(client, confirmation) });
}

/** Makes another member the owner of the current workspace. */
export function useTransferWorkspace() {
  const { client, workspaceId, userId } = useData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newOwnerId: string) => transferWorkspace(client, workspaceId, newOwnerId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.deletionBlockers(userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.memberships(userId) });
    },
  });
}
