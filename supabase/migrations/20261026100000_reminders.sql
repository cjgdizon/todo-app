-- Reminders. A reminder is "N minutes before this task is due", for one person. The database turns
-- that into a time (`remind_at`) and recomputes it when the task is rescheduled, so a recurring task
-- is reminded again for each occurrence. An all-day task counts as due at 09:00 local time. People
-- set and clear reminders through the two functions below (no direct writes), and a scheduled
-- Edge Function collects what is due through `claim_due_reminders` and sends the notifications.
alter table public.reminders
  add column offset_min integer not null default 0 check (offset_min between 0 and 40320);

create unique index reminders_one_per_person_idx on public.reminders (task_id, user_id)
  where deleted_at is null;

revoke insert, update, delete on public.reminders from authenticated;

create function private.reminder_time(due timestamptz, all_day boolean, zone text, offset_min integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when all_day then ((due at time zone coalesce(zone, 'UTC')) + interval '9 hours') at time zone coalesce(zone, 'UTC')
    else due
  end - make_interval(mins => offset_min);
$$;

create function public.set_task_reminder(p_task uuid, p_offset_min integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  found_task record;
  fire_at timestamptz;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_offset_min is null or p_offset_min < 0 or p_offset_min > 40320 then
    raise exception 'invalid reminder time' using errcode = '22023';
  end if;

  select t.id, t.workspace_id, t.due_at, t.due_all_day, t.due_tz into found_task
  from public.tasks t
  where t.id = p_task and t.deleted_at is null and t.workspace_id in (select private.my_workspace_ids());
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if found_task.due_at is null then
    raise exception 'this task has no due date' using errcode = '22023';
  end if;

  fire_at := private.reminder_time(found_task.due_at, found_task.due_all_day, found_task.due_tz, p_offset_min);
  if fire_at <= now() then
    raise exception 'that time has already passed' using errcode = '22023';
  end if;

  insert into public.reminders (workspace_id, task_id, user_id, remind_at, offset_min)
  values (found_task.workspace_id, found_task.id, caller, fire_at, p_offset_min)
  on conflict (task_id, user_id) where deleted_at is null
  do update set remind_at = excluded.remind_at, offset_min = excluded.offset_min, sent_at = null;
end;
$$;

create function public.clear_task_reminder(p_task uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reminders set deleted_at = now()
  where task_id = p_task and user_id = (select auth.uid()) and deleted_at is null;
$$;

-- Moving or removing the due date moves or removes the reminders hanging off it.
create function private.rearm_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.due_at is null then
    update public.reminders set deleted_at = now()
    where task_id = new.id and workspace_id = new.workspace_id and deleted_at is null;
  else
    update public.reminders r
    set remind_at = private.reminder_time(new.due_at, new.due_all_day, new.due_tz, r.offset_min), sent_at = null
    where r.task_id = new.id and r.workspace_id = new.workspace_id and r.deleted_at is null;
  end if;
  return null;
end;
$$;

create trigger tasks_rearm_reminders after update of due_at, due_all_day, due_tz on public.tasks
  for each row
  when (old.due_at is distinct from new.due_at
    or old.due_all_day is distinct from new.due_all_day
    or old.due_tz is distinct from new.due_tz)
  execute function private.rearm_reminders();

-- For the sender only. Marks what it returns as sent in the same statement, so two overlapping
-- runs never send the same reminder twice (a failed send is lost rather than repeated). Reminders
-- more than a day late are dropped, and so are those of finished or deleted tasks and of people
-- who are no longer in the workspace.
create function public.claim_due_reminders(batch integer default 100)
returns table (
  reminder_id uuid,
  user_id uuid,
  task_id uuid,
  workspace_id uuid,
  title text,
  due_at timestamptz,
  due_all_day boolean,
  time_zone text,
  tokens text[]
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.reminders set sent_at = now()
  where sent_at is null and deleted_at is null and remind_at < now() - interval '1 day';

  return query
  with due as (
    select r.id
    from public.reminders r
    join public.tasks t on t.id = r.task_id and t.workspace_id = r.workspace_id
    join public.workspace_members m on m.workspace_id = r.workspace_id and m.user_id = r.user_id
    where r.sent_at is null and r.deleted_at is null and r.remind_at <= now()
      and t.deleted_at is null and t.completed_at is null
    order by r.remind_at, r.id
    limit greatest(batch, 1)
    for update of r skip locked
  ), claimed as (
    update public.reminders r set sent_at = now() from due where r.id = due.id returning r.*
  )
  select c.id, c.user_id, c.task_id, c.workspace_id, t.title, t.due_at, t.due_all_day,
         coalesce(t.due_tz, p.timezone),
         coalesce((select array_agg(k.token order by k.token) from public.push_tokens k where k.user_id = c.user_id), '{}')
  from claimed c
  join public.tasks t on t.id = c.task_id and t.workspace_id = c.workspace_id
  join public.profiles p on p.id = c.user_id;
end;
$$;

-- Devices the push service reports as gone, so they are not tried again.
create function public.forget_push_tokens(p_tokens text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = any (p_tokens);
$$;

revoke execute on function public.set_task_reminder(uuid, integer) from public, anon;
revoke execute on function public.clear_task_reminder(uuid) from public, anon;
grant execute on function public.set_task_reminder(uuid, integer) to authenticated;
grant execute on function public.clear_task_reminder(uuid) to authenticated;

revoke execute on function public.claim_due_reminders(integer) from public, anon, authenticated;
revoke execute on function public.forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;
grant execute on function public.forget_push_tokens(text[]) to service_role;

-- Run the sender every minute. Needs the pg_cron and pg_net extensions (present on Supabase, not in
-- the plain Postgres the DB tests use, where this does nothing). The function's address and shared
-- secret are read from Vault when the job runs; until both are set, the job does nothing.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
    and exists (select 1 from pg_available_extensions where name = 'pg_net')
    and exists (select 1 from pg_namespace where nspname = 'vault') then
    execute 'create extension if not exists pg_cron';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule(
        'send-reminders',
        '* * * * *',
        $cmd$
          select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_function_url'),
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
            ),
            body := '{}'::jsonb
          )
          where exists (select 1 from vault.decrypted_secrets where name = 'reminders_function_url')
            and exists (select 1 from vault.decrypted_secrets where name = 'reminders_cron_secret')
        $cmd$
      )
    $job$;
  end if;
end
$$;
