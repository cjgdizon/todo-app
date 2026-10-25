import type { Activity } from "./models.ts";

export interface ActivityContext {
  /** The signed-in user, so their own actions read "You". */
  me: string;
  /** Display names of the workspace's current members, by user id. */
  names: ReadonlyMap<string, string>;
}

// The verb after the person, for entries about one item of work.
const VERBS: Record<string, string> = {
  task_created: "added",
  task_completed: "completed",
  task_reopened: "reopened",
  task_deleted: "deleted",
  task_unassigned: "unassigned",
  comment_added: "commented on",
};

function actorOf(entry: Activity, context: ActivityContext): string {
  if (entry.actorId === context.me) return "You";
  return (entry.actorId && context.names.get(entry.actorId)) || entry.actorName || "Someone";
}

/** One plain-language line for the activity feed: who did what to which item. */
export function describeActivity(entry: Activity, context: ActivityContext): string {
  const actor = actorOf(entry, context);
  const subject = entry.title ? `“${entry.title}”` : "a task";

  if (entry.action === "member_joined") return `${actor} joined the workspace`;
  if (entry.action === "task_assigned") {
    const to =
      entry.assigneeId === context.me
        ? "you"
        : ((entry.assigneeId && context.names.get(entry.assigneeId)) || "a former member");
    return `${actor} assigned ${subject} to ${to}`;
  }
  const verb = VERBS[entry.action];
  return verb ? `${actor} ${verb} ${subject}` : `${actor} made a change`;
}
