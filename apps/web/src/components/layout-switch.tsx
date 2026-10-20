"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type Layout = "list" | "board";

/** List / Board toggle for a project. The choice lives in the URL (`?layout=board`) so it can be linked. */
export function LayoutSwitch({ layout }: { layout: Layout }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefFor = (next: Layout) => {
    const query = new URLSearchParams(params.toString());
    if (next === "list") query.delete("layout");
    else query.set("layout", next);
    const text = query.toString();
    return text ? `${pathname}?${text}` : pathname;
  };

  const item = (value: Layout, label: string) => (
    <Link
      href={hrefFor(value)}
      aria-current={layout === value ? "page" : undefined}
      className={`rounded-sm px-2 py-1 text-sm ${layout === value ? "bg-accent-subtle font-medium" : "text-accent-strong"}`}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label="Layout" className="flex items-center gap-1">
      {item("list", "List")}
      {item("board", "Board")}
    </nav>
  );
}
