// Disconnects the signed-in person's Google Calendar. They choose whether the events stay in Google
// (the calendar is left as plain events) or are removed (the dedicated Tasks calendar is deleted).
// Disconnecting always happens, even if Google cannot be reached or the grant was already revoked:
// the stored token is deleted and nothing is synced from then on.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsFor, jsonResponse, signedInUser } from "../_shared/auth.ts";
import { deleteCalendar, refreshAccessToken, revokeToken } from "../_shared/google.ts";

Deno.serve(async (request) => {
  const returnUrl = Deno.env.get("GCAL_RETURN_URL");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!returnUrl || !url || !serviceKey) {
    console.error("gcal-disconnect: configuration is missing");
    return jsonResponse(500, { error: "not configured" });
  }
  const cors = corsFor(returnUrl, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse(405, { error: "method not allowed" }, cors);

  const userId = await signedInUser(request);
  if (!userId) return jsonResponse(401, { error: "sign in first" }, cors);

  const body: unknown = await request.json().catch(() => null);
  const removeEvents = body && typeof body === "object" && (body as { removeEvents?: unknown }).removeEvents === true;

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: integration } = await db.from("calendar_integrations").select("calendar_id").eq("user_id", userId).maybeSingle();
  if (!integration) return jsonResponse(200, { disconnected: true, removedEvents: false }, cors);

  let removedEvents = false;
  const { data: refreshToken } = await db.rpc("get_calendar_refresh_token", { p_user: userId });
  if (typeof refreshToken === "string") {
    try {
      if (removeEvents && integration.calendar_id) {
        const accessToken = await refreshAccessToken(refreshToken);
        if (accessToken !== "revoked") {
          await deleteCalendar(accessToken, integration.calendar_id);
          removedEvents = true;
        }
      }
      await revokeToken(refreshToken);
    } catch (caught) {
      console.error("gcal-disconnect: Google cleanup failed", caught instanceof Error ? caught.name : "unknown");
    }
  }

  const { error } = await db.rpc("disconnect_calendar", { p_user: userId });
  if (error) {
    console.error("gcal-disconnect: disconnecting failed", error.code);
    return jsonResponse(500, { error: "could not disconnect" }, cors);
  }
  return jsonResponse(200, { disconnected: true, removedEvents }, cors);
});
