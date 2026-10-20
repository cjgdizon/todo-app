-- Core schema: workspaces, projects, tasks and supporting tables.
-- Row-level security is enabled in the next migration; do not apply this one
-- to a shared database without it.
--
-- Conventions
--  * Every row belongs to one workspace; composite (id, workspace_id) foreign keys
--    keep references inside that workspace.
--  * "Synced" tables carry created_at, updated_at, version, updated_by and
--    deleted_at, all maintained by the sync_columns trigger (clients cannot set
--    them). Deletes are soft: set deleted_at. Rows are purged after a retention
--    window by private.purge_deleted(). Clients doing an incremental pull should
--    read `updated_at > cursor - 5 seconds` and dedupe by (id, version), because
--    now() is the transaction start time and long transactions can commit late.
--  * Lists are ordered by `order by position, id`; `position` is a fractional
--    index and `id` breaks ties between keys created concurrently offline.

-- ---------------------------------------------------------------------------
-- Server-owned columns for synced tables. A client cannot choose version,
-- timestamps or updated_by, and cannot rewrite created_at.
-- ---------------------------------------------------------------------------
create function public.sync_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
    new.deleted_at := null;
  else
    new.created_at := old.created_at;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Time zone columns must hold an IANA name such as "Asia/Manila", which both
-- Postgres and JavaScript's Intl understand. Postgres also accepts POSIX
-- abbreviations ("EST", "PST8PDT") that JavaScript does not, and those would make
-- the recurrence code throw, so they are rejected. The column name is the trigger
-- argument.
-- ---------------------------------------------------------------------------
create function public.check_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text := tg_argv[0];
  tz text := to_jsonb(new) ->> col;
begin
  if tz is null then
    return new;
  end if;
  if tz !~ '^[A-Za-z0-9_+-]+/[A-Za-z0-9_+/-]+$' and tz not in ('UTC', 'GMT') then
    raise exception '% must be an IANA time zone name such as Asia/Manila', col
      using errcode = '23514';
  end if;
  begin
    perform now() at time zone tz;
  exception when invalid_parameter_value then
    raise exception 'time zone "%" is not recognized', tz using errcode = '23514';
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  created_at timestamptz not null default now()
);
create trigger profiles_check_tz before insert or update of timezone on public.profiles
  for each row execute function public.check_time_zone('timezone');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  -- RESTRICT: an owner cannot be deleted while they still own a workspace. The
  -- account-deletion flow must call transfer_workspace() (or delete the
  -- workspace on purpose) first, so shared data is never lost silently.
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index workspaces_owner_id_idx on public.workspaces (owner_id);

create type public.workspace_role as enum ('owner', 'admin', 'member');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members (user_id);
-- Exactly one owner per workspace.
create unique index workspace_members_one_owner_idx on public.workspace_members (workspace_id)
  where role = 'owner';

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text check (color is null or char_length(color) <= 32),
  position text not null collate "C" check (char_length(position) <= 128),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  -- Target for composite foreign keys that must stay inside one workspace.
  unique (id, workspace_id)
);
create index projects_workspace_id_idx on public.projects (workspace_id);
create index projects_sync_idx on public.projects (workspace_id, updated_at);
create trigger projects_sync before insert or update on public.projects
  for each row execute function public.sync_columns();

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  position text not null collate "C" check (char_length(position) <= 128),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (id, workspace_id),
  unique (id, project_id),
  -- ON UPDATE CASCADE lets move_project() change a project's workspace in one statement.
  foreign key (project_id, workspace_id)
    references public.projects (id, workspace_id) on delete cascade on update cascade
);
create index sections_project_id_idx on public.sections (project_id, workspace_id);
create index sections_sync_idx on public.sections (workspace_id, updated_at);
create trigger sections_sync before insert or update on public.sections
  for each row execute function public.sync_columns();

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  color text check (color is null or char_length(color) <= 32),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (id, workspace_id)
);
-- A deleted label's name can be reused.
create unique index labels_workspace_name_idx on public.labels (workspace_id, lower(name))
  where deleted_at is null;
