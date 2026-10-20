import type { Metadata } from "next";
import { TaskView } from "@/components/task-view";

export const metadata: Metadata = { title: "Today · Todo" };

export default function TodayPage() {
  return <TaskView view={{ kind: "today" }} title="Today" />;
}
