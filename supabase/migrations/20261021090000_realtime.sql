-- Realtime: clients subscribe to row changes of the synced tables the app shows.
-- Row-level security applies to what a subscriber receives, so a client only gets rows
-- of workspaces it belongs to. The publication exists on Supabase but not in the plain
-- Postgres the DB tests run on, so this does nothing there.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'tasks', 'projects', 'sections', 'labels', 'task_labels', 'saved_filters',
      'comments', 'workspace_members', 'reminders'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;