create index labels_sync_idx on public.labels (workspace_id, updated_at);
create trigger labels_sync before insert or update on public.labels
  for each row execute function public.sync_columns();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid,                 -- null = Inbox
  section_id uuid,
  parent_id uuid,                  -- null = top-level task
  assignee_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  notes text check (notes is null or char_length(notes) <= 50000),
  priority smallint not null default 4 check (priority between 1 and 4),
  due_at timestamptz,
  due_all_day boolean not null default false,
  -- IANA zone the recurrence is evaluated in, so a shared task recurs the same
  -- way no matter who completes it.
  due_tz text check (due_tz is null or due_tz ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  rrule text check (rrule is null or char_length(rrule) <= 500),   -- RFC 5545 RRULE, see packages/core
  recur_after_completion boolean not null default false,
  estimate_min integer check (estimate_min is null or estimate_min > 0),
  position text not null collate "C" check (char_length(position) <= 128),   -- fractional index
  completed_at timestamptz,
  deleted_at timestamptz,          -- soft delete (trash)
  -- Authorship survives account deletion as NULL instead of deleting shared work.
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  search tsvector generated always as (
    to_tsvector('simple', title || ' ' || coalesce(notes, ''))
  ) stored,
  unique (id, workspace_id),
  check (parent_id is null or parent_id <> id),
  check (section_id is null or project_id is not null),
  check (rrule is null or (due_at is not null and due_tz is not null)),
  -- Every reference must stay inside the task's own workspace.
  foreign key (project_id, workspace_id)
    references public.projects (id, workspace_id) on delete cascade on update cascade,
  foreign key (section_id, project_id)
    references public.sections (id, project_id) on delete set null (section_id),
  foreign key (parent_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade on update cascade,
  foreign key (workspace_id, assignee_id)
    references public.workspace_members (workspace_id, user_id) on delete set null (assignee_id)
);
-- Open tasks in display order (project views, sections, subtasks).
create index tasks_open_order_idx on public.tasks
  (workspace_id, project_id, section_id, parent_id, position)
  where deleted_at is null and completed_at is null;
create index tasks_due_idx on public.tasks (workspace_id, due_at)
  where deleted_at is null and completed_at is null;
create index tasks_parent_idx on public.tasks (parent_id, workspace_id);
create index tasks_section_idx on public.tasks (section_id, project_id);
create index tasks_assignee_idx on public.tasks (workspace_id, assignee_id);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_sync_idx on public.tasks (workspace_id, updated_at);
create index tasks_search_idx on public.tasks using gin (search);
-- Supports the foreign key to projects (project delete/purge and move_project cascades).
-- The partial indexes above cannot serve those lookups.
create index tasks_project_fk_idx on public.tasks (project_id, workspace_id);
create trigger tasks_sync before insert or update on public.tasks
  for each row execute function public.sync_columns();
create trigger tasks_check_tz before insert or update of due_tz on public.tasks
  for each row execute function public.check_time_zone('due_tz');

-- Subtasks: same project as the parent, no cycles, at most 5 levels. A deferrable
-- constraint trigger (initially immediate) runs at the end of the statement, so
-- moving a whole subtree in one UPDATE sees a consistent final state.
create function public.check_task_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_project uuid;
  v_cycle boolean;
  v_depth integer;
begin
  -- Moving a parent to another project must move its subtasks in the same
  -- statement; otherwise they would be left behind in the old project.
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id and exists (
    select 1 from public.tasks c
    where c.parent_id = new.id and c.project_id is distinct from new.project_id
  ) then
    raise exception 'subtasks must stay in the same project as their parent; move them together'
      using errcode = '23514';
  end if;

  if new.parent_id is null then
    return null;
  end if;

  select t.project_id into v_parent_project from public.tasks t where t.id = new.parent_id;
  if v_parent_project is distinct from new.project_id then
    raise exception 'a subtask must be in the same project as its parent'
      using errcode = '23514';
  end if;

  with recursive chain (id, parent_id, lvl) as (
    select t.id, t.parent_id, 1 from public.tasks t where t.id = new.parent_id
    union all
    select t.id, t.parent_id, c.lvl + 1
    from public.tasks t join chain c on t.id = c.parent_id
    where c.lvl < 10
  )
  select coalesce(bool_or(id = new.id), false), coalesce(max(lvl), 0)
  into v_cycle, v_depth
  from chain;

  if v_cycle then
    raise exception 'a task cannot be its own ancestor' using errcode = '23514';
  end if;
  if v_depth + 1 > 5 then
    raise exception 'subtasks can be nested at most 5 levels deep' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger tasks_hierarchy
  after insert or update of parent_id, project_id on public.tasks
  deferrable initially immediate
  for each row execute function public.check_task_hierarchy();

create table public.task_labels (
  task_id uuid not null,
  label_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  primary key (task_id, label_id),
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade on update cascade,
  foreign key (label_id, workspace_id)
    references public.labels (id, workspace_id) on delete cascade
);
create index task_labels_label_idx on public.task_labels (label_id, workspace_id);
create index task_labels_workspace_idx on public.task_labels (workspace_id);
create index task_labels_sync_idx on public.task_labels (workspace_id, updated_at);
create trigger task_labels_sync before insert or update on public.task_labels
  for each row execute function public.sync_columns();

-- ---------------------------------------------------------------------------
-- Collaboration and tracking
-- ---------------------------------------------------------------------------
-- Reminders and time entries point at a profile, not at a membership row, so
-- moving a project to another workspace never fails or loses them. Row-level
-- security still limits who can see them, and delivery jobs must check that the
-- user is currently a member.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  remind_at timestamptz not null,
  sent_at timestamptz,             -- set once delivered; keeps delivery idempotent
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade on update cascade
);
create index reminders_due_idx on public.reminders (remind_at)
  where sent_at is null and deleted_at is null;
