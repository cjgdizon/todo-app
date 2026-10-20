import type { Metadata } from "next";
import { TaskView } from "@/components/task-view";

export const metadata: Metadata = { title: "Inbox · Todo" };

export default function InboxPage() {
  return <TaskView view={{ kind: "inbox" }} title="Inbox" />;
}
