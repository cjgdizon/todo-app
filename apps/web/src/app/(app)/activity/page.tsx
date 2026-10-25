import type { Metadata } from "next";
import { ActivityScreen } from "@/components/activity-screen";

export const instant = false;
export const metadata: Metadata = { title: "Activity · Todo" };

export default function ActivityPage() {
  return <ActivityScreen />;
}