create index reminders_task_idx on public.reminders (task_id, workspace_id);
create index reminders_user_idx on public.reminders (user_id);
create index reminders_sync_idx on public.reminders (workspace_id, updated_at);
create trigger reminders_sync before insert or update on public.reminders
  for each row execute function public.sync_columns();

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade on update cascade
);
create index comments_task_idx on public.comments (task_id, workspace_id, created_at);
create index comments_author_idx on public.comments (author_id);
create index comments_sync_idx on public.comments (workspace_id, updated_at);
create trigger comments_sync before insert or update on public.comments
  for each row execute function public.sync_columns();

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null,
  -- Files live under the attachment's own task folder ("<task_id>/..."). Storage
  -- policies can then trust the row, and a row can never point at another task's
  -- (or another tenant's) files. Task ids never change, so a project move keeps it valid.
  storage_path text not null check (
    char_length(storage_path) <= 1024
    and storage_path like task_id::text || '/%'
    and storage_path !~ '(^|/)\.\.(/|$)'
  ),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text check (mime_type is null or char_length(mime_type) <= 255),
  size_bytes bigint not null check (size_bytes >= 0),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade on update cascade
);
create index attachments_task_idx on public.attachments (task_id, workspace_id);
create index attachments_created_by_idx on public.attachments (created_by);
create index attachments_sync_idx on public.attachments (workspace_id, updated_at);
create trigger attachments_sync before insert or update on public.attachments
  for each row execute function public.sync_columns();

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check (ended_at is null or ended_at >= started_at),
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade on update cascade
);
create index time_entries_task_idx on public.time_entries (task_id, workspace_id);
create index time_entries_user_idx on public.time_entries (user_id, started_at desc);
create index time_entries_sync_idx on public.time_entries (workspace_id, updated_at);
-- At most one running timer per user.
create unique index time_entries_one_running_idx on public.time_entries (user_id)
  where ended_at is null and deleted_at is null;
create trigger time_entries_sync before insert or update on public.time_entries
  for each row execute function public.sync_columns();

create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  query text not null check (char_length(query) between 1 and 500),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  foreign key (workspace_id, owner_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);
create index saved_filters_owner_idx on public.saved_filters (workspace_id, owner_id);
create index saved_filters_sync_idx on public.saved_filters (workspace_id, updated_at);
create trigger saved_filters_sync before insert or update on public.saved_filters
  for each row execute function public.sync_columns();

-- One row per completed occurrence of a task (streaks, stats, undo). Append-only:
-- completing a recurring task advances tasks.due_at, and this table keeps history.
create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null,
  occurrence_due_at timestamptz,
  completed_at timestamptz not null default now(),
  completed_by uuid default auth.uid() references public.profiles (id) on delete set null,
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade on update cascade
);
create index task_completions_task_idx on public.task_completions
  (task_id, workspace_id, completed_at desc);
create index task_completions_workspace_idx on public.task_completions
  (workspace_id, completed_at desc);
create index task_completions_by_idx on public.task_completions (completed_by);

-- Append-only audit trail. No foreign key to tasks so history outlives deletes.
create table public.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_workspace_idx on public.activity_log (workspace_id, created_at desc);
create index activity_log_actor_idx on public.activity_log (actor_id);

-- ---------------------------------------------------------------------------
-- Sign-up bootstrap: profile + "Personal" workspace + owner membership.
-- Runs as the table owner (SECURITY DEFINER); never callable through the API.
-- ---------------------------------------------------------------------------
create function public.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger workspaces_add_owner after insert on public.workspaces
  for each row execute function public.add_owner_membership();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), ''), 100)
  );
  insert into public.workspaces (name, owner_id) values ('Personal', new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.add_owner_membership() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
