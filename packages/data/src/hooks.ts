import {
  descendantIds,
  planBulkCompletion,
  planBulkMove,
  planCompletion,
  positionBetween,
  withDescendants,
} from "@todo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { TodoClient } from "./client.ts";
import type { Label, Project, SavedFilter, Task } from "./models.ts";
import {
  fetchBootstrap,
  fetchLabels,
  fetchProjects,
  fetchSavedFilters,
  fetchTasks,
  insertLabel,
  insertProject,
  insertSavedFilter,
  insertTask,
  setTaskLabels,
  trashProject,
  updateProject,
  updateSavedFilter,
  updateTask,
} from "./queries.ts";
import { applyTaskChange, type TaskChange } from "./taskPatch.ts";
import { positionAtEnd, type TaskInput } from "./taskInput.ts";

/**
 * TanStack Query hooks shared by web and mobile. Every write updates the cache
 * first (no spinners), rolls back if the server refuses, and refetches when done.
 */

export interface DataContextValue {
  client: TodoClient;
  userId: string;
  workspaceId: string;
  /** The user's IANA time zone, used for due dates and recurrence. */
  timeZone: string;
}

export const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used inside a DataContext.Provider");
  return value;
}

export const queryKeys = {
  bootstrap: (userId: string) => ["bootstrap", userId] as const,
  projects: (workspaceId: string) => ["projects", workspaceId] as const,
  labels: (workspaceId: string) => ["labels", workspaceId] as const,
  tasks: (workspaceId: string) => ["tasks", workspaceId] as const,
  savedFilters: (workspaceId: string) => ["savedFilters", workspaceId] as const,
};

/** Profile and workspace for the signed-in user; load this before rendering the app shell. */
export function useBootstrap(client: TodoClient, userId: string) {
  return useQuery({
    queryKey: queryKeys.bootstrap(userId),
    queryFn: () => fetchBootstrap(client, userId),
    staleTime: Infinity,
  });
}

export function useProjects() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.projects(workspaceId),
    queryFn: () => fetchProjects(client, workspaceId),
  });
}

export function useLabels() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.labels(workspaceId),
    queryFn: () => fetchLabels(client, workspaceId),
  });
}

export function useTasks() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.tasks(workspaceId),
    queryFn: () => fetchTasks(client, workspaceId),
  });
}

export interface UpdateTaskVariables {
  id: string;
  change: TaskChange;
  alsoIds?: readonly string[];
}

