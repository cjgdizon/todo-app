import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { onlineManager, QueryClient, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider, type PersistedClient } from "@tanstack/react-query-persist-client";
import {
  DataContext,
  deserializeCache,
  serializeCache,
  updateProfileTimeZone,
  useBootstrap,
  type OfflineFetch,
  type TodoClient,
} from "@todo/data";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { onRejectedWrite, onWriteConflict } from "@/lib/offline";
import { registerDevice } from "@/lib/push";
import { getBackend } from "@/lib/supabase";
import { space, TOUCH, useTheme } from "@/lib/theme";
import { NoticeProvider, useNotice } from "./notice";

type Session = { status: "loading" } | { status: "out" } | { status: "in"; userId: string };

const DAY_MS = 24 * 60 * 60 * 1000;
// Cached lists are kept on the phone so the app opens, and works, without a connection.
const CACHE_MAX_AGE_MS = 7 * DAY_MS;
const CACHE_KEY = "todo-query-cache";
const LAST_USER_KEY = "todo-last-user";

/**
 * Every write ends by invalidating its lists, and TanStack waits for that refetch before a write
 * counts as finished. Offline the refetch is paused until the connection returns, which would leave
 * the UI waiting on a save that has already been kept. So offline, invalidation still marks lists
 * stale but nothing waits for it.
 */
class OfflineAwareQueryClient extends QueryClient {
  override invalidateQueries(...args: Parameters<QueryClient["invalidateQueries"]>): Promise<void> {
    const refetched = super.invalidateQueries(...args);
    return onlineManager.isOnline() ? refetched : Promise.resolve();
  }
}

const SessionContext = createContext<{ session: Session; client: TodoClient; queue: OfflineFetch } | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside Providers");
  return value.session;
}

/** Signs out, first trying to save offline edits and asking before throwing away any that cannot be sent. */
export function useSignOut(): () => Promise<void> {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSignOut must be used inside Providers");
  const { client, queue } = value;
  return async () => {
    if (queue.pending() > 0) {
      await queue.flush();
      const left = queue.pending();
      if (left > 0) {
        const proceed = await new Promise<boolean>((resolve) =>
          Alert.alert("Unsaved changes", `${left} change(s) made offline are not saved yet and will be lost.`, [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Sign out anyway", style: "destructive", onPress: () => resolve(true) },
          ]),
        );
        if (!proceed) return;
      }
    }
    // The server moves this phone to the next user who signs in on it (see register_push_token).
    await client.auth.signOut();
  };
}

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
    // Offline sign-in memory is simply unavailable.
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new OfflineAwareQueryClient({
        defaultOptions: {
          // gcTime must cover the saved age or restored lists are dropped at once.
          queries: { staleTime: 30_000, retry: 1, gcTime: CACHE_MAX_AGE_MS },
          // Writes always run: without a connection the offline queue keeps them (see @todo/data).
          mutations: { networkMode: "always" },
        },
      }),
  );
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: localStorage,
      key: CACHE_KEY,
      // Saved often: an edit made just before closing the app should be in the snapshot the next start restores.
      throttleTime: 250,
      serialize: serializeCache,
      deserialize: (text) => deserializeCache(text) as PersistedClient,
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
      <NoticeProvider>
        <SessionGate persist={() => persister.removeClient()}>{children}</SessionGate>
      </NoticeProvider>
    </PersistQueryClientProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

/** Reads the session; row-level security is what actually protects the data. */
function SessionGate({ children, persist }: { children: ReactNode; persist: () => void }) {
  const queryClient = useQueryClient();
  const { notify } = useNotice();
  const { client, queue } = useMemo(() => getBackend(), []);
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    const apply = (userId: string | null) => {
      if (userId) {
        // Before any request: stored offline edits of a different user must never be sent as this one.
        queue.bindUser(userId);
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
      // Offline with an expired login the session cannot be refreshed, but the user has not signed out.
      apply(error && isAuthRetryableFetchError(error) ? rememberedUser() : null);
    });
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (next) apply(next.user.id);
      else if (event === "SIGNED_OUT") apply(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client, queue]);

  useEffect(() => {
    if (session.status === "out") {
      queryClient.clear();
      queue.clear();
      remember(null);
      persist();
    }
  }, [session.status, queryClient, queue, persist]);

  // Send offline edits when the connection returns or the app comes back (and any left from before a
  // restart), then reload the lists so they show what the server has.
  useEffect(() => {
    if (session.status !== "in") return;
    let hadPending = queue.pending() > 0;
    const stop = queue.subscribe(({ pending }) => {
      if (hadPending && pending === 0) void queryClient.invalidateQueries();
      hadPending = pending > 0;
    });
    const send = () => void queue.flush();
    const stopOnline = onlineManager.subscribe((online) => online && send());
    const appState = AppState.addEventListener("change", (state) => state === "active" && send());
    send();
    return () => {
      stop();
      stopOnline();
      appState.remove();
    };
  }, [session.status, queue, queryClient]);

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

  useEffect(() => {
    if (session.status === "in") void registerDevice(client);
  }, [session.status, client]);

  const value = useMemo(() => ({ session, client, queue }), [session, client, queue]);

  let body: ReactNode;
  if (session.status === "loading") {
    body = (
      <Centered>
        <ActivityIndicator accessibilityLabel="Loading" />
      </Centered>
    );
  } else if (session.status === "out") {
    body = children;
  } else {
    body = (
      <Workspace client={client} userId={session.userId}>
        {children}
      </Workspace>
    );
  }
  return <SessionContext value={value}>{body}</SessionContext>;
}

function Workspace({ client, userId, children }: { client: TodoClient; userId: string; children: ReactNode }) {
  const bootstrap = useBootstrap(client, userId);
  const theme = useTheme();
  const deviceZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const profileZone = bootstrap.data?.profile.timeZone;
  // New accounts start on "UTC"; until the user picks one, use the phone's zone.
  const timeZone = profileZone && profileZone !== "UTC" ? profileZone : deviceZone;

  useEffect(() => {
    if (profileZone === "UTC" && deviceZone !== "UTC") {
      // Best effort: the zone is still applied locally if saving fails.
      updateProfileTimeZone(client, userId, deviceZone).catch(() => undefined);
    }
  }, [client, userId, profileZone, deviceZone]);

  if (bootstrap.isError) {
    return (
      <Centered>
        <Text accessibilityRole="alert" style={{ color: theme.danger }}>
          ⚠ Couldn&apos;t load your workspace.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void bootstrap.refetch()} style={styles.retry}>
          <Text style={{ color: theme["accent-strong"], fontWeight: "600" }}>Try again</Text>
        </Pressable>
      </Centered>
    );
  }
  if (!bootstrap.data) {
    return (
      <Centered>
        <ActivityIndicator accessibilityLabel="Loading" />
      </Centered>
    );
  }

  return (
    <DataContext value={{ client, userId, workspaceId: bootstrap.data.workspace.id, timeZone }}>
      {children}
    </DataContext>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  retry: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.md },
});
