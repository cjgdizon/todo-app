"use client";

import { useDeleteProject, useRenameProject, useTasks, type Project } from "@todo/data";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useToast } from "./toast";

const dialogClass =
  "m-auto w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-6 text-text shadow-pop backdrop:bg-black/30";

/** Rename and delete for a project. Both use native dialogs, which trap focus and restore it on close. */
export function ProjectActions({ project }: { project: Project }) {
  const router = useRouter();
  const rename = useRenameProject();
  const remove = useDeleteProject();
  const tasks = useTasks().data ?? [];
  const { notify } = useToast();
  const renameDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);

  const taskCount = tasks.filter((t) => t.projectId === project.id).length;

  function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    renameDialog.current?.close();
    if (!next || next === project.name) return;
    rename.mutate(
      { id: project.id, name: next },
      { onError: () => notify("Couldn't rename that project. Try again.", { tone: "error" }) },
    );
  }

  async function onDelete() {
    deleteDialog.current?.close();
    try {
      await remove.mutateAsync(project.id);
      router.replace("/inbox");
      notify(`Deleted the project "${project.name}".`);
    } catch {
      notify("Couldn't delete that project. Try again.", { tone: "error" });
    }
  }

  return (
    <div className="flex gap-1 text-sm">
      <button
        type="button"
        className="rounded-sm px-2 py-1 text-text-muted"
        onClick={() => {
          setName(project.name);
          renameDialog.current?.showModal();
        }}
      >
        Rename
      </button>
      <button type="button" className="rounded-sm px-2 py-1 text-danger" onClick={() => deleteDialog.current?.showModal()}>
        Delete
      </button>

      <dialog ref={renameDialog} aria-label="Rename project" className={dialogClass}>
        <form onSubmit={onRename} className="flex flex-col gap-4">
          <div>
            <label htmlFor="rename-project" className="mb-1 block text-sm font-medium">
              Project name
            </label>
            <input
              id="rename-project"
              autoFocus
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              className="block w-full rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md px-4 py-2" onClick={() => renameDialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent">
              Save
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={deleteDialog} aria-label="Delete project" className={dialogClass}>
        <h2 className="text-[20px] leading-7 font-semibold">Delete this project?</h2>
        <p className="mt-2 text-text-muted">
          &quot;{project.name}&quot; and its {taskCount === 1 ? "1 task" : `${taskCount} tasks`} will move to the trash.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="rounded-md px-4 py-2" onClick={() => deleteDialog.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md border border-danger px-4 py-2 font-medium text-danger"
            onClick={() => void onDelete()}
          >
            Delete project
          </button>
        </div>
      </dialog>
    </div>
  );
}
