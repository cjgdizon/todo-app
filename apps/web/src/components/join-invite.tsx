"use client";

import { DataError, useAcceptInvite, useData } from "@todo/data";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { setActiveWorkspace } from "@/lib/active-workspace";
import { isInviteToken } from "@/lib/safe-next";
import { useToast } from "./toast";

const INVALID = "This invite link is not valid or has expired. Ask the person who sent it for a new one.";

function messageFor(error: unknown): string {
  if (error instanceof DataError && /already a member/i.test(error.message)) {
    return "You are already a member of this workspace.";
  }
  return INVALID;
}

export function JoinInvite() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const { userId } = useData();
  const accept = useAcceptInvite();
  const { notify } = useToast();
  const [error, setError] = useState<string | null>(isInviteToken(token) ? null : INVALID);

  async function onJoin() {
    if (!isInviteToken(token)) return;
    setError(null);
    try {
      const workspaceId = await accept.mutateAsync(token);
      setActiveWorkspace(userId, workspaceId);
      notify("You joined the workspace.");
      router.replace("/inbox");
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 py-12">
      <h1 className="text-[20px] leading-7 font-semibold">Join a workspace</h1>
      <p className="mt-2 text-text-muted">
        You were invited to share tasks and projects. Joining lets you see everything in that workspace.
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-danger">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex items-center gap-4">
        {isInviteToken(token) ? (
          <button
            type="button"
            disabled={accept.isPending}
            onClick={() => void onJoin()}
            className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent disabled:opacity-50"
          >
            {accept.isPending ? "Joining…" : "Join workspace"}
          </button>
        ) : null}
        <Link href="/inbox" className="text-accent-strong underline">
          Go to my inbox
        </Link>
      </div>
    </main>
  );
}
