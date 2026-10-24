import { TaskList } from "@/components/task-list";

const VIEW = { kind: "inbox" } as const;
const DEFAULTS = { projectId: null, dueToday: false } as const;

export default function Inbox() {
  return <TaskList view={VIEW} defaults={DEFAULTS} empty="Your Inbox is empty. Add a task below." />;
}
