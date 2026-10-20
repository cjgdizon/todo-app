import { PRIORITIES } from "@todo/core";

// Placeholder for M0: proves the web app resolves the shared @todo/core package.
// Replaced by the real inbox in M2.
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-12">
      <h1 className="text-[28px] leading-9 font-semibold">Tasks</h1>
      <p className="mt-2 text-sm text-text-muted">
        Nothing here yet. Priorities available: {PRIORITIES.map((p) => `P${p}`).join(", ")}.
      </p>
    </main>
  );
}
