import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Reloads a page's lists each time the page is opened. Next keeps pages you visited before mounted
 * but hidden, so opening one again does not remount it, and a list that missed a live update would
 * otherwise stay out of date until something else refreshed it.
 */
export function useRefreshOnOpen(path: string, queryKeys: readonly QueryKey[]): void {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const signature = JSON.stringify(queryKeys);
  useEffect(() => {
    if (pathname !== path) return;
    for (const queryKey of JSON.parse(signature) as QueryKey[]) void queryClient.invalidateQueries({ queryKey });
  }, [pathname, path, signature, queryClient]);
}
