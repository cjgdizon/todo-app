"use client";

import { useLabels, useProjects } from "@todo/data";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ProjectActions } from "./project-actions";
import { TaskView } from "./task-view";

function Missing({ what }: { what: string }) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8">
      <h1 className="text-[20px] leading-7 font-semibold">Not found</h1>
      <p className="mt-2 text-text-muted">
        That {what} doesn&apos;t exist or was deleted.{" "}
        <Link href="/inbox" className="text-accent-strong underline">
          Go to your inbox
        </Link>
      </p>
    </main>
  );
}

function Pending() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8" aria-busy="true">
      <div aria-hidden="true" className="h-7 w-40 rounded-md bg-surface-subtle" />
    </main>
  );
}

export function ProjectScreen({ id }: { id: string }) {
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === id);
  if (projects.isPending) return <Pending />;
  if (!project) return <Missing what="project" />;
  return (
    <TaskView
      view={{ kind: "project", id }}
      title={project.name}
      actions={<ProjectActions key={project.id} project={project} />}
    />
  );
}

export function LabelScreen({ id }: { id: string }) {
  const labels = useLabels();
  const label = labels.data?.find((l) => l.id === id);
  if (labels.isPending) return <Pending />;
  if (!label) return <Missing what="label" />;
  return <TaskView view={{ kind: "label", id }} title={`@${label.name}`} />;
}

export function SearchScreen() {
  const query = useSearchParams().get("q") ?? "";
  return <TaskView view={{ kind: "search", query }} title="Search" />;
}
