"use client";

import {
  DataError,
  REMINDER_PRESETS,
  reminderLabel,
  useClearReminder,
  useReminders,
  useSetReminder,
  type Task,
} from "@todo/data";
import { useId } from "react";
import { useToast } from "./toast";

const control =
  "block w-full rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base text-text disabled:opacity-60";

function messageFor(error: unknown): string {
  if (error instanceof DataError && /already passed/i.test(error.message)) {
    return "That time has already passed. Pick a later reminder, or a later due date.";
  }
  return "Couldn't save the reminder. Check your connection and try again.";
}

/** "Remind me" for the signed-in person. Only makes sense once the task has a due date. */
export function TaskReminder({ task }: { task: Task }) {
  const reminder = useReminders().data?.find((item) => item.taskId === task.id);
  const setReminder = useSetReminder();
  const clearReminder = useClearReminder();
  const { notify } = useToast();
  const selectId = useId();
  if (!task.dueAt) return null;

  const isPreset = reminder ? REMINDER_PRESETS.some((preset) => preset.offsetMin === reminder.offsetMin) : true;
  const onError = (error: unknown) => notify(messageFor(error), { tone: "error" });

  function onChange(value: string) {
    if (value === "") clearReminder.mutate(task.id, { onError });
    else setReminder.mutate({ taskId: task.id, offsetMin: Number(value) }, { onError });
  }

  return (
    <div>
      <label htmlFor={selectId} className="mb-1 block text-sm font-medium">
        Reminder
      </label>
      <select id={selectId} className={control} value={reminder ? String(reminder.offsetMin) : ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">No reminder</option>
        {REMINDER_PRESETS.map((preset) => (
          <option key={preset.offsetMin} value={preset.offsetMin}>
            {preset.label}
          </option>
        ))}
        {reminder && !isPreset ? <option value={reminder.offsetMin}>{reminderLabel(reminder.offsetMin)}</option> : null}
      </select>
      <p className="mt-1 text-sm text-text-muted">
        {reminder?.sent ? "Already sent. " : ""}Reminders arrive as notifications in the Todo mobile app.
      </p>
    </div>
  );
}
