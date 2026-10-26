"use client";

import { dueBucket } from "@todo/core";
import {
  useCreateProject,
  useData,
  useLabels,
  useNewProject,
  useProjects,
  useSavedFilters,
  useTasks,
} from "@todo/data";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CommandPalette } from "./command-palette";
import {
  CalendarIcon,
  FilterIcon,
  HashIcon,
  InboxIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  TodayIcon,
  UpcomingIcon,
} from "./icons";
import { signOut } from "@/lib/offline";
import { focusQuickAdd } from "./quick-add";
import { RunningTimer } from "./running-timer";
import { SyncStatus } from "./sync-status";
import { TaskDetail } from "./task-detail";
import { ThemeToggle } from "./theme-toggle";
import { useToast } from "./toast";
import { WorkspaceSwitcher } from "./workspace-switcher";

function NavLink({
  href,
  icon,
  children,
  count,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  count?: number;
}) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-md px-3 py-2 ${active ? "bg-accent-subtle font-medium" : "hover:bg-surface"}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count ? <span className="text-sm text-text-muted tabular-nums">{count}</span> : null}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { client, timeZone } = useData();
  const tasks = useTasks().data ?? [];
  const projects = useProjects().data ?? [];
  const labels = useLabels().data ?? [];
  const savedFilters = useSavedFilters().data ?? [];
  const createProject = useCreateProject();
  const newProject = useNewProject();
  const { notify } = useToast();

  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [projectName, setProjectName] = useState("");

  const ctx = { now: new Date(), timeZone };
  const open = tasks.filter((t) => t.completedAt === null);
  const counts = {
    inbox: open.filter((t) => t.projectId === null && t.parentId === null).length,
    today: open.filter((t) => ["overdue", "today"].includes(dueBucket(t, ctx))).length,
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((isOpen) => !isOpen);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Single-key shortcuts must never fire while typing or inside a modal.
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], dialog[open]")) return;

      if (event.key === "q") {
        event.preventDefault();
        if (!focusQuickAdd()) {
          router.push("/inbox");
          window.setTimeout(focusQuickAdd, 300);
        }
      } else if (event.key === "/") {
        event.preventDefault();
        router.push("/search");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  async function onAddProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    const project = newProject(name);
    setProjectName("");
    setAddingProject(false);
    try {
      await createProject.mutateAsync(project);
      router.push(`/project/${project.id}`);
    } catch {
      notify("Couldn't create that project. Try again.", { tone: "error" });
    }
  }

  return (
    <div className="flex min-h-screen flex-1">
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" aria-hidden="true" onClick={() => setMenuOpen(false)} />
      )}

      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col gap-4 overflow-y-auto bg-surface-subtle p-3 transition-transform lg:static lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-3 pt-2 text-[20px] leading-7 font-semibold">Todo</div>
        <WorkspaceSwitcher onSwitch={() => setMenuOpen(false)} />

        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            setPaletteOpen(true);
          }}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-text-muted hover:bg-surface"
        >
          <SearchIcon />
          <span className="flex-1">Search and commands</span>
          <kbd className="text-xs">Ctrl K</kbd>
        </button>

        <nav aria-label="Views" onClick={() => setMenuOpen(false)} className="flex flex-col gap-1">
          <NavLink href="/inbox" icon={<InboxIcon />} count={counts.inbox}>
            Inbox
          </NavLink>
          <NavLink href="/today" icon={<TodayIcon />} count={counts.today}>
            Today
          </NavLink>
          <NavLink href="/upcoming" icon={<UpcomingIcon />}>
            Upcoming
          </NavLink>
          <NavLink href="/calendar" icon={<CalendarIcon />}>
            Calendar
          </NavLink>
          <NavLink href="/search" icon={<SearchIcon />}>
            Search
          </NavLink>
        </nav>

        <nav aria-label="Projects" onClick={() => setMenuOpen(false)} className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-3">
            <h2 className="text-sm font-medium text-text-muted">Projects</h2>
            <button
              type="button"
              aria-label="Add project"
              aria-expanded={addingProject}
              onClick={(event) => {
                event.stopPropagation();
                setAddingProject((adding) => !adding);
              }}
              className="flex size-6 items-center justify-center rounded-sm text-text-muted"
            >
              <PlusIcon width={16} height={16} />
            </button>
          </div>
          {addingProject && (
            <form onSubmit={onAddProject} onClick={(event) => event.stopPropagation()} className="px-3 py-1">
              <label htmlFor="new-project-name" className="sr-only">
                Project name
              </label>
              <input
                id="new-project-name"
                autoFocus
                value={projectName}
                maxLength={100}
                onChange={(event) => setProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setAddingProject(false);
                }}
                placeholder="Project name"
                className="w-full rounded-sm border border-border bg-surface px-2 py-1 text-base"
              />
            </form>
          )}
          {projects.map((project) => (
            <NavLink key={project.id} href={`/project/${project.id}`} icon={<HashIcon />}>
              {project.name}
            </NavLink>
          ))}
        </nav>

        {savedFilters.length > 0 && (
          <nav aria-label="Filters" onClick={() => setMenuOpen(false)} className="flex flex-col gap-1">
            <h2 className="px-3 text-sm font-medium text-text-muted">Filters</h2>
            {savedFilters.map((filter) => (
              <NavLink key={filter.id} href={`/filter/${filter.id}`} icon={<FilterIcon />}>
                {filter.name}
              </NavLink>
            ))}
          </nav>
        )}

        {labels.length > 0 && (
          <nav aria-label="Labels" onClick={() => setMenuOpen(false)} className="flex flex-col gap-1">
            <h2 className="px-3 text-sm font-medium text-text-muted">Labels</h2>
            {labels.map((label) => (
              <NavLink key={label.id} href={`/label/${label.id}`} icon={<TagIcon />}>
                {label.name}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
          <Link
            href="/members"
            aria-current={pathname === "/members" ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className="rounded-sm px-2 py-1 text-left text-sm text-text-muted"
          >
            Members and invites
          </Link>
          <Link
            href="/stats"
            aria-current={pathname === "/stats" ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className="rounded-sm px-2 py-1 text-left text-sm text-text-muted"
          >
            Stats
          </Link>
          <Link
            href="/activity"
            aria-current={pathname === "/activity" ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className="rounded-sm px-2 py-1 text-left text-sm text-text-muted"
          >
            Activity
          </Link>
          <Link
            href="/settings"
            aria-current={pathname === "/settings" ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className="rounded-sm px-2 py-1 text-left text-sm text-text-muted"
          >
            Settings (import and export)
          </Link>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void signOut(client)}
            className="rounded-sm px-2 py-1 text-left text-sm text-text-muted"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2 lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="flex size-9 items-center justify-center rounded-sm"
          >
            <MenuIcon />
          </button>
          <span className="font-semibold">Todo</span>
        </header>
        <SyncStatus />
        <RunningTimer />
        {children}
      </div>

      <TaskDetail />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
