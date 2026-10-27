// Deletes the signed-in person's account. What cannot be undone happens last and only after the
// checks pass:
//   1. who is asking (a verified login) and the exact typed confirmation;
//   2. no shared workspace still owned by them (they must hand those over first);
//   3. best-effort cleanup at Google (revoke the grant, remove the Tasks calendar);
//   4. their unshared workspaces (with everything in them) and then the login itself;
//   5. their files in Storage, listed before step 4 and removed after it (best effort: a failure
//      leaves orphaned files, never a half-deleted account).
// Work in workspaces other people share stays, without the person's name on it.
// Nothing sensitive is logged: counts and error names only.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsFor, jsonResponse, signedInUser } from "../_shared/auth.ts";
import { deleteCalendar, refreshAccessToken, revokeToken } from "../_shared/google.ts";

const CONFIRMATION = "delete my account";
const BUCKET = "attachments";
const REMOVE_BATCH = 100;

Deno.serve(async (request) => {
  const webUrl = Deno.env.get("WEB_APP_URL") ?? Deno.env.get("GCAL_RETURN_URL");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webUrl || !url || !serviceKey) {
    console.error("delete-account: configuration is missing");
    return jsonResponse(500, { error: "not configured" });
  }
  const cors = corsFor(webUrl, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse(405, { error: "method not allowed" }, cors);

  const userId = await signedInUser(request);
  if (!userId) return jsonResponse(401, { error: "sign in first" }, cors);

  const body: unknown = await request.json().catch(() => null);
  const typed = body && typeof body === "object" ? (body as { confirm?: unknown }).confirm : null;
  if (typed !== CONFIRMATION) return jsonResponse(400, { error: `Type "${CONFIRMATION}" to confirm.` }, cors);

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: blocked, error: checkError } = await db.rpc("has_account_deletion_blockers", { p_user: userId });
  if (checkError) {
    console.error("delete-account: checking failed", checkError.code);
    return jsonResponse(500, { error: "Couldn't check your workspaces. Nothing was deleted." }, cors);
  }
  if (blocked === true) {
    return jsonResponse(409, { error: "Hand over the workspaces you share with others before deleting your account." }, cors);
  }

  // Google first: once the workspaces are gone, so is the stored token.
  try {
    const { data: integration } = await db.from("calendar_integrations").select("calendar_id").eq("user_id", userId).maybeSingle();
    const { data: refreshToken } = await db.rpc("get_calendar_refresh_token", { p_user: userId });
    if (typeof refreshToken === "string") {
      const accessToken = await refreshAccessToken(refreshToken);
      if (accessToken !== "revoked" && integration?.calendar_id) await deleteCalendar(accessToken, integration.calendar_id);
      await revokeToken(refreshToken);
    }
    await db.rpc("disconnect_calendar", { p_user: userId });
  } catch (caught) {
    console.error("delete-account: Google cleanup failed", caught instanceof Error ? caught.name : "unknown");
  }

  const { data: paths } = await db.rpc("attachment_paths_of_owned_workspaces", { p_user: userId });
  const files = Array.isArray(paths) ? (paths as string[]) : [];

  const { error: workspacesError } = await db.rpc("delete_owned_workspaces", { p_user: userId });
  if (workspacesError) {
    console.error("delete-account: deleting workspaces failed", workspacesError.code);
    return jsonResponse(500, { error: "Couldn't delete your workspaces. Try again." }, cors);
  }
  const { error: userError } = await db.auth.admin.deleteUser(userId);
  if (userError) {
    console.error("delete-account: deleting the login failed", userError.name);
    return jsonResponse(500, { error: "Couldn't finish deleting your account. Try again." }, cors);
  }

  let removed = 0;
  for (let start = 0; start < files.length; start += REMOVE_BATCH) {
    const { data, error } = await db.storage.from(BUCKET).remove(files.slice(start, start + REMOVE_BATCH));
    if (error) console.error("delete-account: removing files failed", error.name);
    else removed += data?.length ?? 0;
  }
  return jsonResponse(200, { deleted: true, filesRemoved: removed, filesListed: files.length }, cors);
});
