import { TaskList } from "@/components/task-list";

const VIEW = { kind: "upcoming" } as const;
const DEFAULTS = { projectId: null, dueToday: false } as const;

export default function Upcoming() {
  return <TaskList view={VIEW} defaults={DEFAULTS} empty="Nothing scheduled. Give a task a date and it shows up here." />;
}
