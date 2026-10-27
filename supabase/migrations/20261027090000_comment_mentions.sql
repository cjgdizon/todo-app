-- Mentions: a comment records which workspace members it names with @. The app works out who from
-- the text; the database does not trust that list, it drops anyone who is not a member of the
-- workspace (so nobody can be pinged, or their name probed, from outside) and keeps at most 20.
-- Each person mentioned (other than the author) gets a "mentioned" line in the activity feed.
alter table public.comments
  add column mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20);

create function private.keep_member_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.mentions := coalesce(
    array(
      select m.user_id
      from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = any (new.mentions)
      order by array_position(new.mentions, m.user_id)
      limit 20
    ),
    '{}'
  );
  return new;
end;
$$;

create trigger comments_keep_mentions before insert or update of mentions on public.comments
  for each row execute function private.keep_member_mentions();

-- Same trigger as before (see the activity migration), now also logging who was mentioned.
create or replace function private.log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_title text;
  mentioned uuid;
begin
  select t.title into task_title from public.tasks t where t.id = new.task_id and t.workspace_id = new.workspace_id;
  perform private.log_activity(new.workspace_id, new.task_id, 'comment_added', jsonb_build_object('title', task_title));
  for mentioned in select u from unnest(new.mentions) u where u is distinct from new.author_id loop
    perform private.log_activity(
      new.workspace_id, new.task_id, 'mentioned',
      jsonb_build_object('title', task_title, 'user_id', mentioned)
    );
  end loop;
  return null;
end;
$$;
