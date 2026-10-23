import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/session";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except Next.js internals, static files, and what the browser fetches to install the
  // app (service worker, manifest, icons): those must load without a session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icon(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
