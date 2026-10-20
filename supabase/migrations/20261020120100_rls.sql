-- Row-level security. Rule of thumb: you see and change a row only if you are a
-- member of its workspace. Anonymous users get nothing (every policy is
-- `to authenticated`). Rows are never hard-deleted through the API: clients set
-- deleted_at, and private.purge_deleted() removes old tombstones.

-- ---------------------------------------------------------------------------
-- Policy helpers live in a schema that is not exposed through the API, so they
-- cannot be called via /rpc. They are SECURITY DEFINER so policies on
-- workspace_members cannot recurse, and they return sets so a policy can say
-- `workspace_id in (select private.my_workspace_ids())`. That subquery does not
-- reference the row, so Postgres evaluates it once per statement, not per row.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.my_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid());
$$;

create function private.my_admin_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'admin');
$$;

create function private.co_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct b.user_id
  from public.workspace_members a
  join public.workspace_members b on b.workspace_id = a.workspace_id
  where a.user_id = (select auth.uid());
$$;

revoke execute on function private.my_workspace_ids() from public, anon;
revoke execute on function private.my_admin_workspace_ids() from public, anon;
revoke execute on function private.co_member_ids() from public, anon;
grant execute on function private.my_workspace_ids() to authenticated;
grant execute on function private.my_admin_workspace_ids() to authenticated;
grant execute on function private.co_member_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Immutable columns. A WITH CHECK cannot compare against the old row, so
-- ownership, tenancy and authorship columns are frozen by trigger: nobody can
-- reassign a workspace owner, move a row to another workspace, or forge its
-- creator. Three narrow exceptions:
--   * move_project() and transfer_workspace() set a transaction-local flag.
--   * Referential SET NULL actions (account deletion) may null a column. They
--     run one trigger level deeper than a direct statement, so a client's own
--     UPDATE (depth 1) cannot use this.
-- ---------------------------------------------------------------------------
create function public.forbid_column_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
  old_v jsonb;
  new_v jsonb;
begin
  foreach col in array tg_argv loop
    old_v := to_jsonb(old) -> col;
    new_v := to_jsonb(new) -> col;
    if new_v is not distinct from old_v then
      continue;
    end if;
    if col = 'workspace_id' and current_setting('app.allow_workspace_move', true) = 'on' then
      continue;
    end if;
    if col = 'owner_id' and current_setting('app.allow_owner_change', true) = 'on' then
      continue;
    end if;
    if new_v = 'null'::jsonb and pg_trigger_depth() > 1 then
      continue;
    end if;
    raise exception 'column "%" of %.% cannot be changed', col, tg_table_schema, tg_table_name
      using errcode = '42501';
  end loop;
  return new;
end;
$$;

create trigger workspaces_immutable before update on public.workspaces
  for each row execute function public.forbid_column_change('owner_id');
create trigger workspace_members_immutable before update on public.workspace_members
  for each row execute function public.forbid_column_change('workspace_id', 'user_id');
create trigger projects_immutable before update on public.projects
  for each row execute function public.forbid_column_change('workspace_id');
create trigger sections_immutable before update on public.sections
  for each row execute function public.forbid_column_change('workspace_id', 'project_id');
create trigger labels_immutable before update on public.labels
  for each row execute function public.forbid_column_change('workspace_id');
create trigger tasks_immutable before update on public.tasks
  for each row execute function public.forbid_column_change('workspace_id', 'created_by');
create trigger task_labels_immutable before update on public.task_labels
  for each row execute function public.forbid_column_change('workspace_id', 'task_id', 'label_id');
create trigger reminders_immutable before update on public.reminders
  for each row execute function public.forbid_column_change('workspace_id', 'task_id', 'user_id');
create trigger comments_immutable before update on public.comments
  for each row execute function public.forbid_column_change('workspace_id', 'task_id', 'author_id');
create trigger attachments_immutable before update on public.attachments
  for each row execute function
    public.forbid_column_change('workspace_id', 'task_id', 'created_by', 'storage_path');
create trigger time_entries_immutable before update on public.time_entries
  for each row execute function public.forbid_column_change('workspace_id', 'task_id', 'user_id');
