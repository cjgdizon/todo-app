import type { Metadata } from "next";
import { JoinInvite } from "@/components/join-invite";

export const instant = false;
export const metadata: Metadata = { title: "Join a workspace · Todo" };

export default function JoinPage() {
  return <JoinInvite />;
}
