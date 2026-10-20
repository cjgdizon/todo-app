-- Covers the (task_id, workspace_id) foreign key on task_labels. The primary key
-- (task_id, label_id) does not include workspace_id, so task deletes and project
-- moves (ON UPDATE CASCADE) could not use an index for the lookup. Found by the
-- Supabase performance advisor after the first hosted apply.
create index task_labels_task_fk_idx on public.task_labels (task_id, workspace_id);
