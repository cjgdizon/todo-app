import { createServerClient } from "@supabase/ssr";
import type { Database } from "@todo/data";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "../env";
import { safeNext } from "../safe-next";

/** Routes anyone can open. Everything else needs a session. */
const PUBLIC_PATHS = ["/login", "/auth"];

const isPublic = (pathname: string) =>
  PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * Refreshes the Supabase session cookie and sends signed-out visitors to /login.
 * This is an early, optimistic check; the (app) layout verifies the user again on the server.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    // An invite link keeps its place through sign-in; every other page just goes to /login.
    const next = safeNext(pathname + request.nextUrl.search);
    url.pathname = "/login";
    url.search = next ? `?next=${encodeURIComponent(next)}` : "";
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
