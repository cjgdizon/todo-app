// The database side of the calendar sync for one person, with the service role. It is scoped to
// that person and their one workspace: it never reads or writes a task of any other workspace.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundApplied, LinkRecord, TaskStorePort } from "@todo/core/calendar-engine";
import type { SyncTask } from "@todo/core/calendar-sync";

const TASK_COLUMNS =
  "id,title,notes,due_at,due_all_day,due_tz,rrule,completed_at,deleted_at,estimate_min,version";
const LINK_COLUMNS = "task_id,google_event_id,etag,last_synced_version";

interface LinkRow {
  task_id: string;
  google_event_id: string;
  etag: string | null;
  last_synced_version: number;
}

const toLink = (row: LinkRow): LinkRecord => ({
  googleEventId: row.google_event_id,
  etag: row.etag,
  lastSyncedVersion: row.last_synced_version,
});

function fail(action: string, error: { code?: string } | null): never {
  throw new Error(`calendar store: ${action} failed${error?.code ? ` (${error.code})` : ""}`);
}

export function taskStore(db: SupabaseClient, userId: string, workspaceId: string): TaskStorePort {
  return {
    async getTask(taskId: string): Promise<SyncTask | null> {
      const { data, error } = await db.from("tasks").select(TASK_COLUMNS).eq("id", taskId).eq("workspace_id", workspaceId).maybeSingle();
      if (error) fail("reading a task", error);
      if (!data) return null;
      return {
        id: data.id,
        title: data.title,
        notes: data.notes,
        dueAt: data.due_at ? new Date(data.due_at) : null,
        dueAllDay: data.due_all_day,
        dueTz: data.due_tz,
        rrule: data.rrule,
        completedAt: data.completed_at ? new Date(data.completed_at) : null,
        deletedAt: data.deleted_at ? new Date(data.deleted_at) : null,
        estimateMin: data.estimate_min,
        version: data.version,
      };
    },

    async getLink(taskId: string) {
      const { data, error } = await db.from("task_calendar_links").select(LINK_COLUMNS).eq("user_id", userId).eq("task_id", taskId).maybeSingle();
      if (error) fail("reading a link", error);
      return data ? toLink(data as LinkRow) : null;
    },

    async getLinkByEvent(eventId: string) {
      const { data, error } = await db
        .from("task_calendar_links")
        .select(LINK_COLUMNS)
        .eq("user_id", userId)
        .eq("google_event_id", eventId)
        .maybeSingle();
      if (error) fail("reading a link", error);
      return data ? { ...toLink(data as LinkRow), taskId: (data as LinkRow).task_id } : null;
    },

    async saveLink(taskId: string, link: LinkRecord) {
      const { error } = await db.from("task_calendar_links").upsert(
        {
          task_id: taskId,
          workspace_id: workspaceId,
          user_id: userId,
          google_event_id: link.googleEventId,
          etag: link.etag,
          last_synced_version: link.lastSyncedVersion,
        },
        { onConflict: "task_id,user_id" },
      );
      if (error) fail("saving a link", error);
    },

    async deleteLink(taskId: string) {
      const { error } = await db.from("task_calendar_links").delete().eq("user_id", userId).eq("task_id", taskId);
      if (error) fail("removing a link", error);
    },

    async applyInbound(taskId: string, change: InboundApplied) {
      const update: Record<string, unknown> =
        change.kind === "cleared"
          ? { due_at: null, due_all_day: false, due_tz: null, rrule: null, recur_after_completion: false }
          : {
              ...(change.patch.title !== undefined ? { title: change.patch.title } : {}),
              notes: change.patch.notes,
              due_at: change.patch.dueAt.toISOString(),
              due_all_day: change.patch.dueAllDay,
              due_tz: change.patch.dueTz,
              ...("rrule" in change.patch ? { rrule: change.patch.rrule } : {}),
            };
      const { data, error } = await db.from("tasks").update(update).eq("id", taskId).eq("workspace_id", workspaceId).select("version").single();
      if (error) fail("applying a change from Google", error);
      return data.version as number;
    },
  };
}
