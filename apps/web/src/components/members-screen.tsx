"use client";

import {
  useCreateInvite,
  useData,
  useInvites,
  useMembers,
  useMemberships,
  useRemoveMember,
  useRevokeInvite,
  useSetMemberRole,
  useTransferWorkspace,
  type Member,
  type WorkspaceRole,
} from "@todo/data";
import { useId, useState } from "react";
import { setActiveWorkspace } from "@/lib/active-workspace";
import { inviteLink } from "@/lib/safe-next";
import { useToast } from "./toast";

type Assignable = Exclude<WorkspaceRole, "owner">;

const card = "rounded-md border border-border bg-surface p-4";
const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function MembersScreen() {
  const { userId, workspaceId } = useData();
  const members = useMembers();
  const workspaceName = useMemberships().data?.find((m) => m.id === workspaceId)?.name;
  const me = members.data?.find((member) => member.userId === userId);
  const isOwner = me?.role === "owner";
  const canManage = isOwner || me?.role === "admin";

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8">
      <h1 className="text-[20px] leading-7 font-semibold">Members</h1>
      {workspaceName ? <p className="mt-1 text-text-muted">{workspaceName}</p> : null}

      {members.isError ? (
        <p role="alert" className="mt-4 text-danger">
          <span aria-hidden="true">⚠ </span>
          Couldn&apos;t load the members.
        </p>
      ) : null}

      <section aria-labelledby="members-heading" className={`${card} mt-4`}>
        <h2 id="members-heading" className="sr-only">
          People in this workspace
        </h2>
        <ul className="divide-y divide-border">
          {(members.data ?? []).map((member) => (
            <MemberRow key={member.userId} member={member} isMe={member.userId === userId} isOwner={isOwner} canManage={canManage} />
          ))}
        </ul>
      </section>

      {canManage ? <InviteSection isOwner={isOwner} /> : null}
    </main>
  );
}

function MemberRow({
  member,
  isMe,
  isOwner,
  canManage,
}: {
  member: Member;
  isMe: boolean;
  isOwner: boolean;
  canManage: boolean;
}) {
  const { userId } = useData();
  const setRole = useSetMemberRole();
  const remove = useRemoveMember();
  const transfer = useTransferWorkspace();
  const { notify } = useToast();
  const roleId = useId();
  const canChangeRole = isOwner && member.role !== "owner" && !isMe;
  const canRemove = canManage && member.role !== "owner" && !isMe;
  const canLeave = isMe && member.role !== "owner";

  function onMakeOwner() {
    if (!window.confirm(`Make ${member.displayName} the owner of this workspace? You will become an admin.`)) return;
    transfer.mutate(member.userId, {
      onSuccess: () => notify(`${member.displayName} is now the owner.`),
      onError: () => notify("Couldn't hand over the workspace. Try again.", { tone: "error" }),
    });
  }

  function onRemove() {
    const prompt = isMe
      ? "Leave this workspace? You will lose access to its tasks."
      : `Remove ${member.displayName}? They will lose access to this workspace.`;
    if (!window.confirm(prompt)) return;
    remove.mutate(member.userId, {
      onSuccess: () => {
        if (isMe) setActiveWorkspace(userId, null);
      },
      onError: () => notify(isMe ? "Couldn't leave the workspace." : "Couldn't remove that member.", { tone: "error" }),
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="min-w-0 flex-1 truncate">
        {member.displayName}
        {isMe ? <span className="text-text-muted"> (you)</span> : null}
      </span>
      {canChangeRole ? (
        <>
          <label htmlFor={roleId} className="sr-only">
            Role of {member.displayName}
          </label>
          <select
            id={roleId}
            value={member.role}
            onChange={(event) =>
              setRole.mutate(
                { userId: member.userId, role: event.target.value as Assignable },
                { onError: () => notify("Couldn't change that role.", { tone: "error" }) },
              )
            }
            className="rounded-sm border border-border bg-surface px-2 py-1"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </>
      ) : (
        <span className="text-sm text-text-muted">{ROLE_LABEL[member.role]}</span>
      )}
      {canChangeRole ? (
        <button
          type="button"
          onClick={onMakeOwner}
          aria-label={`Make ${member.displayName} the owner`}
          className="rounded-sm px-2 py-1 text-sm text-accent-strong underline"
        >
          Make owner
        </button>
      ) : null}
      {canRemove || canLeave ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={isMe ? "Leave workspace" : `Remove ${member.displayName}`}
          className="rounded-sm px-2 py-1 text-sm text-danger underline"
        >
          {isMe ? "Leave" : "Remove"}
        </button>
      ) : null}
    </li>
  );
}

function InviteSection({ isOwner }: { isOwner: boolean }) {
  const invites = useInvites();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const { notify } = useToast();
  const roleId = useId();
  const linkId = useId();
  const [role, setRole] = useState<Assignable>("member");
  const [link, setLink] = useState<string | null>(null);

  async function onCreate() {
    setLink(null);
    try {
      setLink(inviteLink(window.location.origin, await create.mutateAsync(role)));
    } catch {
      notify("Couldn't create an invite link. Try again.", { tone: "error" });
    }
  }

  async function onCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify("Invite link copied.");
    } catch {
      notify("Couldn't copy automatically. Select the link and copy it.", { tone: "error" });
    }
  }

  return (
    <section aria-labelledby="invite-heading" className={`${card} mt-6`}>
      <h2 id="invite-heading" className="text-base font-medium">
        Invite people
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Anyone with a link can join once, within 7 days. Send it only to the person you mean to invite.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {isOwner ? (
          <div>
            <label htmlFor={roleId} className="mb-1 block text-sm font-medium">
              Role
            </label>
            <select
              id={roleId}
              value={role}
              onChange={(event) => setRole(event.target.value as Assignable)}
              className="rounded-sm border border-border bg-surface px-2 py-2"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        ) : null}
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => void onCreate()}
          className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent disabled:opacity-50"
        >
          Create invite link
        </button>
      </div>

      {link ? (
        <div className="mt-4">
          <label htmlFor={linkId} className="mb-1 block text-sm font-medium">
            Invite link (shown once)
          </label>
          <div className="flex gap-2">
            <input
              id={linkId}
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 py-2 text-sm"
            />
            <button type="button" onClick={() => void onCopy()} className="rounded-md px-3 py-2 text-accent-strong underline">
              Copy
            </button>
          </div>
        </div>
      ) : null}

      {(invites.data ?? []).length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Open invites</h3>
          <ul className="mt-2 divide-y divide-border">
            {(invites.data ?? []).map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">
                  {ROLE_LABEL[invite.role]}, expires {invite.expiresAt.toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    revoke.mutate(invite.id, {
                      onError: () => notify("Couldn't revoke that invite.", { tone: "error" }),
                    })
                  }
                  aria-label={`Revoke the ${ROLE_LABEL[invite.role].toLowerCase()} invite that expires ${invite.expiresAt.toLocaleDateString()}`}
                  className="rounded-sm px-2 py-1 text-danger underline"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
