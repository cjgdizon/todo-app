import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";

// The session is read in the browser (see Providers), so nothing here touches request data and the
// shell can be prerendered. Suspense covers the client hooks that read the URL.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers>
      <Suspense fallback={<div role="status" className="flex flex-1 items-center justify-center text-text-muted">Loading…</div>}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </Providers>
  );
}
