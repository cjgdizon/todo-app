import type { Metadata } from "next";
import { MembersScreen } from "@/components/members-screen";

export const instant = false;
export const metadata: Metadata = { title: "Members · Todo" };

export default function MembersPage() {
  return <MembersScreen />;
}