export function useUpdateTask() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.tasks(workspaceId);

  return useMutation({
    // `alsoIds` get the same change in the same statement (a task and its subtasks).
    mutationFn: async ({ id, change, alsoIds = [] }: UpdateTaskVariables) => {
      const { labelIds, ...fields } = change;
      await updateTask(client, [id, ...alsoIds], fields);
      if (labelIds) await setTaskLabels(client, workspaceId, id, labelIds);
    },
    onMutate: async ({ id, change, alsoIds = [] }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      const targets = new Set([id, ...alsoIds]);
      queryClient.setQueryData<Task[]>(key, (tasks) =>
        tasks?.flatMap((task) => {
          if (!targets.has(task.id)) return [task];
          const next = applyTaskChange(task, change);
          return next ? [next] : [];
        }),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export type CreateTaskInput = TaskInput & {
  /** Makes the new task a subtask; it is placed in the parent's project. */
  parentId?: string | null;
  notes?: string | null;
};

export function useCreateTask() {
  const { client, workspaceId, userId } = useData();
  const queryClient = useQueryClient();
  const tasksKey = queryKeys.tasks(workspaceId);
  const labelsKey = queryKeys.labels(workspaceId);

  const mutation = useMutation({
    mutationFn: async (variables: { task: Task; newLabels: Label[]; input: CreateTaskInput }) => {
      for (const label of variables.newLabels) {
        await insertLabel(client, { id: label.id, workspaceId, name: label.name });
      }
      const { task, input } = variables;
      await insertTask(client, {
        id: task.id,
        workspaceId,
        createdBy: userId,
        title: task.title,
        notes: input.notes ?? null,
        priority: task.priority,
        projectId: task.projectId,
        parentId: task.parentId,
        dueAt: task.dueAt,
        dueAllDay: task.dueAllDay,
        dueTz: task.dueTz,
        rrule: task.rrule,
        recurAfterCompletion: task.recurAfterCompletion,
        position: task.position,
      });
      if (task.labelIds.length > 0) await setTaskLabels(client, workspaceId, task.id, task.labelIds);
    },
    onMutate: async ({ task, newLabels }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: tasksKey }),
        queryClient.cancelQueries({ queryKey: labelsKey }),
      ]);
      const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);
      const previousLabels = queryClient.getQueryData<Label[]>(labelsKey);
      queryClient.setQueryData<Task[]>(tasksKey, (tasks) => (tasks ? [...tasks, task] : [task]));
      if (newLabels.length > 0) {
        queryClient.setQueryData<Label[]>(labelsKey, (labels) => [...(labels ?? []), ...newLabels]);
      }
      return { previousTasks, previousLabels };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousTasks) queryClient.setQueryData(tasksKey, context.previousTasks);
      if (context?.previousLabels) queryClient.setQueryData(labelsKey, context.previousLabels);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: tasksKey }),
        queryClient.invalidateQueries({ queryKey: labelsKey }),
      ]),
  });

  /** Creates the task (and any new labels) and resolves with it once saved. */
  const create = async (input: CreateTaskInput): Promise<Task> => {
    const tasks = queryClient.getQueryData<Task[]>(tasksKey) ?? [];
    const parent = input.parentId ? tasks.find((t) => t.id === input.parentId) : undefined;
    if (input.parentId && !parent) throw new Error("The parent task no longer exists");
    const projectId = parent ? parent.projectId : input.projectId;
    const parentId = parent?.id ?? null;
    const newLabels: Label[] = input.newLabelNames.map((name) => ({
      id: crypto.randomUUID(),
      workspaceId,
      name,
      color: null,
    }));
    const task: Task = {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      sectionId: null,
      parentId,
      title: input.title,
      notes: input.notes ?? null,
      priority: input.priority,
      dueAt: input.dueAt,
      dueAllDay: input.dueAllDay,
      dueTz: input.dueTz,
      rrule: input.rrule,
      recurAfterCompletion: input.recurAfterCompletion,
      position: positionAtEnd(tasks, { projectId, parentId }),
      completedAt: null,
      labelIds: [...input.labelIds, ...newLabels.map((l) => l.id)],
      version: 1,
    };
    await mutation.mutateAsync({ task, newLabels, input });
    return task;
  };

  return { create, isPending: mutation.isPending };
}

export interface CompletionResult {
  kind: "complete" | "advance";
  /** Puts the task back exactly as it was. */
  undo: () => Promise<void>;
}

/** Completes a task, or moves a recurring one to its next date. The result carries an undo. */
export function useCompleteTask() {
  const { timeZone } = useData();
  const { mutateAsync } = useUpdateTask();

  return async (task: Task): Promise<CompletionResult> => {
    const plan = planCompletion(task, new Date(), timeZone);
    if (plan.kind === "advance") {
      await mutateAsync({ id: task.id, change: { dueAt: plan.nextDueAt } });
      return {
        kind: "advance",
        undo: () => mutateAsync({ id: task.id, change: { dueAt: task.dueAt } }),
      };
    }
    await mutateAsync({ id: task.id, change: { completedAt: new Date() } });
    return {
      kind: "complete",
      undo: () => mutateAsync({ id: task.id, change: { completedAt: null } }),
    };
  };
}

/**
 * Moves a task and all of its subtasks to the trash in one statement. `count` is
 * how many tasks went; the result's undo restores them all.
 */
export function useTrashTask() {
  const { workspaceId } = useData();
  const queryClient = useQueryClient();
  const { mutateAsync } = useUpdateTask();

  return async (task: Task): Promise<{ count: number; undo: () => Promise<void> }> => {
    const tasks = queryClient.getQueryData<Task[]>(queryKeys.tasks(workspaceId)) ?? [];
    const alsoIds = descendantIds(tasks, task.id);
    await mutateAsync({ id: task.id, change: { deletedAt: new Date() }, alsoIds });
    return {
      count: alsoIds.length + 1,
      undo: () => mutateAsync({ id: task.id, change: { deletedAt: null }, alsoIds }),
    };
  };
}

