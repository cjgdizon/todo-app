import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useData } from "./hooks.ts";
import type { Comment, Invite, Member, Membership, WorkspaceRole } from "./models.ts";
import {
  acceptInvite,
  createInvite,
  fetchComments,
  fetchInvites,
  fetchMembers,
  fetchMemberships,
  insertComment,
  removeMember,
  revokeInvite,
  updateComment,
  updateMemberRole,
} from "./queries.ts";

/**
 * Shared hooks for working with other people: workspaces, members, invites and comments.
 * Assigning a task needs no hook of its own: `useUpdateTask` takes `assigneeId`.
 */

type Assignable = Exclude<WorkspaceRole, "owner">;

/** Every workspace the user belongs to; feeds the workspace switcher. */
export function useMemberships() {
  const { client, userId } = useData();
  return useQuery({
    queryKey: queryKeys.memberships(userId),
    queryFn: (): Promise<Membership[]> => fetchMemberships(client, userId),
  });
}

export function useMembers() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.members(workspaceId),
    queryFn: (): Promise<Member[]> => fetchMembers(client, workspaceId),
  });
}

export function useSetMemberRole() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.members(workspaceId);

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Assignable }) =>
      updateMemberRole(client, workspaceId, userId, role),
    onMutate: async ({ userId, role }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Member[]>(key);
      queryClient.setQueryData<Member[]>(key, (members) =>
        members?.map((member) => (member.userId === userId ? { ...member, role } : member)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Removes someone from the workspace, or (for yourself) leaves it. */
export function useRemoveMember() {
  const { client, workspaceId, userId: me } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.members(workspaceId);

  return useMutation({
    mutationFn: (userId: string) => removeMember(client, workspaceId, userId),
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Member[]>(key);
      queryClient.setQueryData<Member[]>(key, (members) => members?.filter((member) => member.userId !== userId));
      return { previous };
    },
    onError: (_error, _userId, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: async (_data, _error, userId) => {
      await queryClient.invalidateQueries({ queryKey: key });
      if (userId === me) await queryClient.invalidateQueries({ queryKey: queryKeys.memberships(me) });
    },
  });
}

/** Pending invites; empty for anyone who is not an admin. */
export function useInvites() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.invites(workspaceId),
    queryFn: (): Promise<Invite[]> => fetchInvites(client, workspaceId),
  });
}

/** Resolves with the invite token. It cannot be read again, so show it right away. */
export function useCreateInvite() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: Assignable) => createInvite(client, workspaceId, role),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.invites(workspaceId) }),
  });
}

export function useRevokeInvite() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.invites(workspaceId);

  return useMutation({
    mutationFn: (inviteId: string) => revokeInvite(client, inviteId),
    onMutate: async (inviteId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Invite[]>(key);
      queryClient.setQueryData<Invite[]>(key, (invites) => invites?.filter((invite) => invite.id !== inviteId));
      return { previous };
    },
    onError: (_error, _inviteId, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Resolves with the id of the workspace that was joined. */
export function useAcceptInvite() {
  const { client, userId } = useData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => acceptInvite(client, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.memberships(userId) }),
  });
}

export function useComments(taskId: string) {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.comments(workspaceId, taskId),
    queryFn: (): Promise<Comment[]> => fetchComments(client, workspaceId, taskId),
  });
}

/** Optimistic list updates for one task's comments, shared by add, edit and delete. */
function useCommentsCache(taskId: string) {
  const { workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.comments(workspaceId, taskId);

  return {
    async apply(update: (comments: Comment[]) => Comment[]) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Comment[]>(key);
      queryClient.setQueryData<Comment[]>(key, (comments) => (comments ? update(comments) : comments));
      return { previous };
    },
    rollback(context: { previous: Comment[] | undefined } | undefined) {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    settle: () => queryClient.invalidateQueries({ queryKey: key }),
  };
}

export function useAddComment(taskId: string) {
  const { client, workspaceId, userId } = useData();
  const cache = useCommentsCache(taskId);

  return useMutation({
    mutationFn: (variables: { id: string; body: string }) =>
      insertComment(client, { id: variables.id, workspaceId, taskId, authorId: userId, body: variables.body }),
    onMutate: ({ id, body }) =>
      cache.apply((comments) => [
        ...comments,
        { id, taskId, authorId: userId, body, editedAt: null, createdAt: new Date() },
      ]),
    onError: (_error, _variables, context) => cache.rollback(context),
    onSettled: cache.settle,
  });
}

/** Only the author can edit; the database refuses anyone else. */
export function useEditComment(taskId: string) {
  const { client } = useData();
  const cache = useCommentsCache(taskId);

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => updateComment(client, id, { body }),
    onMutate: ({ id, body }) =>
      cache.apply((comments) =>
        comments.map((comment) => (comment.id === id ? { ...comment, body, editedAt: new Date() } : comment)),
      ),
    onError: (_error, _variables, context) => cache.rollback(context),
    onSettled: cache.settle,
  });
}

/** Soft delete; only the author can do it. */
export function useDeleteComment(taskId: string) {
  const { client } = useData();
  const cache = useCommentsCache(taskId);

  return useMutation({
    mutationFn: (id: string) => updateComment(client, id, { deletedAt: new Date() }),
    onMutate: (id) => cache.apply((comments) => comments.filter((comment) => comment.id !== id)),
    onError: (_error, _id, context) => cache.rollback(context),
    onSettled: cache.settle,
  });
}
