import { createClient } from "@supabase/supabase-js";
import type { Database, TodoClient } from "@todo/data";
import type { OfflineFetch } from "@todo/data";
import { AppState } from "react-native";
import { env } from "./env";
import { createQueue } from "./offline";

export interface Backend {
  client: TodoClient;
  queue: OfflineFetch;
}

let backend: Backend | undefined;

/**
 * The one Supabase client. Its requests go through the offline write queue, so edits made without a
 * connection are kept and sent later.
 * shortcut: the session lives in SQLite `localStorage` (private to the app, but not the Keychain/Keystore); move it to an encrypted secure-store adapter before release.
 */
export function getBackend(): Backend {
  if (backend) return backend;

  const queue = createQueue(async () => (await client.auth.getSession()).data.session?.access_token ?? null);
  const client: TodoClient = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    global: { fetch: queue.fetch },
  });

  // The token refresh timer does not run in the background, so pause it there and catch up on return.
  AppState.addEventListener("change", (state) => {
    if (state === "active") void client.auth.startAutoRefresh();
    else void client.auth.stopAutoRefresh();
  });

  backend = { client, queue };
  return backend;
}
