import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

/** The typed Supabase client every query in this package takes. Apps create it (web: @supabase/ssr). */
export type TodoClient = SupabaseClient<Database>;
