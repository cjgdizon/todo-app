"use client";

import { validateAttachment } from "@todo/core";
import {
  formatBytes,
  useAttachmentDownloadUrl,
  useAttachments,
  useData,
  useDeleteAttachment,
  useMembers,
  useUploadAttachment,
  type Attachment,
} from "@todo/data";
import { useId, useRef, type ChangeEvent } from "react";
import { useToast } from "./toast";

/** Files attached to one task: list, download, add and remove. */
export function TaskAttachments({ taskId }: { taskId: string }) {
  const { userId } = useData();
  const attachments = useAttachments(taskId);
  const members = useMembers().data ?? [];
  const upload = useUploadAttachment(taskId);
  const remove = useDeleteAttachment(taskId);
  const downloadUrl = useAttachmentDownloadUrl();
  const { notify } = useToast();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const myRole = members.find((member) => member.userId === userId)?.role;
  const isAdmin = myRole === "owner" || myRole === "admin";

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (input.current) input.current.value = ""; // so the same file can be picked again
    if (!file) return;
    const problem = validateAttachment({ name: file.name, size: file.size });
    if (problem) {
      notify(problem, { tone: "error" });
      return;
    }
    upload.mutate(
      { name: file.name, type: file.type, size: file.size, body: file },
      { onError: () => notify("Couldn't upload that file. Check your connection and try again.", { tone: "error" }) },
    );
  }

  async function onDownload(attachment: Attachment) {
    try {
      window.location.assign(await downloadUrl(attachment));
    } catch {
      notify("Couldn't download that file. Check your connection and try again.", { tone: "error" });
    }
  }

  return (
    <section aria-label="Attachments">
      <h3 className="mb-1 text-sm font-medium">Attachments</h3>
      <ul className="divide-y divide-border">
        {(attachments.data ?? []).map((attachment) => (
          <li key={attachment.id} className="flex items-center gap-3 py-2 text-sm">
            <button
              type="button"
              onClick={() => void onDownload(attachment)}
              aria-label={`Download ${attachment.fileName}`}
              className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline"
            >
              {attachment.fileName}
            </button>
            <span className="shrink-0 text-text-muted">{formatBytes(attachment.sizeBytes)}</span>
            {attachment.createdBy === userId || isAdmin ? (
              <button
                type="button"
                onClick={() =>
                  remove.mutate(attachment, { onError: () => notify("Couldn't remove that file.", { tone: "error" }) })
                }
                aria-label={`Remove ${attachment.fileName}`}
                className="shrink-0 rounded-sm px-2 py-1 text-danger underline"
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
          Add a file (up to 10 MB)
        </label>
        <input ref={input} id={inputId} type="file" onChange={onPick} disabled={upload.isPending} className="block w-full text-sm" />
        <p role="status" className="mt-1 text-sm text-text-muted">
          {upload.isPending ? "Uploading…" : ""}
        </p>
      </div>
    </section>
  );
}
