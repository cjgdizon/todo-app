import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useData } from "./hooks.ts";
import type { Attachment } from "./models.ts";
import { attachmentDownloadUrl, fetchAttachments, removeAttachment, uploadAttachment } from "./queries.ts";

/**
 * Files attached to a task. Uploading and downloading need a connection (file bytes are never
 * queued offline); removing hides the record at once and rolls back if the server refuses.
 */

export function useAttachments(taskId: string) {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.attachments(workspaceId, taskId),
    queryFn: (): Promise<Attachment[]> => fetchAttachments(client, workspaceId, taskId),
  });
}

/** The input is whatever the platform gives: a browser `File`, or bytes read from a phone's picker. */
export interface FileToAttach {
  name: string;
  type: string;
  size: number;
  body: Blob | ArrayBuffer;
}

export function useUploadAttachment(taskId: string) {
  const { client, workspaceId, userId } = useData();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: FileToAttach) =>
      uploadAttachment(client, {
        id: crypto.randomUUID(),
        workspaceId,
        taskId,
        userId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        body: file.body,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.attachments(workspaceId, taskId) }),
  });
}

export function useDeleteAttachment(taskId: string) {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.attachments(workspaceId, taskId);

  return useMutation({
    mutationFn: (attachment: Attachment) => removeAttachment(client, attachment),
    onMutate: async (attachment) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Attachment[]>(key);
      queryClient.setQueryData<Attachment[]>(key, (list) => list?.filter((item) => item.id !== attachment.id));
      return { previous };
    },
    onError: (_error, _attachment, context) => {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Makes a one-minute download link for an attachment. */
export function useAttachmentDownloadUrl(): (attachment: Attachment) => Promise<string> {
  const { client } = useData();
  return (attachment) => attachmentDownloadUrl(client, attachment);
}
