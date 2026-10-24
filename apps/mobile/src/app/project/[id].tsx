import { useProjects } from "@todo/data";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { TaskList } from "@/components/task-list";

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === id);
  const view = useMemo(() => ({ kind: "project", id }) as const, [id]);
  const defaults = useMemo(() => ({ projectId: id, dueToday: false }), [id]);

  return (
    <>
      <Stack.Screen options={{ title: project?.name ?? "Project" }} />
      <TaskList view={view} defaults={defaults} empty="No tasks in this project yet. Add one below." />
    </>
  );
}
