import type { Metadata } from "next";
import { TaskView } from "@/components/task-view";

export const metadata: Metadata = { title: "Upcoming · Todo" };

export default function UpcomingPage() {
  return <TaskView view={{ kind: "upcoming" }} title="Upcoming" />;
}
