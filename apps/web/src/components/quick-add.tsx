"use client";

import { parseQuickAdd } from "@todo/core";
import { taskInputFromQuickAdd, useCreateTask, useData, useLabels, useProjects } from "@todo/data";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { formatDue } from "@todo/data";
import { describeRecurrence } from "@todo/data";
import { FlagIcon, HashIcon, PlusIcon, RepeatIcon, TagIcon, TodayIcon } from "./icons";
import { useToast } from "./toast";

export interface QuickAddDefaults {
  /** Where a task goes when the text names no `#project`. */
  projectId: string | null;
  /** A label every new task gets (the label view). */
  labelId: string | null;
  /** Give a task without a date today's date (the Today view). */
  dueToday: boolean;
}

/**
 * Focuses the quick-add box on the page the user is looking at. Pages visited earlier stay
 * mounted but hidden, so an element id would not be unique; pick the visible input instead.
 */
export function focusQuickAdd(): boolean {
  const inputs = document.querySelectorAll<HTMLInputElement>("[data-quick-add]");
  const visible = [...inputs].find((input) => input.checkVisibility());
  visible?.focus();
  return visible !== undefined;
}

export function QuickAdd({ defaults }: { defaults: QuickAddDefaults }) {
  const inputId = useId();
  const previewId = useId();
  const { timeZone } = useData();
  const projects = useProjects();
  const labels = useLabels();
  const { create } = useCreateTask();
  const { notify } = useToast();
  const [text, setText] = useState("");

  const parsed = useMemo(() => {
    const now = new Date();
    const plain = parseQuickAdd(text, { now, timeZone });
    // In the Today view a task with no date of its own is due today.
    if (defaults.dueToday && plain.title && !plain.due) {
      return parseQuickAdd(`${text} today`, { now, timeZone });
    }
    return plain;
  }, [text, timeZone, defaults.dueToday]);

  const ready = projects.data !== undefined && labels.data !== undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = taskInputFromQuickAdd(parsed, {
      projects: projects.data ?? [],
      labels: labels.data ?? [],
      timeZone,
    });
    if (!input) return;

    const labelIds =
      defaults.labelId && !input.labelIds.includes(defaults.labelId)
        ? [...input.labelIds, defaults.labelId]
        : input.labelIds;
    const submitted = text;
    setText("");
    try {
      await create({
        ...input,
        projectId: input.projectId ?? (parsed.project ? null : defaults.projectId),
        labelIds,
      });
      if (input.unknownProject) {
        notify(`There is no project named "${input.unknownProject}", so the task is in your Inbox.`);
      }
    } catch {
      setText(submitted);
      notify("Couldn't add that task. Try again.", { tone: "error" });
    }
  }

  const chips: { key: string; icon: ReactNode; text: string }[] = [];
  if (parsed.due) {
    chips.push({
      key: "due",
      icon: <TodayIcon width={14} height={14} />,
      text: formatDue({ dueAt: parsed.due.at, dueAllDay: parsed.due.allDay }, { now: new Date(), timeZone }).label,
    });
  }
  if (parsed.rrule) {
    chips.push({
      key: "rrule",
      icon: <RepeatIcon width={14} height={14} />,
      text: describeRecurrence(parsed.rrule, parsed.recurAfterCompletion),
    });
  }
  if (parsed.priority) {
    chips.push({ key: "priority", icon: <FlagIcon width={14} height={14} />, text: `P${parsed.priority}` });
  }
  if (parsed.project) {
    chips.push({ key: "project", icon: <HashIcon width={14} height={14} />, text: parsed.project });
  }
  for (const label of parsed.labels) {
    chips.push({ key: `label-${label}`, icon: <TagIcon width={14} height={14} />, text: label });
  }

  return (
    <form onSubmit={onSubmit} className="mb-4">
      <div className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Add a task
        </label>
        <input
          id={inputId}
          data-quick-add
          type="text"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby={previewId}
          placeholder="Add a task, e.g. Pay rent every 1st at 9am #home p2"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-subtle px-3 py-2 text-base placeholder:text-text-muted"
        />
        <button
          type="submit"
          disabled={!ready || parsed.title === ""}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-2 font-medium text-on-accent disabled:opacity-50"
        >
          <PlusIcon width={16} height={16} />
          Add task
        </button>
      </div>
      <p
        id={previewId}
        data-quick-add-preview
        aria-live="polite"
        className="mt-2 flex min-h-5 flex-wrap gap-x-3 gap-y-1 text-sm text-text-muted"
      >
        {chips.map((chip) => (
          <span key={chip.key} className="inline-flex items-center gap-1">
            {chip.icon}
            {chip.text}
          </span>
        ))}
      </p>
    </form>
  );
}
