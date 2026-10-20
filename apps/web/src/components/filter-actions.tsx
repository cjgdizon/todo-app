"use client";

import { parseFilter } from "@todo/core";
import { useCreateSavedFilter, useDeleteSavedFilter, type SavedFilter } from "@todo/data";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { useToast } from "./toast";

const dialogClass =
  "m-auto w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-6 text-text shadow-pop backdrop:bg-black/30";

const MAX_NAME_LENGTH = 100;

function isValidFilter(query: string): boolean {
  if (query.trim() === "") return false;
  try {
    parseFilter(query);
    return true;
  } catch {
    return false;
  }
}

/** On the search page: names the current search and saves it to the sidebar. */
export function SaveFilterButton({ query }: { query: string }) {
  const nameId = useId();
  const router = useRouter();
  const save = useCreateSavedFilter();
  const { notify } = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    dialog.current?.close();
    try {
      const filter = await save(trimmed, query);
      router.push(`/filter/${filter.id}`);
    } catch {
      notify("Couldn't save that filter. Try again.", { tone: "error" });
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!isValidFilter(query)}
        onClick={() => {
          setName(query.trim().slice(0, MAX_NAME_LENGTH));
          dialog.current?.showModal();
        }}
        className="rounded-sm px-2 py-1 text-sm text-accent-strong underline disabled:text-text-muted disabled:no-underline"
      >
        Save filter
      </button>

      <dialog ref={dialog} aria-label="Save filter" className={dialogClass}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium">
              Filter name
            </label>
            <input
              id={nameId}
              autoFocus
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              className="block w-full rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base"
            />
            <p className="mt-2 text-sm text-text-muted">Saves the search &quot;{query.trim()}&quot;.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md px-4 py-2" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent">
              Save
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** On a saved filter's page: delete it, with an Undo. */
export function DeleteFilterButton({ filter }: { filter: SavedFilter }) {
  const router = useRouter();
  const remove = useDeleteSavedFilter();
  const { notify } = useToast();

  async function onDelete() {
    try {
      const { undo } = await remove(filter);
      router.replace("/search");
      notify(`Deleted the filter "${filter.name}".`, {
        action: {
          label: "Undo",
          run: async () => {
            await undo();
            router.push(`/filter/${filter.id}`);
          },
        },
      });
    } catch {
      notify("Couldn't delete that filter. Try again.", { tone: "error" });
    }
  }

  return (
    <button type="button" onClick={() => void onDelete()} className="rounded-sm px-2 py-1 text-sm text-danger">
      Delete
    </button>
  );
}
