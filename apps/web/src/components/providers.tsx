"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { DataContext, updateProfileTimeZone, useBootstrap, type TodoClient } from "@todo/data";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { ToastProvider } from "./toast";

type Session = { status: "loading" } | { status: "out" } | { status: "in"; userId: string };

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionGate>{children}</SessionGate>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex flex-1 items-center justify-center p-8 text-text-muted">
      {children}
    </div>
  );
}

/**
 * Reads the session from the browser client (the proxy has already sent signed-out
 * visitors to /login; row-level security is what actually protects the data).
 */
function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    const apply = (userId: string | null) =>
      setSession((previous) => {
        if (userId === null) return previous.status === "out" ? previous : { status: "out" };
        return previous.status === "in" && previous.userId === userId ? previous : { status: "in", userId };
      });

    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) apply(data.session?.user.id ?? null);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => apply(next?.user.id ?? null));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (session.status === "out") {
      queryClient.clear();
      router.replace("/login");
    }
  }, [session.status, queryClient, router]);

  if (session.status !== "in") return <Message>Loading…</Message>;
  return (
    <Workspace client={client} userId={session.userId}>
      {children}
    </Workspace>
  );
}

function Workspace({ client, userId, children }: { client: TodoClient; userId: string; children: ReactNode }) {
  const bootstrap = useBootstrap(client, userId);
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const profileZone = bootstrap.data?.profile.timeZone;
  // New accounts start on "UTC"; until the user picks one, use the browser's zone.
  const timeZone = profileZone && profileZone !== "UTC" ? profileZone : browserZone;

  useEffect(() => {
    if (profileZone === "UTC" && browserZone !== "UTC") {
      // Best effort: the zone is still applied locally if saving fails.
      updateProfileTimeZone(client, userId, browserZone).catch(() => undefined);
    }
  }, [client, userId, profileZone, browserZone]);

  if (bootstrap.isError) {
    return (
      <Message>
        <div className="text-center">
          <p role="alert" className="text-danger">
            <span aria-hidden="true">⚠ </span>
            Couldn&apos;t load your workspace.
          </p>
          <button type="button" className="mt-3 text-accent-strong underline" onClick={() => void bootstrap.refetch()}>
            Try again
          </button>
        </div>
      </Message>
    );
  }
  if (!bootstrap.data) return <Message>Loading…</Message>;

  return (
    <DataContext value={{ client, userId, workspaceId: bootstrap.data.workspace.id, timeZone }}>
      {children}
    </DataContext>
  );
}
