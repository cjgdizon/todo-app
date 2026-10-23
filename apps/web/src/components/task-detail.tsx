"use client";

import { descendantIds, instantToLocal, localToInstant } from "@todo/core";
import {
  useCompleteTask,
  useCreateTask,
  useData,
  useLabels,
  useProjects,
  useSections,
  useTasks,
  useTrashTask,
  useUpdateTask,
  type Task,
  type TaskChange,
} from "@todo/data";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { describeRecurrence, presetFor, presetRule, PRESETS, type PresetValue } from "@/lib/recurrence-text";
import { useTaskSelection } from "@/lib/use-task-selection";
import { CheckIcon, CloseIcon, SubtaskIcon, TrashIcon } from "./icons";
import { useToast } from "./toast";

const PRIORITY_LABELS: Record<number, string> = {
  1: "P1 · Highest",
  2: "P2 · High",
  3: "P3 · Medium",
  4: "P4 · None",
};

const control =
  "block w-full rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base text-text disabled:opacity-60";

/** Opens when the URL has `?task=<id>`. Rendered once by the app shell. */
export function TaskDetail() {
  const { selectedId, close } = useTaskSelection();
  const tasks = useTasks();
  const task = selectedId ? tasks.data?.find((t) => t.id === selectedId) : undefined;

  // The task was deleted (or never existed): drop the stale link.
  useEffect(() => {
    if (selectedId && tasks.isSuccess && !task) close();
  }, [selectedId, tasks.isSuccess, task, close]);

  if (!task) return null;
  return <Drawer key={task.id} task={task} onClose={close} />;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function Drawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const { timeZone } = useData();
  const allTasks = useTasks().data ?? [];
  const projects = useProjects().data ?? [];
  const labels = useLabels().data ?? [];
  const sections = useSections().data ?? [];
  const projectSections = sections.filter((section) => section.projectId === task.projectId);
  const update = useUpdateTask();
  const completeTask = useCompleteTask();
  const trashTask = useTrashTask();
  const { create } = useCreateTask();
  const { notify } = useToast();
  const selection = useTaskSelection();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  // The task can change under the open drawer (restored from the saved cache, then refreshed; or edited
  // on another device). A field the user has not touched follows the new value; one being edited stays.
  const [synced, setSynced] = useState({ title: task.title, notes: task.notes ?? "" });
  if (synced.title !== task.title || synced.notes !== (task.notes ?? "")) {
    if (title === synced.title) setTitle(task.title);
    if (notes === synced.notes) setNotes(task.notes ?? "");
    setSynced({ title: task.title, notes: task.notes ?? "" });
  }
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  // Move focus into the drawer, and give it back to whatever opened it on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const save = (change: TaskChange, alsoIds?: readonly string[]) =>
    update.mutate(
      { id: task.id, change, ...(alsoIds ? { alsoIds } : {}) },
      { onError: () => notify("Couldn't save that change. Try again.", { tone: "error" }) },
    );

  const local = task.dueAt ? instantToLocal(task.dueAt, timeZone) : null;
  const subtasks = allTasks.filter((t) => t.parentId === task.id).sort((a, b) => (a.position < b.position ? -1 : 1));
  const parent = task.parentId ? allTasks.find((t) => t.id === task.parentId) : undefined;

  function setDue(date: string, time: string) {
    if (!date) {
      save({ dueAt: null, dueAllDay: false, dueTz: null, rrule: null, recurAfterCompletion: false });
      return;
    }
    const instant = localToInstant(date, time || null, timeZone);
    if (instant) save({ dueAt: instant, dueAllDay: !time, dueTz: timeZone });
  }

  function setRepeat(value: PresetValue) {
    const rule = presetRule(value);
    save({ rrule: rule, dueTz: timeZone, ...(rule ? {} : { recurAfterCompletion: false }) });
  }

  function setProject(projectId: string | null) {
    // A parent and its subtasks change project together, in one statement. The board column
    // belongs to the old project, so it is cleared.
    save({ projectId, sectionId: null }, descendantIds(allTasks, task.id));
  }

  function toggleLabel(labelId: string, on: boolean) {
    save({ labelIds: on ? [...task.labelIds, labelId] : task.labelIds.filter((id) => id !== labelId) });
  }

  async function addSubtask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = subtaskTitle.trim();
    if (!text) return;
    setSubtaskTitle("");
    try {
      await create({
        title: text,
        priority: 4,
        projectId: task.projectId,
        parentId: task.id,
        labelIds: [],
        newLabelNames: [],
        unknownProject: null,
        dueAt: null,
        dueAllDay: false,
        dueTz: null,
        rrule: null,
        recurAfterCompletion: false,
      });
    } catch {
      setSubtaskTitle(text);
      notify("Couldn't add the subtask. Subtasks can be nested up to 5 levels deep.", { tone: "error" });
    }
  }

  async function completeSubtask(sub: Task) {
    try {
      const outcome = await completeTask(sub);
      notify(outcome.kind === "advance" ? "Done. Moved to the next date." : "Subtask completed.", {
        action: { label: "Undo", run: outcome.undo },
      });
    } catch {
      notify("Couldn't update that subtask. Try again.", { tone: "error" });
    }
  }

  async function remove() {
    try {
      const { count, undo } = await trashTask(task);
      onClose();
      notify(count > 1 ? `Deleted "${task.title}" and its subtasks.` : `Deleted "${task.title}".`, {
        action: { label: "Undo", run: undo },
      });
    } catch {
      notify("Couldn't delete that task. Try again.", { tone: "error" });
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      {/* Below the desktop breakpoint the drawer covers the page; clicking outside closes it. */}
      <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" aria-hidden="true" onClick={onClose} />
      <aside
        role="dialog"
        aria-label="Task details"
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-pop sm:w-[420px]"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          {parent ? (
            <button
              type="button"
              onClick={() => selection.open(parent.id)}
              className="inline-flex items-center gap-1 text-sm text-accent-strong underline"
            >
              <SubtaskIcon width={14} height={14} />
              Subtask of {parent.title}
            </button>
          ) : (
            <h2 className="text-sm font-medium text-text-muted">Task details</h2>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details"
            className="flex size-8 items-center justify-center rounded-sm text-text-muted"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-4">
          <Field label="Title" htmlFor="task-title">
            <input
              ref={titleRef}
              id="task-title"
              className={control}
              value={title}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                const next = title.trim();
                if (next && next !== task.title) save({ title: next });
                else setTitle(task.title);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </Field>

          <Field label="Notes" htmlFor="task-notes">
            <textarea
              id="task-notes"
              className={`${control} min-h-24`}
              value={notes}
              maxLength={50000}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                const next = notes.trim() === "" ? null : notes;
                if (next !== task.notes) save({ notes: next });
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date" htmlFor="task-due-date">
              <input
                id="task-due-date"
                type="date"
                className={control}
                value={local?.date ?? ""}
                onChange={(event) => setDue(event.target.value, task.dueAllDay ? "" : (local?.time ?? ""))}
              />
            </Field>
            <Field label="Time (optional)" htmlFor="task-due-time">
              <input
                id="task-due-time"
                type="time"
                className={control}
                disabled={!local}
                value={local && !task.dueAllDay ? local.time : ""}
                onChange={(event) => local && setDue(local.date, event.target.value)}
              />
            </Field>
          </div>

          <Field label="Repeat" htmlFor="task-repeat">
            <select
              id="task-repeat"
              className={control}
              disabled={!task.dueAt}
              value={presetFor(task.rrule)}
              onChange={(event) => setRepeat(event.target.value as PresetValue)}
            >
              {PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              {task.rrule && presetFor(task.rrule) === "custom" && (
                <option value="custom">{describeRecurrence(task.rrule, task.recurAfterCompletion)}</option>
              )}
            </select>
            {!task.dueAt && <p className="mt-1 text-sm text-text-muted">Set a due date to repeat this task.</p>}
            {task.rrule && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={task.recurAfterCompletion}
                  onChange={(event) => save({ recurAfterCompletion: event.target.checked })}
                />
                Repeat after completion
              </label>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority" htmlFor="task-priority">
              <select
                id="task-priority"
                className={control}
                value={task.priority}
                onChange={(event) => save({ priority: Number(event.target.value) as Task["priority"] })}
              >
                {[1, 2, 3, 4].map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project" htmlFor="task-project">
              <select
                id="task-project"
                className={control}
                disabled={task.parentId !== null}
                value={task.projectId ?? ""}
                onChange={(event) => setProject(event.target.value || null)}
              >
                <option value="">Inbox</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {task.parentId !== null && (
            <p className="-mt-3 text-sm text-text-muted">A subtask stays in its parent&apos;s project.</p>
          )}

          {task.projectId !== null && task.parentId === null && projectSections.length > 0 && (
            <Field label="Section" htmlFor="task-section">
              <select
                id="task-section"
                className={control}
                value={task.sectionId ?? ""}
                onChange={(event) => save({ sectionId: event.target.value || null })}
              >
                <option value="">No section</option>
                {projectSections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Labels</legend>
            {labels.length === 0 ? (
              <p className="text-sm text-text-muted">No labels yet. Add one with @name when you add a task.</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {labels.map((label) => (
                  <label key={label.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={task.labelIds.includes(label.id)}
                      onChange={(event) => toggleLabel(label.id, event.target.checked)}
                    />
                    {label.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <section aria-label="Subtasks">
            <h3 className="mb-1 text-sm font-medium">Subtasks</h3>
            <ul>
              {subtasks.map((sub) => (
                <li key={sub.id} className="flex items-center gap-2 py-1">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={sub.completedAt !== null}
                    aria-label={`Complete: ${sub.title}`}
                    onClick={() => void completeSubtask(sub)}
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      sub.completedAt ? "border-accent bg-accent text-on-accent" : "border-text-muted text-transparent"
                    }`}
                  >
                    <CheckIcon width={12} height={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => selection.open(sub.id)}
                    className={`text-left ${sub.completedAt ? "text-text-muted line-through opacity-60" : ""}`}
                  >
                    {sub.title}
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={addSubtask} className="mt-2 flex gap-2">
              <label htmlFor="subtask-title" className="sr-only">
                Add a subtask
              </label>
              <input
                id="subtask-title"
                className={control}
                placeholder="Add a subtask"
                value={subtaskTitle}
                maxLength={500}
                onChange={(event) => setSubtaskTitle(event.target.value)}
              />
              <button type="submit" className="rounded-md px-3 py-2 text-accent-strong underline" disabled={!subtaskTitle.trim()}>
                Add
              </button>
            </form>
          </section>

          <button
            type="button"
            onClick={() => void remove()}
            className="inline-flex items-center gap-2 self-start rounded-md px-3 py-2 text-danger"
          >
            <TrashIcon />
            Delete task
          </button>
        </div>
      </aside>
    </>
  );
}
