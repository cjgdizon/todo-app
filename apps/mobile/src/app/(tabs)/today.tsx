import { TaskList } from "@/components/task-list";

const VIEW = { kind: "today" } as const;
const DEFAULTS = { projectId: null, dueToday: true } as const;

export default function Today() {
  return <TaskList view={VIEW} defaults={DEFAULTS} empty="Nothing due today. Enjoy it, or add a task below." />;
}
