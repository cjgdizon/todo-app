-- Calendar sync: the server-only helpers around Supabase Vault (where each person's Google refresh
-- token lives; Vault is not reachable through the REST API, so the Edge Functions use these), and
-- the cron job that runs the sync every minute. Only the service role can call any of it. The
-- functions look inside `vault` when they run, so this file also loads where Vault does not exist
-- (the plain Postgres of the DB tests); they are exercised against the local Supabase stack.

-- Stores a new refresh token, switches sync on for the person and queues their existing tasks that
-- have a due date. Replacing an earlier connection deletes its old token.
create function public.save_calendar_connection(
  p_user uuid, p_workspace uuid, p_refresh_token text, p_calendar_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_secret uuid;
  new_secret uuid;
begin
  select vault_secret_id into old_secret from public.calendar_integrations where user_id = p_user;
  new_secret := vault.create_secret(
    p_refresh_token, 'gcal-' || p_user::text || '-' || gen_random_uuid()::text, 'Google Calendar refresh token'
  );

  insert into public.calendar_integrations (user_id, workspace_id, enabled, calendar_id, vault_secret_id, status, status_detail)
  values (p_user, p_workspace, true, p_calendar_id, new_secret, 'active', null)
  on conflict (user_id) do update
    set workspace_id = excluded.workspace_id, enabled = true, calendar_id = excluded.calendar_id,
        vault_secret_id = excluded.vault_secret_id, status = 'active', status_detail = null,
        sync_token = null, last_synced_at = null, updated_at = now();

  if old_secret is not null then
    delete from vault.secrets where id = old_secret;
  end if;

  insert into public.calendar_sync_queue (user_id, task_id, workspace_id)
  select p_user, t.id, t.workspace_id
  from public.tasks t
  where t.workspace_id = p_workspace and t.deleted_at is null and t.completed_at is null and t.due_at is not null
  on conflict (user_id, task_id) do nothing;
end;
$$;

create function public.get_calendar_refresh_token(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  token text;
begin
  select s.decrypted_secret into token
  from public.calendar_integrations i
  join vault.decrypted_secrets s on s.id = i.vault_secret_id
  where i.user_id = p_user;
  return token;
end;
$$;

-- Ends the integration: the token is deleted with it (see the schema migration), and the links and
-- anything still queued for the person go too.
create function public.disconnect_calendar(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.calendar_sync_queue where user_id = p_user;
  delete from public.task_calendar_links where user_id = p_user;
  delete from public.calendar_integrations where user_id = p_user;
$$;

revoke execute on function public.save_calendar_connection(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.get_calendar_refresh_token(uuid) from public, anon, authenticated;
revoke execute on function public.disconnect_calendar(uuid) from public, anon, authenticated;
grant execute on function public.save_calendar_connection(uuid, uuid, text, text) to service_role;
grant execute on function public.get_calendar_refresh_token(uuid) to service_role;
grant execute on function public.disconnect_calendar(uuid) to service_role;

-- Run the sync every minute (same arrangement as the reminder sender: the function's address and a
-- shared secret are read from Vault when the job runs, and until both are set it does nothing).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
    and exists (select 1 from pg_available_extensions where name = 'pg_net')
    and exists (select 1 from pg_namespace where nspname = 'vault') then
    execute 'create extension if not exists pg_cron';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule(
        'gcal-sync',
        '* * * * *',
        $cmd$
          select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'gcal_sync_function_url'),
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gcal_cron_secret')
            ),
            body := '{}'::jsonb
          )
          where exists (select 1 from vault.decrypted_secrets where name = 'gcal_sync_function_url')
            and exists (select 1 from vault.decrypted_secrets where name = 'gcal_cron_secret')
        $cmd$
      )
    $job$;
  end if;
end
$$;
