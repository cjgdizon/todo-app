import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase sends magic-link and confirmation emails. Exchanges the one-time
 * code for a session cookie. It always lands on /inbox: no `next` parameter is
 * honoured, so the link cannot be turned into an open redirect.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/inbox`);
  }
  return NextResponse.redirect(`${origin}/login`);
}
