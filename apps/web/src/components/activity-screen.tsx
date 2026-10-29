"use client";

import { describeActivity, queryKeys, useActivity, useData, useMembers, useTasks } from "@todo/data";
import { useRefreshOnOpen } from "@/lib/use-refresh-on-open";
import { useTaskSelection } from "@/lib/use-task-selection";

export function ActivityScreen() {
  const { userId, workspaceId } = useData();
  useRefreshOnOpen("/activity", [queryKeys.activity(workspaceId), queryKeys.members(workspaceId)]);
  const activity = useActivity();
  const members = useMembers().data ?? [];
  const taskIds = new Set((useTasks().data ?? []).map((task) => task.id));
  const selection = useTaskSelection();
  const names = new Map(members.map((member) => [member.userId, member.displayName]));
  const entries = activity.data ?? [];

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8">
      <h1 className="text-[20px] leading-7 font-semibold">Activity</h1>
      <p className="mt-1 text-text-muted">What has happened in this workspace lately.</p>

      {activity.isError ? (
        <p role="alert" className="mt-4 text-danger">
          <span aria-hidden="true">⚠ </span>
          Couldn&apos;t load the activity.
        </p>
      ) : null}

      {activity.isSuccess && entries.length === 0 ? (
        <p className="mt-6 text-text-muted">
          Nothing yet. Activity is recorded once someone else has joined this workspace.
        </p>
      ) : null}

      <ol className="mt-4 divide-y divide-border rounded-md border border-border bg-surface">
        {entries.map((entry) => {
          const text = describeActivity(entry, { me: userId, names });
          const taskId = entry.taskId && taskIds.has(entry.taskId) ? entry.taskId : null;
          return (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
              {taskId ? (
                <button type="button" onClick={() => selection.open(taskId)} className="text-left underline-offset-2 hover:underline">
                  {text}
                </button>
              ) : (
                <span>{text}</span>
              )}
              <time dateTime={entry.createdAt.toISOString()} className="ml-auto text-sm text-text-muted">
                {entry.createdAt.toLocaleString()}
              </time>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