export interface BulkResult {
  /** How many tasks the action changed. */
  count: number;
  /** Selected tasks the action had to leave alone (subtasks that cannot change project alone). */
  skipped: number;
  /** Puts every changed task back exactly as it was. */
  undo: () => Promise<void>;
}

/** Actions on a set of selected tasks. Each saves in as few statements as it can and is undoable. */
export function useBulkActions() {
  const { workspaceId, timeZone } = useData();
  const queryClient = useQueryClient();
  const { mutateAsync } = useUpdateTask();

  const allTasks = () => queryClient.getQueryData<Task[]>(queryKeys.tasks(workspaceId)) ?? [];
  const pick = (ids: readonly string[]) => {
    const wanted = new Set(ids);
    return allTasks().filter((task) => wanted.has(task.id));
  };
  /** One statement for the whole set; nothing to do for an empty set. */
  const apply = async (ids: readonly string[], change: TaskChange) => {
    const [id, ...alsoIds] = ids;
    if (id !== undefined) await mutateAsync({ id, change, alsoIds });
  };
  /** Groups ids by a value, so undo can restore each group to its own previous value. */
  const groupBy = <K>(tasks: readonly Task[], key: (task: Task) => K) => {
    const groups = new Map<K, string[]>();
    for (const task of tasks) groups.set(key(task), [...(groups.get(key(task)) ?? []), task.id]);
    return groups;
  };

  return {
    /** Completes plain tasks and moves recurring ones to their next date. */
    async complete(ids: readonly string[]): Promise<BulkResult> {
      const selected = pick(ids).filter((task) => task.completedAt === null);
      const plan = planBulkCompletion(selected, new Date(), timeZone);
      const previousDue = new Map(selected.map((task) => [task.id, task.dueAt]));
      await apply(plan.completeIds, { completedAt: new Date() });
      for (const step of plan.advances) await mutateAsync({ id: step.id, change: { dueAt: step.nextDueAt } });
      return {
        count: selected.length,
        skipped: 0,
        undo: async () => {
          await apply(plan.completeIds, { completedAt: null });
          for (const step of plan.advances) {
            await mutateAsync({ id: step.id, change: { dueAt: previousDue.get(step.id) ?? null } });
          }
        },
      };
    },

    async setPriority(ids: readonly string[], priority: Task["priority"]): Promise<BulkResult> {
      const selected = pick(ids);
      const before = groupBy(selected, (task) => task.priority);
      await apply(selected.map((task) => task.id), { priority });
      return {
        count: selected.length,
        skipped: 0,
        undo: async () => {
          for (const [previous, group] of before) await apply(group, { priority: previous });
        },
      };
    },

    /** Moves top-level tasks and their subtasks; selected subtasks without their parent are skipped. */
    async move(ids: readonly string[], projectId: string | null): Promise<BulkResult> {
      const plan = planBulkMove(allTasks(), ids);
      const before = groupBy(pick(plan.ids), (task) => task.projectId);
      await apply(plan.ids, { projectId });
      return {
        count: plan.ids.length,
        skipped: plan.skipped.length,
        undo: async () => {
          for (const [previous, group] of before) await apply(group, { projectId: previous });
        },
      };
    },

    /** Trashes the tasks and all their subtasks. */
    async trash(ids: readonly string[]): Promise<BulkResult> {
      const all = withDescendants(allTasks(), ids);
      await apply(all, { deletedAt: new Date() });
      return {
        count: all.length,
        skipped: 0,
        undo: () => apply(all, { deletedAt: null }),
      };
    },
  };
}

export function useSavedFilters() {
  const { client, workspaceId } = useData();
  return useQuery({
    queryKey: queryKeys.savedFilters(workspaceId),
    queryFn: () => fetchSavedFilters(client, workspaceId),
  });
}

