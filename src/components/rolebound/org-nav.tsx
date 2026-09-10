"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function OrgNav({
  orgId,
  waitingCount,
}: {
  orgId: string;
  waitingCount: number;
}) {
  const pathname = usePathname();
  const base = `/orgs/${orgId}`;

  const items = [
    { href: base, label: "Roles" },
    { href: `${base}/approvals`, label: "Approvals", count: waitingCount },
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/members`, label: "People & agents" },
  ];

  return (
    <nav className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const active =
            item.href === base ? pathname === base : pathname.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {item.count ? (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
