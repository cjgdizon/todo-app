"use client";

import { DataError, DELETE_ACCOUNT_CONFIRMATION, setActiveWorkspace, useData, useDeleteAccount, useDeletionBlockers } from "@todo/data";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useToast } from "./toast";

const card = "rounded-md border border-border bg-surface p-4";
const button = "rounded-md px-4 py-2 font-medium";

/** Permanently deleting the account, with what goes and what stays spelled out first. */
export function AccountDeletion() {
  const { client, userId } = useData();
  const router = useRouter();
  const blockers = useDeletionBlockers();
  const remove = useDeleteAccount();
  const { notify } = useToast();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const blocked = (blockers.data ?? []).length > 0;

  async function onDelete() {
    try {
      await remove.mutateAsync(typed);
      // The login is gone; signing out here lets the app clear what it saved on this device.
      await client.auth.signOut({ scope: "local" });
    } catch (error) {
      notify(error instanceof DataError ? error.message : "Couldn't delete your account. Check your connection and try again.", { tone: "error" });
    }
  }

  return (
    <section aria-labelledby="delete-heading" className={`${card} mt-6`}>
      <h2 id="delete-heading" className="text-base font-medium text-danger">
        Delete account
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        This permanently deletes your account, your private workspaces with their tasks and files, and your connection to
        Google Calendar. It cannot be undone. Work in workspaces shared with other people stays, without your name on it.
        Export your data first if you want a copy.
      </p>

      {blocked ? (
        <div className="mt-3">
          <p role="status" className="text-sm">
            You own workspaces that other people use. Hand each one to another member before deleting your account:
          </p>
          <ul className="mt-2 divide-y divide-border">
            {(blockers.data ?? []).map((workspace) => (
              <li key={workspace.workspaceId} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {workspace.name} ({workspace.memberCount} members)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveWorkspace(userId, workspace.workspaceId);
                    router.push("/members");
                  }}
                  className="shrink-0 rounded-sm px-2 py-1 text-accent-strong underline"
                >
                  Open its members
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
            Type &ldquo;{DELETE_ACCOUNT_CONFIRMATION}&rdquo; to confirm
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            className="block w-full max-w-xs rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base"
          />
          <button
            type="button"
            disabled={typed !== DELETE_ACCOUNT_CONFIRMATION || remove.isPending}
            onClick={() => void onDelete()}
            className={`${button} mt-3 bg-danger text-on-accent disabled:opacity-50`}
          >
            {remove.isPending ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      )}
    </section>
  );
}
