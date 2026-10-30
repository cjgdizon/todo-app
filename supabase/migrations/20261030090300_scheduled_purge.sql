-- Cleaning up what people deleted. Deleting a task only marks it deleted; `private.purge_deleted()`
-- removes such rows for good after 30 days, but nothing ever ran it, so deleted tasks, comments and
-- attachment records stayed forever. And removing an attachment row alone leaves its file behind in
-- Storage. Each night the `purge-deleted` Edge Function now asks for the files that are about to
-- lose their rows, removes them through the Storage API, and only then purges the rows. Server only.

-- Storage paths of attachments that were deleted, or whose task was deleted, longer ago than
-- `retention`: exactly the attachment rows the purge is about to drop.
create function public.expired_attachment_paths(retention interval default interval '30 days')
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select a.storage_path
  from public.attachments a
  where a.deleted_at < now() - retention
     or a.task_id in (select t.id from public.tasks t where t.deleted_at < now() - retention)
  order by a.storage_path;
$$;

-- `private.purge_deleted` is not reachable through the API; this is the door for the Edge Function.
create function public.purge_deleted_rows(retention interval default interval '30 days')
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.purge_deleted(retention);
$$;

revoke execute on function public.expired_attachment_paths(interval) from public, anon, authenticated;
revoke execute on function public.purge_deleted_rows(interval) from public, anon, authenticated;
grant execute on function public.expired_attachment_paths(interval) to service_role;
grant execute on function public.purge_deleted_rows(interval) to service_role;

-- Every night at 03:17 UTC (same arrangement as the reminder sender: the function's address and a
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
        'purge-deleted',
        '17 3 * * *',
        $cmd$
          select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'purge_function_url'),
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'purge_cron_secret')
            ),
            body := '{}'::jsonb
          )
          where exists (select 1 from vault.decrypted_secrets where name = 'purge_function_url')
            and exists (select 1 from vault.decrypted_secrets where name = 'purge_cron_secret')
        $cmd$
      )
    $job$;
  end if;
end
$$;
