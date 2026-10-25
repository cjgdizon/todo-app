-- Activity feed: triggers record what happened in a shared workspace. Clients can only read the
-- log (members of the workspace); every row is written here, as the table owner, so none can be
-- forged. A workspace with a single member logs nothing: there is nobody to inform, and personal
-- workspaces (and big imports) would otherwise fill the table. Comment text is never copied, only
-- the fact that a comment was added.
revoke insert, update, delete on public.activity_log from authenticated;

create function private.log_activity(
  ws uuid,
  task uuid,
  act text,
  details jsonb default '{}'::jsonb,
  actor uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Two rows are enough to know the workspace is shared.
  if (select count(*) from (select 1 from public.workspace_members m where m.workspace_id = ws limit 2) s) < 2 then
    return;
  end if;
  insert into public.activity_log (workspace_id, task_id, actor_id, action, meta)
  values (ws, task, actor, act, details);
end;
$$;

create function private.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, new.id, 'task_created', jsonb_build_object('title', new.title));
    return null;
  end if;

  if old.deleted_at is not null then
    return null; -- changes to a task in the trash are not news
  end if;
  if new.deleted_at is not null then
    perform private.log_activity(new.workspace_id, new.id, 'task_deleted', jsonb_build_object('title', new.title));
    return null;
  end if;
  if old.completed_at is null and new.completed_at is not null then
    perform private.log_activity(new.workspace_id, new.id, 'task_completed', jsonb_build_object('title', new.title));
  elsif old.completed_at is not null and new.completed_at is null then
    perform private.log_activity(new.workspace_id, new.id, 'task_reopened', jsonb_build_object('title', new.title));
  end if;
  if old.assignee_id is distinct from new.assignee_id then
    if new.assignee_id is null then
      perform private.log_activity(new.workspace_id, new.id, 'task_unassigned', jsonb_build_object('title', new.title));
    else
      perform private.log_activity(
        new.workspace_id, new.id, 'task_assigned',
        jsonb_build_object('title', new.title, 'assignee_id', new.assignee_id)
      );
    end if;
  end if;
  return null;
end;
$$;

create trigger tasks_log_insert after insert on public.tasks
  for each row execute function private.log_task_activity();
create trigger tasks_log_update after update of completed_at, assignee_id, deleted_at on public.tasks
  for each row execute function private.log_task_activity();

create function private.log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_activity(
    new.workspace_id, new.task_id, 'comment_added',
    jsonb_build_object('title', (select t.title from public.tasks t where t.id = new.task_id and t.workspace_id = new.workspace_id))
  );
  return null;
end;
$$;

create trigger comments_log_insert after insert on public.comments
  for each row execute function private.log_comment_activity();

create function private.log_member_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_activity(
    new.workspace_id, null, 'member_joined',
    jsonb_build_object('user_id', new.user_id, 'role', new.role),
    new.user_id
  );
  return null;
end;
$$;

create trigger workspace_members_log_insert after insert on public.workspace_members
  for each row execute function private.log_member_activity();

-- The log is trimmed with the other housekeeping: same function as before, plus entries older
-- than 180 days.
create or replace function private.purge_deleted(retention interval default interval '30 days')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  n bigint;
  total bigint := 0;
begin
  foreach t in array array[
    'tasks', 'projects', 'sections', 'labels', 'task_labels',
    'reminders', 'comments', 'attachments', 'time_entries', 'saved_filters'
  ] loop
    execute format('delete from public.%I where deleted_at < now() - $1', t) using retention;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  delete from public.activity_log where created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return total + n;
end;
$$;

-- Live updates for the feed (a no-op without the publication, as in the realtime migration).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log'
    ) then
    alter publication supabase_realtime add table public.activity_log;
  end if;
end
$$;
