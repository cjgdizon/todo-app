// Nightly cleanup of what people deleted. The database's cron job calls this with a shared secret (no
// user is signed in, so `verify_jwt = false` in config.toml). Two steps:
//   1. purge the rows deleted more than 30 days ago; the database notes the file of every attachment
//      row it removes in `storage_cleanup`, in the same transaction;
//   2. remove those files from Storage, a batch at a time, forgetting a file only once it is gone.
// A night that fails part-way changes nothing for good: the rest stays queued for the next run.
// Nothing sensitive is logged: counts and error names only, never file names.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sameSecret } from "../_shared/secret.ts";

const BUCKET = "attachments";
const BATCH = 100;
// At most this many batches per run, so a run stays well inside the function's time limit.
const MAX_BATCHES = 50;

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

  const { data: purged, error: purgeError } = await db.rpc("purge_deleted_rows");
  if (purgeError) {
    console.error("purge-deleted: purging rows failed", purgeError.code);
    return json(500, { error: "could not purge rows" });
  }

  let filesRemoved = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await db.rpc("next_storage_cleanup", { batch: BATCH });
    if (error) {
      console.error("purge-deleted: reading the file queue failed", error.code);
      return json(500, { error: "could not read the file queue", rowsPurged: Number(purged ?? 0), filesRemoved });
    }
    const paths = Array.isArray(data) ? (data as string[]) : [];
    if (paths.length === 0) break;

    const { error: removeError } = await db.storage.from(BUCKET).remove(paths);
    if (removeError) {
      // Leave them queued; the next night tries again.
      console.error("purge-deleted: removing files failed", removeError.name);
      return json(502, { error: "could not remove files", rowsPurged: Number(purged ?? 0), filesRemoved });
    }
    const { error: forgetError } = await db.rpc("finish_storage_cleanup", { p_paths: paths });
    if (forgetError) {
      console.error("purge-deleted: forgetting removed files failed", forgetError.code);
      return json(500, { error: "could not update the file queue", rowsPurged: Number(purged ?? 0), filesRemoved });
    }
    filesRemoved += paths.length;
  }
  return json(200, { rowsPurged: Number(purged ?? 0), filesRemoved });
});
