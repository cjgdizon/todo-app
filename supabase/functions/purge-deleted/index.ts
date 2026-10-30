// Nightly cleanup of what people deleted. The database's cron job calls this with a shared secret (no
// user is signed in, so `verify_jwt = false` in config.toml). Order matters: the files of attachments
// that are about to lose their rows are removed from Storage first, and the rows are purged only if
// every file went. A failed run changes nothing for good and simply runs again the next night.
// Nothing sensitive is logged: counts and error names only, never file names.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sameSecret } from "../_shared/secret.ts";

const BUCKET = "attachments";
const REMOVE_BATCH = 100;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  const expected = Deno.env.get("PURGE_CRON_SECRET");
  if (!expected) {
    console.error("purge-deleted: PURGE_CRON_SECRET is not set");
    return json(500, { error: "not configured" });
  }
  if (!(await sameSecret(request.headers.get("x-cron-secret") ?? "", expected))) {
    return json(401, { error: "unauthorized" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("purge-deleted: Supabase environment is missing");
    return json(500, { error: "not configured" });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await db.rpc("expired_attachment_paths");
  if (error) {
    console.error("purge-deleted: listing files failed", error.code);
    return json(500, { error: "could not list files" });
  }
  const files = Array.isArray(data) ? (data as string[]) : [];

  let filesRemoved = 0;
  for (let start = 0; start < files.length; start += REMOVE_BATCH) {
    const { data: removed, error: removeError } = await db.storage.from(BUCKET).remove(files.slice(start, start + REMOVE_BATCH));
    if (removeError) {
      // Keep the rows (and so the file names) until the files are really gone.
      console.error("purge-deleted: removing files failed", removeError.name);
      return json(502, { error: "could not remove files", filesRemoved, filesListed: files.length });
    }
    filesRemoved += removed?.length ?? 0;
  }

  const { data: purged, error: purgeError } = await db.rpc("purge_deleted_rows");
  if (purgeError) {
    console.error("purge-deleted: purging rows failed", purgeError.code);
    return json(500, { error: "could not purge rows" });
  }
  return json(200, { filesListed: files.length, filesRemoved, rowsPurged: Number(purged ?? 0) });
});
