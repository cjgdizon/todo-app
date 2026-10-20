"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Which task's details are open, kept in the URL (`?task=<id>`) so the back button
 * closes the drawer and a task can be linked to.
 */
export function useTaskSelection() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("task");

  const open = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("task", id);
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("task");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  return { selectedId, open, close };
}
