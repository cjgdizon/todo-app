import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar-view";

export const instant = false;
export const metadata: Metadata = { title: "Calendar · Todo" };

export default function CalendarPage() {
  return <CalendarView />;
}
