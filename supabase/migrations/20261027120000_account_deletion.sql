-- Deleting an account. A workspace's owner cannot simply vanish (owner_id is RESTRICT), so before the
-- account goes: workspaces the person owns that other people belong to must be handed over
-- (transfer_workspace), and the ones nobody else belongs to are deleted with the person. These
-- functions support the `delete-account` Edge Function; the work other people did survives (their
-- authorship simply becomes empty, see the lifecycle tests).

-- Workspaces `p_user` owns that someone else belongs to. Internal: callers go through the wrappers,
-- so nobody can ask about another person's workspaces.
create function private.shared_owned_workspaces(p_user uuid)
returns table (workspace_id uuid, name text, member_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, count(m.user_id)
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where w.owner_id = p_user
  group by w.id, w.name
  having count(m.user_id) > 1;
$$;
revoke execute on function private.shared_owned_workspaces(uuid) from public, anon, authenticated;

-- What the signed-in person has to hand over before they can delete their account.
create function public.account_deletion_blockers()
returns table (workspace_id uuid, name text, member_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.shared_owned_workspaces((select auth.uid()));
$$;
revoke execute on function public.account_deletion_blockers() from public, anon;
grant execute on function public.account_deletion_blockers() to authenticated;

-- The same question for the server, which has no signed-in person to ask about.
create function public.has_account_deletion_blockers(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.shared_owned_workspaces(p_user));
$$;

-- Storage paths of the attachments in the workspaces that go with the person (listed before they
-- are deleted, so their files can be removed from Storage too). Server only.
create function public.attachment_paths_of_owned_workspaces(p_user uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select a.storage_path
  from public.attachments a
  join public.workspaces w on w.id = a.workspace_id
  where w.owner_id = p_user
    and (select count(*) from public.workspace_members m where m.workspace_id = w.id) = 1
  order by a.storage_path;
$$;

-- Deletes the workspaces the person owns that no one else belongs to (and everything in them).
-- Refuses while any shared one is still theirs. Returns how many were deleted. Server only.
create function public.delete_owned_workspaces(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if exists (select 1 from private.shared_owned_workspaces(p_user)) then
    raise exception 'hand over the workspaces you share with others before deleting your account' using errcode = 'P0001';
  end if;
  delete from public.workspaces where owner_id = p_user;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.has_account_deletion_blockers(uuid) from public, anon, authenticated;
grant execute on function public.has_account_deletion_blockers(uuid) to service_role;
revoke execute on function public.attachment_paths_of_owned_workspaces(uuid) from public, anon, authenticated;
revoke execute on function public.delete_owned_workspaces(uuid) from public, anon, authenticated;
grant execute on function public.attachment_paths_of_owned_workspaces(uuid) to service_role;
grant execute on function public.delete_owned_workspaces(uuid) to service_role;
