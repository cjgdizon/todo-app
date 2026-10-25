"use client";

import { useData, useMemberships } from "@todo/data";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { setActiveWorkspace } from "@/lib/active-workspace";

/** Lets people who belong to more than one workspace choose which one the app shows. */
export function WorkspaceSwitcher({ onSwitch }: { onSwitch: () => void }) {
  const router = useRouter();
  const { userId, workspaceId } = useData();
  const memberships = useMemberships().data ?? [];
  const selectId = useId();
  if (memberships.length < 2) return null;

  return (
    <div className="px-3">
      <label htmlFor={selectId} className="sr-only">
        Workspace
      </label>
      <select
        id={selectId}
        value={workspaceId}
        onChange={(event) => {
          setActiveWorkspace(userId, event.target.value);
          onSwitch();
          router.push("/inbox");
        }}
        className="w-full rounded-sm border border-border bg-surface px-2 py-1 text-base"
      >
        {memberships.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </div>
  );
}
