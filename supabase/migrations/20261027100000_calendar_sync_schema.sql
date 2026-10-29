-- Google Calendar sync (opt-in, per person): the data model. Everything that touches a Google
-- credential happens in Edge Functions with the service role. Clients may read their own status
-- and nothing else: the refresh token lives in Supabase Vault, and even the reference to it, the
-- sync cursor and the watch channel stay out of client reach (column-level grants).
create table public.calendar_integrations (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Whose tasks are synced. Leaving the workspace ends the integration.
  workspace_id uuid not null,
  enabled boolean not null default false,
  calendar_id text check (calendar_id is null or char_length(calendar_id) <= 255),
  sync_token text check (sync_token is null or char_length(sync_token) <= 2048),
  watch_channel_id text check (watch_channel_id is null or char_length(watch_channel_id) <= 255),
  watch_expires_at timestamptz,
  last_synced_at timestamptz,
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  status_detail text check (status_detail is null or char_length(status_detail) <= 500),
  vault_secret_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);
-- Covers the foreign key to workspace_members and the trigger's lookup of who has sync on in a workspace.
create index calendar_integrations_workspace_idx on public.calendar_integrations (workspace_id, user_id);

alter table public.calendar_integrations enable row level security;
create policy calendar_integrations_select_own on public.calendar_integrations
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.calendar_integrations from anon, authenticated;
grant select (user_id, workspace_id, enabled, calendar_id, last_synced_at, status, status_detail, created_at)
  on public.calendar_integrations to authenticated;
grant select, insert, update, delete on public.calendar_integrations to service_role;

-- Deleting an integration (disconnecting, or leaving the workspace) also deletes its stored token.
create function private.forget_calendar_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.vault_secret_id is not null and to_regclass('vault.secrets') is not null then
    execute 'delete from vault.secrets where id = $1' using old.vault_secret_id;
  end if;
  return old;
end;
$$;
create trigger calendar_integrations_forget_secret before delete on public.calendar_integrations
  for each row execute function private.forget_calendar_secret();

-- Which Google event stands for which task, for one person.
create table public.task_calendar_links (
  task_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  google_event_id text not null check (char_length(google_event_id) <= 1024),
  etag text check (etag is null or char_length(etag) <= 255),
  -- The task version this link last matched. A task at or below it came from the sync itself, so
  -- it is not sent back to Google (this is what stops changes bouncing between the two).
  last_synced_version integer not null default 0,
  primary key (task_id, user_id),
  unique (user_id, google_event_id),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);
create index task_calendar_links_workspace_idx on public.task_calendar_links (workspace_id);
create index task_calendar_links_task_idx on public.task_calendar_links (task_id, workspace_id);

alter table public.task_calendar_links enable row level security;
create policy task_calendar_links_select_own on public.task_calendar_links
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.task_calendar_links from anon, authenticated;
grant select on public.task_calendar_links to authenticated;
grant select, insert, update, delete on public.task_calendar_links to service_role;

-- Changed tasks wait here for the sync function (called every minute, like the reminder sender).
-- A task already waiting is not queued twice. There is no foreign key to tasks so that a removed
-- task can still be taken off the calendar.
create table public.calendar_sync_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  queued_at timestamptz not null default now(),
  unique (user_id, task_id)
);
create index calendar_sync_queue_workspace_idx on public.calendar_sync_queue (workspace_id);
alter table public.calendar_sync_queue enable row level security;
revoke all on public.calendar_sync_queue from anon, authenticated;
grant select, insert, update, delete on public.calendar_sync_queue to service_role;

create function private.queue_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.calendar_sync_queue (user_id, task_id, workspace_id)
  select i.user_id, new.id, new.workspace_id
  from public.calendar_integrations i
  where i.workspace_id = new.workspace_id and i.enabled
  on conflict (user_id, task_id) do nothing;
  return null;
end;
$$;

create trigger tasks_queue_calendar_insert after insert on public.tasks
  for each row execute function private.queue_calendar_sync();
create trigger tasks_queue_calendar_update
  after update of title, notes, due_at, due_all_day, due_tz, rrule, completed_at, deleted_at, estimate_min on public.tasks
  for each row execute function private.queue_calendar_sync();