/** Saves a search under a name. Resolves with the saved filter once the server has it. */
export function useCreateSavedFilter() {
  const { client, workspaceId, userId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.savedFilters(workspaceId);

  const mutation = useMutation({
    mutationFn: (filter: SavedFilter) =>
      insertSavedFilter(client, { id: filter.id, workspaceId, ownerId: userId, name: filter.name, query: filter.query }),
    onMutate: async (filter) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SavedFilter[]>(key);
      queryClient.setQueryData<SavedFilter[]>(key, (filters) => [...(filters ?? []), filter]);
      return { previous };
    },
    onError: (_error, _filter, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return async (name: string, query: string): Promise<SavedFilter> => {
    const filter: SavedFilter = { id: crypto.randomUUID(), workspaceId, name: name.trim(), query: query.trim() };
    await mutation.mutateAsync(filter);
    return filter;
  };
}

/** Deletes (soft) a saved filter. The result's undo brings it back. */
export function useDeleteSavedFilter() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.savedFilters(workspaceId);

  const mutation = useMutation({
    mutationFn: ({ id, deletedAt }: { id: string; deletedAt: Date | null }) =>
      updateSavedFilter(client, id, { deletedAt }),
    onMutate: async ({ id, deletedAt }) => {
      if (deletedAt === null) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SavedFilter[]>(key);
      queryClient.setQueryData<SavedFilter[]>(key, (filters) => filters?.filter((f) => f.id !== id));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return async (filter: SavedFilter): Promise<{ undo: () => Promise<void> }> => {
    await mutation.mutateAsync({ id: filter.id, deletedAt: new Date() });
    return { undo: () => mutation.mutateAsync({ id: filter.id, deletedAt: null }) };
  };
}

export function useCreateProject() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.projects(workspaceId);

  return useMutation({
    mutationFn: async (project: Project) => {
      await insertProject(client, {
        id: project.id,
        workspaceId,
        name: project.name,
        color: project.color,
        position: project.position,
      });
    },
    onMutate: async (project) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Project[]>(key);
      queryClient.setQueryData<Project[]>(key, (projects) => [...(projects ?? []), project]);
      return { previous };
    },
    onError: (_error, _project, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Builds the next project for `useCreateProject`: id and an end-of-list position. */
export function useNewProject() {
  const { workspaceId } = useData();
  const queryClient = useQueryClient();
  return (name: string, color: string | null = null): Project => {
    const projects = queryClient.getQueryData<Project[]>(queryKeys.projects(workspaceId)) ?? [];
    const last = projects.reduce<string | null>(
      (max, p) => (max === null || p.position > max ? p.position : max),
      null,
    );
    return {
      id: crypto.randomUUID(),
      workspaceId,
      name,
      color,
      position: positionBetween(last, null),
      archived: false,
    };
  };
}

export function useRenameProject() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const key = queryKeys.projects(workspaceId);

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateProject(client, id, { name }),
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Project[]>(key);
      queryClient.setQueryData<Project[]>(key, (projects) =>
        projects?.map((p) => (p.id === id ? { ...p, name } : p)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteProject() {
  const { client, workspaceId } = useData();
  const queryClient = useQueryClient();
  const projectsKey = queryKeys.projects(workspaceId);
  const tasksKey = queryKeys.tasks(workspaceId);

  return useMutation({
    mutationFn: (id: string) => trashProject(client, workspaceId, id),
    onMutate: async (id) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: projectsKey }),
        queryClient.cancelQueries({ queryKey: tasksKey }),
      ]);
      const previousProjects = queryClient.getQueryData<Project[]>(projectsKey);
      const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);
      queryClient.setQueryData<Project[]>(projectsKey, (projects) => projects?.filter((p) => p.id !== id));
      queryClient.setQueryData<Task[]>(tasksKey, (tasks) => tasks?.filter((t) => t.projectId !== id));
      return { previousProjects, previousTasks };
    },
    onError: (_error, _id, context) => {
      if (context?.previousProjects) queryClient.setQueryData(projectsKey, context.previousProjects);
      if (context?.previousTasks) queryClient.setQueryData(tasksKey, context.previousTasks);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: tasksKey }),
      ]),
  });
}
