// Connects a person's Google Calendar. Two requests meet here:
//  - POST, from the signed-in app: checks who is asking and that they belong to the workspace, then
//    returns the Google consent address with a signed `state`.
//  - GET, Google sending the browser back: this carries no login, so the signed `state` is the only
//    thing that says who it is for. It must be genuine and fresh. The code is exchanged for tokens,
//    a dedicated "Tasks" calendar is made, the refresh token goes into Vault, and the browser is sent
//    back to the app at an address fixed in server configuration (never taken from the request).
// Nothing sensitive is logged: no tokens, codes or state, only error names.
import { createClient } from "npm:@supabase/supabase-js@2";
import { signOAuthState, verifyOAuthState } from "@todo/core/oauth-state";
import { corsFor, jsonResponse, signedInUser } from "../_shared/auth.ts";
import { consentUrl, createTasksCalendar, exchangeCode } from "../_shared/google.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function settingsUrl(returnUrl: string, outcome: "connected" | "denied" | "failed"): string {
  const url = new URL(returnUrl);
  url.searchParams.set("calendar", outcome);
  return url.toString();
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location } });

Deno.serve(async (request) => {
  const returnUrl = Deno.env.get("GCAL_RETURN_URL");
  const redirectUri = Deno.env.get("GCAL_REDIRECT_URI");
  const stateSecret = Deno.env.get("GCAL_STATE_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!returnUrl || !redirectUri || !stateSecret || !url || !serviceKey) {
    console.error("gcal-connect: configuration is missing");
    return jsonResponse(500, { error: "not configured" });
  }
  const cors = corsFor(returnUrl, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (request.method === "POST") {
    const userId = await signedInUser(request);
    if (!userId) return jsonResponse(401, { error: "sign in first" }, cors);

    const body: unknown = await request.json().catch(() => null);
    const workspaceId = body && typeof body === "object" ? (body as { workspaceId?: unknown }).workspaceId : null;
    if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) return jsonResponse(400, { error: "workspaceId is required" }, cors);

    const { data: membership } = await db
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) return jsonResponse(403, { error: "not a member of that workspace" }, cors);

    const state = await signOAuthState({ userId, workspaceId }, stateSecret, new Date());
    return jsonResponse(200, { url: consentUrl(redirectUri, state) }, cors);
  }

  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const state = await verifyOAuthState(params.get("state") ?? "", stateSecret, new Date());
    if (!state) return new Response("This link is not valid or has expired. Start again from the app.", { status: 400 });
    if (params.get("error")) return redirect(settingsUrl(returnUrl, "denied"));

    const code = params.get("code");
    if (!code) return redirect(settingsUrl(returnUrl, "failed"));
    try {
      const { accessToken, refreshToken } = await exchangeCode(code, redirectUri);

      // Keep the calendar made on an earlier connection; make the dedicated one the first time.
      const { data: existing } = await db.from("calendar_integrations").select("calendar_id").eq("user_id", state.userId).maybeSingle();
      let calendarId = existing?.calendar_id ?? null;
      if (!calendarId) {
        const { data: profile } = await db.from("profiles").select("timezone").eq("id", state.userId).single();
        calendarId = await createTasksCalendar(accessToken, profile?.timezone ?? "UTC");
      }
      const { error } = await db.rpc("save_calendar_connection", {
        p_user: state.userId,
        p_workspace: state.workspaceId,
        p_refresh_token: refreshToken,
        p_calendar_id: calendarId,
      });
      if (error) throw new Error(`save failed (${error.code})`);
      return redirect(settingsUrl(returnUrl, "connected"));
    } catch (caught) {
      console.error("gcal-connect: connecting failed", caught instanceof Error ? caught.name : "unknown");
      return redirect(settingsUrl(returnUrl, "failed"));
    }
  }

  return jsonResponse(405, { error: "method not allowed" }, cors);
});