create trigger saved_filters_immutable before update on public.saved_filters
  for each row execute function public.forbid_column_change('workspace_id', 'owner_id');

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects          enable row level security;
alter table public.sections          enable row level security;
alter table public.labels            enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_labels       enable row level security;
alter table public.reminders         enable row level security;
alter table public.comments          enable row level security;
alter table public.attachments       enable row level security;
alter table public.task_completions  enable row level security;
alter table public.activity_log      enable row level security;
alter table public.time_entries      enable row level security;
alter table public.saved_filters     enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: yourself, plus people you share a workspace with. Rows are created
-- by the sign-up trigger, so there is no insert policy.
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or id in (select private.co_member_ids()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- workspaces. The owner clause in select lets INSERT ... RETURNING work before
-- the membership trigger row is visible. Ownership changes only through
-- transfer_workspace().
-- ---------------------------------------------------------------------------
create policy workspaces_select on public.workspaces for select to authenticated
  using (owner_id = (select auth.uid()) or id in (select private.my_workspace_ids()));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy workspaces_update on public.workspaces for update to authenticated
  using (id in (select private.my_admin_workspace_ids()))
  with check (id in (select private.my_admin_workspace_ids()));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- workspace_members. There is deliberately NO insert policy: nobody can be put
-- into a workspace without consent. Members join through a server-side invite
-- flow (M6); the owner row is created by trigger. Owner rows are immutable here.
-- ---------------------------------------------------------------------------
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
create policy workspace_members_update on public.workspace_members for update to authenticated
  using (workspace_id in (select private.my_admin_workspace_ids()) and role <> 'owner')
  with check (workspace_id in (select private.my_admin_workspace_ids())
    and role in ('admin', 'member'));
create policy workspace_members_delete on public.workspace_members for delete to authenticated
  using (
    role <> 'owner'
    and (workspace_id in (select private.my_admin_workspace_ids())
         or user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Plain workspace-scoped synced tables: any member may read, create and update
-- (soft delete is an update). No delete policy.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['projects', 'sections', 'labels', 'task_labels'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (workspace_id in (select private.my_workspace_ids()))', t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (workspace_id in (select private.my_workspace_ids()))', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (workspace_id in (select private.my_workspace_ids()))
         with check (workspace_id in (select private.my_workspace_ids()))', t || '_update', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks: members read/write; the creator is recorded and cannot be forged.
-- ---------------------------------------------------------------------------
create policy tasks_select on public.tasks for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    workspace_id in (select private.my_workspace_ids()) and created_by = (select auth.uid())
  );
create policy tasks_update on public.tasks for update to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- Per-user rows inside a workspace: reminders, time entries, saved filters.
-- ---------------------------------------------------------------------------
create policy reminders_select on public.reminders for select to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
create policy reminders_insert on public.reminders for insert to authenticated
  with check (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
create policy reminders_update on public.reminders for update to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
  with check (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));

create policy time_entries_select on public.time_entries for select to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
create policy time_entries_update on public.time_entries for update to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
  with check (user_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));

create policy saved_filters_select on public.saved_filters for select to authenticated
  using (owner_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
create policy saved_filters_insert on public.saved_filters for insert to authenticated
  with check (owner_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
create policy saved_filters_update on public.saved_filters for update to authenticated
  using (owner_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
  with check (owner_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- Comments, attachments and completion history
-- ---------------------------------------------------------------------------
create policy comments_select on public.comments for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
create policy comments_insert on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids())
  );
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
  with check (author_id = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()));

create policy attachments_select on public.attachments for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (
    created_by = (select auth.uid()) and workspace_id in (select private.my_workspace_ids())
  );
-- Soft delete: the uploader or a workspace admin.
create policy attachments_update on public.attachments for update to authenticated
  using (
    workspace_id in (select private.my_workspace_ids())
    and (created_by = (select auth.uid()) or workspace_id in (select private.my_admin_workspace_ids()))
  )
  with check (
    workspace_id in (select private.my_workspace_ids())
    and (created_by = (select auth.uid()) or workspace_id in (select private.my_admin_workspace_ids()))
  );

-- Append-only history: readable by members, written by the member who completed it.
create policy task_completions_select on public.task_completions for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
create policy task_completions_insert on public.task_completions for insert to authenticated
  with check (
    completed_by = (select auth.uid()) and workspace_id in (select private.my_workspace_ids())
  );

-- ---------------------------------------------------------------------------
-- activity_log: members can read; writes happen only through server-side code
-- (service role / SECURITY DEFINER), so there are no insert/update/delete policies.
-- ---------------------------------------------------------------------------
create policy activity_log_select on public.activity_log for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));

-- ---------------------------------------------------------------------------
-- transfer_workspace: the owner hands the workspace to an existing member (the
-- old owner becomes an admin). Required before an owner can delete their account.
-- ---------------------------------------------------------------------------
create function public.transfer_workspace(ws uuid, new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  perform 1 from public.workspaces w where w.id = ws and w.owner_id = caller for update;
  if not found then
    raise exception 'only the owner can transfer a workspace' using errcode = '42501';
  end if;
  if new_owner = caller then
    raise exception 'you already own this workspace' using errcode = '22023';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = new_owner;
  if not found then
    raise exception 'the new owner must already be a member' using errcode = '22023';
  end if;

  perform set_config('app.allow_owner_change', 'on', true);
  -- Demote first: at most one owner per workspace is enforced by a unique index.
  update public.workspace_members set role = 'admin'
    where workspace_id = ws and user_id = caller;
  update public.workspace_members set role = 'owner'
    where workspace_id = ws and user_id = new_owner;
  update public.workspaces set owner_id = new_owner where id = ws;
  perform set_config('app.allow_owner_change', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- move_project: share (or unshare) a project by moving it, with its sections,
-- tasks and everything attached to them, to another workspace the caller belongs
-- to. Workspace_id is otherwise immutable. Labels are matched by name in the
-- target (created if missing); assignees who are not members of the target are
-- cleared; reminders, time entries and history move with their tasks.
-- ---------------------------------------------------------------------------
create function public.move_project(project uuid, target_ws uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  source_ws uuid;
  links jsonb;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.workspace_id into source_ws
  from public.projects p where p.id = project and p.deleted_at is null for update;
  -- Same message whether the project is missing or not yours: no existence leak.
  if source_ws is null or not exists (
    select 1 from public.workspace_members m where m.workspace_id = source_ws and m.user_id = caller
  ) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspace_members m where m.workspace_id = target_ws and m.user_id = caller
  ) then
    raise exception 'you are not a member of the target workspace' using errcode = '42501';
  end if;
  if source_ws = target_ws then
    raise exception 'the project is already in that workspace' using errcode = '22023';
  end if;

  -- 1. Make sure every label used by the project exists in the target.
  insert into public.labels (workspace_id, name, color)
  select distinct on (lower(l.name)) target_ws, l.name, l.color
  from public.task_labels tl
  join public.tasks t on t.id = tl.task_id and t.workspace_id = tl.workspace_id
  join public.labels l on l.id = tl.label_id and l.workspace_id = tl.workspace_id
  where t.project_id = project and tl.deleted_at is null and l.deleted_at is null
    and not exists (
      select 1 from public.labels x
      where x.workspace_id = target_ws and lower(x.name) = lower(l.name) and x.deleted_at is null
    )
  order by lower(l.name);

  -- 2. Detach label links (they point at source-workspace labels); remember them.
  with detached as (
    delete from public.task_labels tl
    using public.tasks t, public.labels l
    where t.id = tl.task_id and t.workspace_id = tl.workspace_id
      and l.id = tl.label_id and l.workspace_id = tl.workspace_id
      and t.project_id = project
    returning tl.task_id, lower(l.name) as label_name, tl.deleted_at
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('task', task_id, 'label', label_name))
             filter (where deleted_at is null),
           '[]'::jsonb)
  into links
  from detached;

  -- 3. Clear assignees who are not members of the target workspace.
  update public.tasks t set assignee_id = null
  where t.project_id = project and t.assignee_id is not null
    and not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = target_ws and m.user_id = t.assignee_id
    );

  -- 4. Move the project; ON UPDATE CASCADE carries sections, tasks and their children.
  perform set_config('app.allow_workspace_move', 'on', true);
  update public.projects set workspace_id = target_ws where id = project;
  perform set_config('app.allow_workspace_move', 'off', true);

  -- 5. Re-attach labels using the target workspace's labels.
  insert into public.task_labels (task_id, label_id, workspace_id)
  select (e.item ->> 'task')::uuid, l.id, target_ws
  from jsonb_array_elements(links) as e (item)
  join public.labels l
    on l.workspace_id = target_ws and lower(l.name) = e.item ->> 'label' and l.deleted_at is null
  on conflict do nothing;
end;
$$;

revoke execute on function public.transfer_workspace(uuid, uuid) from public, anon;
revoke execute on function public.move_project(uuid, uuid) from public, anon;
grant execute on function public.transfer_workspace(uuid, uuid) to authenticated;
grant execute on function public.move_project(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- purge_deleted: permanently remove soft-deleted rows older than the retention
-- window. Not callable through the API; schedule it with pg_cron (service role).
-- Deleting a task or project cascades to the rows that hang off it. Attachment
-- files in Storage must be removed by the caller before purging.
-- ---------------------------------------------------------------------------
create function private.purge_deleted(retention interval default interval '30 days')
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
  return total;
end;
$$;

revoke execute on function private.purge_deleted(interval) from public, anon, authenticated;
