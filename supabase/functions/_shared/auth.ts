import { createClient } from "npm:@supabase/supabase-js@2";

/** The signed-in person behind a request's Authorization header, or null. Checked with Supabase Auth. */
export async function signedInUser(request: Request): Promise<string | null> {
  const header = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!header?.startsWith("Bearer ") || !url || !anonKey) return null;
  const client = createClient(url, anonKey, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

/**
 * CORS for the web app only: its own origin, taken from server configuration (never from the
 * request), so another site cannot call these functions with a visitor's login.
 */
export function corsFor(returnUrl: string | undefined, request: Request): Record<string, string> {
  const allowed = returnUrl ? new URL(returnUrl).origin : null;
  const base = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
  return allowed && request.headers.get("Origin") === allowed ? { ...base, "Access-Control-Allow-Origin": allowed } : base;
}

export const jsonResponse = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
