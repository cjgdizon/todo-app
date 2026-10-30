-- Takes a person's waiting calendar tasks off the queue in one statement. The Edge Function used to
-- read the rows and then delete them in two steps, so two overlapping runs could both read the same
-- rows and send the same task to Google twice. `skip locked` makes a second run pass over rows the
-- first one already holds. Server only.
create function public.claim_calendar_sync_queue(p_user uuid, batch integer default 100)
returns table (task_id uuid)
language sql
security definer
set search_path = ''
as $$
  delete from public.calendar_sync_queue q
  where q.id in (
    select s.id
    from public.calendar_sync_queue s
    where s.user_id = p_user
    order by s.id
    limit greatest(batch, 1)
    for update skip locked
  )
  returning q.task_id;
$$;

revoke execute on function public.claim_calendar_sync_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_calendar_sync_queue(uuid, integer) to service_role;
