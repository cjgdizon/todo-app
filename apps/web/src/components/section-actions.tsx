"use client";

import { useDeleteSection, useRenameSection, type Section } from "@todo/data";
import { useId, useRef, useState, type FormEvent } from "react";
import { useToast } from "./toast";

const dialogClass =
  "m-auto w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-6 text-text shadow-pop backdrop:bg-black/30";

/** Rename and delete for one board column. Deleting moves its tasks to "No section", with an Undo. */
export function SectionActions({ section, taskCount }: { section: Section; taskCount: number }) {
  const nameId = useId();
  const rename = useRenameSection();
  const remove = useDeleteSection();
  const { notify } = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(section.name);

  function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    dialog.current?.close();
    if (!next || next === section.name) return;
    rename.mutate(
      { id: section.id, name: next },
      { onError: () => notify("Couldn't rename that section. Try again.", { tone: "error" }) },
    );
  }

  async function onDelete() {
    try {
      const { undo } = await remove(section);
      notify(
        taskCount > 0
          ? `Deleted the section "${section.name}". Its tasks are now in No section.`
          : `Deleted the section "${section.name}".`,
        { action: { label: "Undo", run: undo } },
      );
    } catch {
      notify("Couldn't delete that section. Try again.", { tone: "error" });
    }
  }

  return (
    <div className="flex gap-1 text-sm">
      <button
        type="button"
        aria-label={`Rename section ${section.name}`}
        className="rounded-sm px-1 text-text-muted"
        onClick={() => {
          setName(section.name);
          dialog.current?.showModal();
        }}
      >
        Rename
      </button>
      <button
        type="button"
        aria-label={`Delete section ${section.name}`}
        className="rounded-sm px-1 text-danger"
        onClick={() => void onDelete()}
      >
        Delete
      </button>

      <dialog ref={dialog} aria-label={`Rename section ${section.name}`} className={dialogClass}>
        <form onSubmit={onRename} className="flex flex-col gap-4">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium">
              Section name
            </label>
            <input
              id={nameId}
              autoFocus
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              className="block w-full rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base"
            />
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
    </div>
  );
}
