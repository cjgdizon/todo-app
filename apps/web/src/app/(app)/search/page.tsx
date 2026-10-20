import type { Metadata } from "next";
import { SearchScreen } from "@/components/view-screens";

export const metadata: Metadata = { title: "Search · Todo" };

export default function SearchPage() {
  return <SearchScreen />;
}
