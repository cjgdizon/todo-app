import type { Metadata } from "next";
import { StatsScreen } from "@/components/stats-screen";

export const instant = false;
export const metadata: Metadata = { title: "Stats · Todo" };

export default function StatsPage() {
  return <StatsScreen />;
}
