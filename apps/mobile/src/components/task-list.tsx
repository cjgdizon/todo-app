import type { TaskNode } from "@todo/core";
import { selectView, useData, useLabels, useProjects, useTasks, type Task, type View as ViewKind } from "@todo/data";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { space, TOUCH, useTheme } from "@/lib/theme";
import { QuickAdd, type QuickAddDefaults } from "./quick-add";
import { SyncBanner } from "./sync-banner";
import { TaskRow } from "./task-row";

interface Item {
  task: Task;
  depth: number;
}

const NO_KEEP: ReadonlySet<string> = new Set();

/** Parents followed by their subtasks, each with how deep it sits. */
const flatten = (nodes: TaskNode<Task>[], depth = 0): Item[] =>
  nodes.flatMap((node) => [{ task: node.task, depth }, ...flatten(node.children, depth + 1)]);

/** A screen of tasks for one view (Inbox, Today, Upcoming, a project) with the add bar underneath. */
export function TaskList({ view, defaults, empty }: { view: ViewKind; defaults: QuickAddDefaults; empty: string }) {
  const theme = useTheme();
  const { timeZone } = useData();
  const tasks = useTasks();
  const projects = useProjects();
  const labels = useLabels();

  const sections = useMemo(() => {
    const result = selectView(
      tasks.data ?? [],
      view,
      { now: new Date(), timeZone },
      { projects: projects.data ?? [], labels: labels.data ?? [] },
      NO_KEEP,
    );
    return result.sections.map((section) => ({
      key: section.key,
      title: section.title,
      data: flatten(section.nodes),
    }));
  }, [tasks.data, projects.data, labels.data, view, timeZone]);

  const now = useMemo(() => new Date(), [tasks.data]);
  const isEmpty = sections.every((section) => section.data.length === 0);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SyncBanner />
      {tasks.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading tasks" />
        </View>
      ) : tasks.isError && !tasks.data ? (
        <View style={styles.center}>
          <Text accessibilityRole="alert" style={{ color: theme.danger }}>
            ⚠ Couldn&apos;t load your tasks.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void tasks.refetch()} style={styles.retry}>
            <Text style={{ color: theme["accent-strong"], fontWeight: "600" }}>Try again</Text>
          </Pressable>
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Text style={{ color: theme["text-muted"], textAlign: "center" }}>{empty}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.task.id}
          renderItem={({ item }) => <TaskRow task={item.task} depth={item.depth} ctx={{ now, timeZone }} />}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <Text accessibilityRole="header" style={[styles.header, { color: theme["text-muted"], backgroundColor: theme.bg }]}>
                {section.title}
              </Text>
            ) : null
          }
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: space.lg }}
        />
      )}
      <QuickAdd defaults={defaults} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  retry: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.md },
  header: { fontSize: 14, fontWeight: "600", paddingHorizontal: space.md, paddingVertical: space.sm },
});
