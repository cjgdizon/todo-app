"use client";

import { findMentions, splitMentions } from "@todo/core";
import {
  useAddComment,
  useComments,
  useData,
  useDeleteComment,
  useEditComment,
  useMembers,
  type Comment,
  type Member,
} from "@todo/data";
import { useId, useState, type FormEvent } from "react";
import { useToast } from "./toast";

const MAX_COMMENT_LENGTH = 10_000;
const field = "block w-full rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base text-text";

export function TaskComments({ taskId }: { taskId: string }) {
  const comments = useComments(taskId);
  const members = useMembers().data ?? [];
  const add = useAddComment(taskId);
  const { notify } = useToast();
  const inputId = useId();
  const [body, setBody] = useState("");
  const names = new Map(members.map((member) => [member.userId, member.displayName]));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    add.mutate(
      { id: crypto.randomUUID(), body: text, mentions: findMentions(text, members) },
      {
        onError: () => {
          setBody(text);
          notify("Couldn't post that comment. Try again.", { tone: "error" });
        },
      },
    );
  }

  return (
    <section aria-label="Comments">
      <h3 className="mb-1 text-sm font-medium">Comments</h3>
      {comments.isError ? (
        <p role="alert" className="text-sm text-danger">
          <span aria-hidden="true">⚠ </span>
          Couldn&apos;t load the comments.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {(comments.data ?? []).map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            taskId={taskId}
            author={names.get(comment.authorId ?? "")}
            members={members}
          />
        ))}
      </ul>
      <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
        <label htmlFor={inputId} className="sr-only">
          Add a comment
        </label>
        <textarea
          id={inputId}
          className={field}
          rows={2}
          placeholder="Add a comment. Use @name to mention someone."
          value={body}
          maxLength={MAX_COMMENT_LENGTH}
          onChange={(event) => setBody(event.target.value)}
        />
        <button
          type="submit"
          disabled={!body.trim()}
          className="self-end rounded-md px-3 py-2 text-accent-strong underline disabled:opacity-50"
        >
          Post comment
        </button>
      </form>
    </section>
  );
}

function CommentItem({
  comment,
  taskId,
  author,
  members,
}: {
  comment: Comment;
  taskId: string;
  author: string | undefined;
  members: readonly Member[];
}) {
  const { userId } = useData();
  const edit = useEditComment(taskId);
  const remove = useDeleteComment(taskId);
  const { notify } = useToast();
  const editId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const mine = comment.authorId === userId;
  const name = author ?? "Former member";

  function startEditing() {
    setDraft(comment.body);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(comment.body);
    setEditing(false);
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setEditing(false);
    if (text === comment.body) return;
    edit.mutate({ id: comment.id, body: text, mentions: findMentions(text, members) }, { onError: () => notify("Couldn't save that edit.", { tone: "error" }) });
  }

  return (
    <li className="py-2">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">{mine ? "You" : name}</span>
        <time dateTime={comment.createdAt.toISOString()} className="text-text-muted">
          {comment.createdAt.toLocaleString()}
        </time>
        {comment.editedAt ? <span className="text-text-muted">(edited)</span> : null}
      </div>
      {editing ? (
        <form onSubmit={onSave} className="mt-1 flex flex-col gap-2">
          <label htmlFor={editId} className="sr-only">
            Edit comment
          </label>
          <textarea
            id={editId}
            className={field}
            rows={2}
            autoFocus
            value={draft}
            maxLength={MAX_COMMENT_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation(); // keep Escape from closing the whole drawer
                cancelEditing();
              }
            }}
          />
          <div className="flex gap-3 self-end text-sm">
            <button type="button" className="underline" onClick={cancelEditing}>
              Cancel
            </button>
            <button type="submit" disabled={!draft.trim()} className="text-accent-strong underline disabled:opacity-50">
              Save
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words">
          {splitMentions(comment.body, members).map((part, index) =>
            part.userId ? (
              <strong key={index} className="font-semibold text-accent-strong">
                {part.text}
              </strong>
            ) : (
              part.text
            ),
          )}
        </p>
      )}
      {mine && !editing ? (
        <div className="mt-1 flex gap-3 text-sm text-text-muted">
          <button type="button" className="underline" onClick={startEditing}>
            Edit
          </button>
          <button
            type="button"
            className="underline"
            onClick={() =>
              remove.mutate(comment.id, { onError: () => notify("Couldn't delete that comment.", { tone: "error" }) })
            }
          >
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}
