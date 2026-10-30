-- The nightly purge, made safe for files. The first version listed the files to delete and then
-- purged the rows, which could leave files behind: the list capped at 1000 paths, rows that cascade
-- (a live task inside a purged project) were never listed, and rows could expire between the two
-- steps. Now the purge itself writes down the file of every attachment row it removes, in the same
-- transaction, into `storage_cleanup`; the Edge Function removes those files from Storage afterwards
-- and forgets each one only once it is gone, so a failed night simply continues the next night.
-- A file that another row still points at is never queued. Server only.
drop function public.expired_attachment_paths(interval);
drop function public.purge_deleted_rows(interval);

create table public.storage_cleanup (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table public.storage_cleanup enable row level security;
revoke all on public.storage_cleanup from anon, authenticated;
grant select, insert, update, delete on public.storage_cleanup to service_role;

-- Purges rows deleted before `p_cutoff` and queues the files that lost their last attachment row.
-- shortcut: it compares every attachment path before and after, which is fine for thousands of
-- attachments; switch to collecting the deleted rows if that table ever gets large.
create function public.purge_deleted_rows(p_cutoff timestamptz default now() - interval '30 days')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_paths text[];
  purged bigint;
begin
  select array_agg(distinct a.storage_path) into before_paths from public.attachments a;
  -- `now()` is the same instant throughout this call, so the cutoff is exactly p_cutoff.
  purged := private.purge_deleted(now() - p_cutoff);
  insert into public.storage_cleanup (path)
  select p
  from unnest(coalesce(before_paths, '{}'::text[])) as p
  where not exists (select 1 from public.attachments a where a.storage_path = p)
  on conflict do nothing;
  return purged;
end;
$$;

-- The next files to remove from Storage, oldest first.
create function public.next_storage_cleanup(batch integer default 100)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.path from public.storage_cleanup c order by c.queued_at, c.path limit greatest(batch, 1);
$$;

-- Forgets files that are gone from Storage.
create function public.finish_storage_cleanup(p_paths text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.storage_cleanup where path = any(p_paths);
$$;

revoke execute on function public.purge_deleted_rows(timestamptz) from public, anon, authenticated;
revoke execute on function public.next_storage_cleanup(integer) from public, anon, authenticated;
revoke execute on function public.finish_storage_cleanup(text[]) from public, anon, authenticated;
grant execute on function public.purge_deleted_rows(timestamptz) to service_role;
grant execute on function public.next_storage_cleanup(integer) to service_role;
grant execute on function public.finish_storage_cleanup(text[]) to service_role;
