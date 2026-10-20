import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";

// Everything in this group renders on the client once the browser session is known, so the server
// shell cannot show page content. Opt out of Next's instant-navigation validation, which would
// otherwise report every page here as a dropped segment.
export const instant = false;

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
