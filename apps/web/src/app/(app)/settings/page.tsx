import type { Metadata } from "next";
import { ImportExport } from "@/components/import-export";

export const instant = false;
export const metadata: Metadata = { title: "Settings · Todo" };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8">
      <h1 className="mb-4 text-[20px] leading-7 font-semibold">Settings</h1>
      <ImportExport />
    </main>
  );
}
