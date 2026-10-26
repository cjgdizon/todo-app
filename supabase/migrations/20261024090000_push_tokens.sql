-- Push tokens: one row per device that can receive notifications (Expo push tokens now,
-- web push later). A token belongs to a device, not a person, so signing in on a device
-- moves its token to that user. Clients never write the table: they call
-- register_push_token / unregister_push_token, which act only for the signed-in caller.
create table public.push_tokens (
  token text primary key check (char_length(token) between 10 and 300),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy push_tokens_select_own on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.push_tokens from authenticated;

create function public.register_push_token(p_token text, p_platform text)
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
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, caller, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  -- A person keeps their 10 newest devices. Without a cap one account could register thousands of
  -- tokens and make every notification fan out to all of them.
  delete from public.push_tokens
  where user_id = caller
    and token not in (
      select k.token from public.push_tokens k where k.user_id = caller order by k.updated_at desc, k.token limit 10
    );
end;
$$;

create function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = (select auth.uid());
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
