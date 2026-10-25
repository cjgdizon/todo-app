"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider, type PersistedClient } from "@tanstack/react-query-persist-client";
import {
  DataContext,
  deserializeCache,
  serializeCache,
  updateProfileTimeZone,
  useBootstrap,
  type TodoClient,
} from "@todo/data";
import { del, get, set } from "idb-keyval";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useActiveWorkspace } from "@/lib/active-workspace";
import { getOfflineQueue, onRejectedWrite, onWriteConflict } from "@/lib/offline";
import { useRealtimeSync } from "@/lib/realtime";
import { createClient } from "@/lib/supabase/client";
import { RegisterServiceWorker } from "./register-service-worker";
import { ToastProvider, useToast } from "./toast";

type Session = { status: "loading" } | { status: "out" } | { status: "in"; userId: string };

const DAY_MS = 24 * 60 * 60 * 1000;
// Cached lists are kept on this device so the app opens, and works, without a connection.
const CACHE_MAX_AGE_MS = 7 * DAY_MS;
const CACHE_KEY = "todo-query-cache";
const LAST_USER_KEY = "todo-last-user";

const persister = createAsyncStoragePersister({
  key: CACHE_KEY,
  // Saved often: an edit made just before closing the tab should be in the snapshot the next start restores.
  throttleTime: 250,
  serialize: serializeCache,
  deserialize: (text) => deserializeCache(text) as PersistedClient,
  // Server rendering has no IndexedDB; the persister then does nothing.
  storage:
    typeof indexedDB === "undefined"
      ? undefined
      : {
          getItem: async (key) => (await get<string>(key)) ?? null,
          setItem: (key, value) => set(key, value),
          removeItem: (key) => del(key),
        },
});

/** The last signed-in user, so a device that is offline with an expired token can still open its cached data. */
function rememberedUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

function remember(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(LAST_USER_KEY, userId);
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Private mode: offline sign-in memory is simply unavailable.
  }
}

/**
 * Every write ends by invalidating its lists, and TanStack waits for that refetch before a write
 * counts as finished. Offline the refetch is paused until the connection returns, which would
 * leave the UI (a quick-add box, an undo toast) waiting on a save that has already been kept.
 * So offline, invalidation still marks lists stale but nothing waits for it.
 */
class OfflineAwareQueryClient extends QueryClient {
  override invalidateQueries(...args: Parameters<QueryClient["invalidateQueries"]>): Promise<void> {
    const refetched = super.invalidateQueries(...args);
    return typeof navigator !== "undefined" && !navigator.onLine ? Promise.resolve() : refetched;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new OfflineAwareQueryClient({
        defaultOptions: {
          // gcTime must cover the persisted age or restored lists are dropped at once.
          queries: { staleTime: 30_000, retry: 1, gcTime: CACHE_MAX_AGE_MS },
          // Writes always run: without a connection the offline queue keeps them (see @todo/data).
          mutations: { networkMode: "always" },
        },
      }),
  );
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE_MS, buster: "1" }}
      // The snapshot may be older than the server (or miss an edit that was sent since), so show it
      // at once but refetch every list as soon as it is restored.
      onSuccess={() => void queryClient.invalidateQueries()}
    >
      <ToastProvider>
        <RegisterServiceWorker />
        <SessionGate>{children}</SessionGate>
      </ToastProvider>
    </PersistQueryClientProvider>
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
  const { notify } = useToast();
  const client = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    const apply = (userId: string | null) => {
      if (userId) {
        // Before any request: stored offline edits of a different user must never be sent as this one.
        getOfflineQueue()?.bindUser(userId);
        remember(userId);
      }
      setSession((previous) => {
        if (userId === null) return previous.status === "out" ? previous : { status: "out" };
        return previous.status === "in" && previous.userId === userId ? previous : { status: "in", userId };
      });
    };

    let active = true;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (data.session) return apply(data.session.user.id);
      // Offline with an expired token the session cannot be refreshed, but the user has not signed out.
      const offlineUser = error && isAuthRetryableFetchError(error) ? rememberedUser() : null;
      apply(offlineUser);
    });
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (next) apply(next.user.id);
      else if (event === "SIGNED_OUT") apply(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (session.status === "out") {
      queryClient.clear();
      getOfflineQueue()?.clear();
      remember(null);
      void persister.removeClient();
      router.replace("/login");
    }
  }, [session.status, queryClient, router]);

  // Send offline edits when the connection returns (and any left from before a reload), then
  // reload the lists so they show what the server has.
  useEffect(() => {
    const queue = getOfflineQueue();
    if (session.status !== "in" || !queue) return;
    let hadPending = queue.pending() > 0;
    const stop = queue.subscribe(({ pending }) => {
      if (hadPending && pending === 0) void queryClient.invalidateQueries();
      hadPending = pending > 0;
    });
    const send = () => void queue.flush();
    window.addEventListener("online", send);
    if (navigator.onLine) send();
    return () => {
      stop();
      window.removeEventListener("online", send);
    };
  }, [session.status, queryClient]);

  useEffect(() => {
    const stopRejected = onRejectedWrite(() => {
      notify("A change made offline could not be saved, so it was undone.", { tone: "error" });
      void queryClient.invalidateQueries();
    });
    const stopConflict = onWriteConflict(({ count }) =>
      notify(
        count === 1
          ? "1 item was also edited on another device. Your offline edit replaced it."
          : `${count} items were also edited on another device. Your offline edits replaced them.`,
      ),
    );
    return () => {
      stopRejected();
      stopConflict();
    };
  }, [notify, queryClient]);

  if (session.status !== "in") return <Message>Loading…</Message>;
  return (
    <Workspace client={client} userId={session.userId}>
      {children}
    </Workspace>
  );
}

function Workspace({ client, userId, children }: { client: TodoClient; userId: string; children: ReactNode }) {
  const bootstrap = useBootstrap(client, userId, useActiveWorkspace(userId));
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const profileZone = bootstrap.data?.profile.timeZone;
  // New accounts start on "UTC"; until the user picks one, use the browser's zone.
  const timeZone = profileZone && profileZone !== "UTC" ? profileZone : browserZone;
  useRealtimeSync(client, bootstrap.data?.workspace.id);

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
