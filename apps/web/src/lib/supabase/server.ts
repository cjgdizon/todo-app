import { createServerClient } from "@supabase/ssr";
import type { Database, TodoClient } from "@todo/data";
import { cookies } from "next/headers";
import { env } from "../env";

/** Supabase client for server components and route handlers (reads and refreshes the cookie session). */
export async function createClient(): Promise<TodoClient> {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes the session.
        }
      },
    },
  });
}
