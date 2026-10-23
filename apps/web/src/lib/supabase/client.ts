import { createBrowserClient } from "@supabase/ssr";
import { createOfflineFetch, type Database, type TodoClient } from "@todo/data";
import { env } from "../env";
import { emitConflict, emitRejected, registerOfflineQueue } from "../offline";

const OFFLINE_STORAGE_KEY = "todo-offline-writes";

let browserClient: TodoClient | undefined;

/**
 * Supabase client for client components; the session lives in cookies so the server can read it.
 * In the browser there is one client and its requests go through the offline write queue, so
 * edits made without a connection are kept and sent later. (Server rendering gets a plain client.)
 */
export function createClient(): TodoClient {
  if (typeof window === "undefined") {
    return createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey);
  }
  if (browserClient) return browserClient;

  const offline = createOfflineFetch({
    fetch: (input, init) => fetch(input, init),
    storage: localStorage,
    storageKey: OFFLINE_STORAGE_KEY,
    getAccessToken: async () => (await created.auth.getSession()).data.session?.access_token ?? null,
    onRejected: emitRejected,
    onConflict: emitConflict,
  });
  registerOfflineQueue(offline);
  const created = createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    global: { fetch: offline.fetch },
  });
  browserClient = created;
  return created;
}
