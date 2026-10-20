import { createBrowserClient } from "@supabase/ssr";
import type { Database, TodoClient } from "@todo/data";
import { env } from "../env";

/** Supabase client for client components; the session lives in cookies so the server can read it. */
export function createClient(): TodoClient {
  return createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey);
}
