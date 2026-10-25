-- Invites: the only way into a workspace. An owner or admin creates a single-use link token; the
-- invitee, signed in, accepts it. The token is shown once and only its SHA-256 is stored, so a
-- database read never reveals a usable invite. Clients cannot write the table; they call the
-- three functions below, which check the caller's role themselves.
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  token_hash bytea not null unique,
  role public.workspace_role not null default 'member' check (role in ('admin', 'member')),
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index workspace_invites_workspace_idx on public.workspace_invites (workspace_id, created_at);
create index workspace_invites_created_by_idx on public.workspace_invites (created_by);
create index workspace_invites_accepted_by_idx on public.workspace_invites (accepted_by);

alter table public.workspace_invites enable row level security;

create policy workspace_invites_select_admins on public.workspace_invites
  for select to authenticated
  using (workspace_id in (select private.my_admin_workspace_ids()));

revoke insert, update, delete on public.workspace_invites from authenticated;

create function public.create_workspace_invite(ws uuid, invite_role public.workspace_role default 'member')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  token text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if invite_role not in ('admin', 'member') then
    raise exception 'invites can only be for admins or members' using errcode = '22023';
  end if;
  if ws not in (select private.my_admin_workspace_ids()) then
    raise exception 'not allowed to invite people to this workspace' using errcode = '42501';
  end if;
  if invite_role = 'admin' and not exists (
    select 1 from public.workspaces w where w.id = ws and w.owner_id = caller
  ) then
    raise exception 'only the owner can invite admins' using errcode = '42501';
  end if;
  if (
    select count(*) from public.workspace_invites i
    where i.workspace_id = ws and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) >= 20 then
    raise exception 'too many open invites; revoke some first' using errcode = '54000';
  end if;

  -- 256 random bits from the server's CSPRNG, as 64 hex characters.
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.workspace_invites (workspace_id, token_hash, role, created_by)
  values (ws, sha256(convert_to(token, 'utf8')), invite_role, caller);
  return token;
end;
$$;

create function public.accept_workspace_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  found_invite public.workspace_invites;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into found_invite
  from public.workspace_invites i
  where i.token_hash = sha256(convert_to(coalesce(invite_token, ''), 'utf8'))
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  for update;
  -- One message for unknown, used, expired and revoked: nothing to learn by guessing.
  if not found then
    raise exception 'invalid or expired invite' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.workspace_members m
    where m.workspace_id = found_invite.workspace_id and m.user_id = caller
  ) then
    raise exception 'you are already a member of this workspace' using errcode = '23505';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (found_invite.workspace_id, caller, found_invite.role);
  update public.workspace_invites set accepted_by = caller, accepted_at = now() where id = found_invite.id;
  return found_invite.workspace_id;
end;
$$;

create function public.revoke_workspace_invite(invite uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.workspace_invites
  set revoked_at = now()
  where id = invite
    and accepted_at is null
    and workspace_id in (select private.my_admin_workspace_ids());
$$;

revoke execute on function public.create_workspace_invite(uuid, public.workspace_role) from public, anon;
revoke execute on function public.accept_workspace_invite(text) from public, anon;
revoke execute on function public.revoke_workspace_invite(uuid) from public, anon;
grant execute on function public.create_workspace_invite(uuid, public.workspace_role) to authenticated;
grant execute on function public.accept_workspace_invite(text) to authenticated;
grant execute on function public.revoke_workspace_invite(uuid) to authenticated;
