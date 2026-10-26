-- Attachment files. The file bytes live in a private Storage bucket, one folder per task
-- (`<task id>/<attachment id>-<name>`); the `attachments` table holds the metadata. Whoever can see
-- the task's workspace can read and add files for it, and only the uploader or an admin can remove
-- one. The rules are two functions (so they can be tested without Storage); the bucket and its
-- policies are created only where Supabase's storage schema exists. Files are downloaded through
-- short-lived signed links as downloads, never shown inline, so an uploaded page cannot run.

-- The task id named by a storage path, or null when the path is not `<uuid>/<something>` (or tries
-- to climb out with `..`).
create function private.attachment_task(path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+'
      and path !~ '(^|/)\.\.(/|$)'
    then split_part(path, '/', 1)::uuid
  end;
$$;

create function private.can_access_attachment_path(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = private.attachment_task(path)
      and t.workspace_id in (select private.my_workspace_ids())
  );
$$;

create function private.can_delete_attachment_path(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attachments a
    where a.storage_path = path
      and a.workspace_id in (select private.my_workspace_ids())
      and (a.created_by = (select auth.uid()) or a.workspace_id in (select private.my_admin_workspace_ids()))
  );
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('attachments', 'attachments', false, 10485760)
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

    execute $p$
      create policy attachments_files_select on storage.objects for select to authenticated
        using (bucket_id = 'attachments' and private.can_access_attachment_path(name))
    $p$;
    execute $p$
      create policy attachments_files_insert on storage.objects for insert to authenticated
        with check (bucket_id = 'attachments' and private.can_access_attachment_path(name))
    $p$;
    execute $p$
      create policy attachments_files_delete on storage.objects for delete to authenticated
        using (bucket_id = 'attachments' and private.can_delete_attachment_path(name))
    $p$;
  end if;
end
$$;
