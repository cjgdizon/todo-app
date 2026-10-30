-- Workspaces are never deleted through the API. No screen used this policy, and it let an owner
-- (or anyone holding their session) delete a shared workspace with one request, taking other
-- people's tasks with it and with no way back. Deleting an account removes the person's own
-- unshared workspaces through `delete_owned_workspaces`, which runs with the service role.
drop policy workspaces_delete on public.workspaces;
