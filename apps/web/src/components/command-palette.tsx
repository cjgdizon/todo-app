"use client";

import { useData, useLabels, useProjects, useSavedFilters, useTasks } from "@todo/data";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { signOut } from "@/lib/offline";
import { useTaskSelection } from "@/lib/use-task-selection";
import { focusQuickAdd } from "./quick-add";
import { useTheme } from "./theme-toggle";

interface Item {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

const MAX_TASK_RESULTS = 8;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label="Command palette"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="fixed top-[12vh] left-1/2 m-0 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-surface p-0 text-text shadow-pop backdrop:bg-black/30"
    >
      {/* Mounted only while open so the query and selection start fresh each time. */}
      {open && <PaletteBody onClose={onClose} />}
    </dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { client } = useData();
  const projects = useProjects().data ?? [];
  const labels = useLabels().data ?? [];
  const savedFilters = useSavedFilters().data ?? [];
  const tasks = useTasks().data ?? [];
  const selection = useTaskSelection();
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const go = (path: string) => () => router.push(path);

  const commands: Item[] = [
    { id: "go-inbox", label: "Go to Inbox", hint: "Navigate", run: go("/inbox") },
    { id: "go-today", label: "Go to Today", hint: "Navigate", run: go("/today") },
    { id: "go-upcoming", label: "Go to Upcoming", hint: "Navigate", run: go("/upcoming") },
    { id: "go-calendar", label: "Go to Calendar", hint: "Navigate", run: go("/calendar") },
    { id: "go-search", label: "Search tasks", hint: "Navigate", run: go("/search") },
    { id: "go-settings", label: "Import or export tasks", hint: "Settings", run: go("/settings") },
    {
      id: "add",
      label: "Add a task",
      hint: "Action",
      run: () => {
        if (!focusQuickAdd()) {
          router.push("/inbox");
          window.setTimeout(focusQuickAdd, 300);
        }
      },
    },
    ...projects.map((p) => ({
      id: `project-${p.id}`,
      label: `Go to #${p.name}`,
      hint: "Project",
      run: go(`/project/${p.id}`),
    })),
    ...savedFilters.map((f) => ({
      id: `filter-${f.id}`,
      label: `Go to filter ${f.name}`,
      hint: "Filter",
      run: go(`/filter/${f.id}`),
    })),
    ...labels.map((l) => ({
      id: `label-${l.id}`,
      label: `Go to @${l.name}`,
      hint: "Label",
      run: go(`/label/${l.id}`),
    })),
    { id: "theme", label: `Switch theme (now ${theme.label})`, hint: "Action", run: theme.cycle },
    { id: "sign-out", label: "Sign out", hint: "Action", run: () => void signOut(client) },
  ];

  const needle = query.trim().toLowerCase();
  const items: Item[] = needle
    ? [
        ...commands.filter((item) => item.label.toLowerCase().includes(needle)),
        ...tasks
          .filter((t) => t.completedAt === null && t.title.toLowerCase().includes(needle))
          .slice(0, MAX_TASK_RESULTS)
          .map((t) => ({ id: `task-${t.id}`, label: t.title, hint: "Task", run: () => selection.open(t.id) })),
        {
          id: "search-for",
          label: `Search tasks for "${query.trim()}"`,
          hint: "Search",
          run: go(`/search?q=${encodeURIComponent(query.trim())}`),
        },
      ]
    : commands;

  const current = Math.min(active, items.length - 1);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[current]);
    }
  };

  return (
    <div>
      <label htmlFor="palette-input" className="sr-only">
        Type a command or search tasks
      </label>
      <input
        id="palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={items[current] ? `palette-option-${current}` : undefined}
        autoComplete="off"
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Type a command or search tasks"
        className="w-full rounded-t-lg border-b border-border bg-transparent px-4 py-3 text-base placeholder:text-text-muted"
      />
      <ul id="palette-list" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
        {items.map((item, index) => (
          <li
            key={item.id}
            id={`palette-option-${index}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(item)}
            className={`flex cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 ${
              index === current ? "bg-accent-subtle" : ""
            }`}
          >
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 text-sm text-text-muted">{item.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
