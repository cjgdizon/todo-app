-- Puts reminders back in the queue when the push service could not be reached. `claim_due_reminders`
-- marks a reminder sent the moment it hands it out (so it is never sent twice), which meant a
-- minute of network trouble lost it for good. The sender calls this for the reminders of a batch
-- that failed in transit. A reminder already more than a day late stays dropped, so an outage
-- cannot bring old reminders back. Server only.
create function public.unclaim_reminders(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  restored integer;
begin
  update public.reminders
  set sent_at = null
  where id = any(p_ids)
    and sent_at is not null
    and deleted_at is null
    and remind_at >= now() - interval '1 day';
  get diagnostics restored = row_count;
  return restored;
end;
$$;

revoke execute on function public.unclaim_reminders(uuid[]) from public, anon, authenticated;
grant execute on function public.unclaim_reminders(uuid[]) to service_role;
