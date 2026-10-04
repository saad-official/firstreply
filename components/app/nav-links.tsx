"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck,
  CreditCard,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/queue", label: "Queue", icon: Inbox },
  { href: "/meetings", label: "Meetings", icon: CalendarCheck },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

/** The item that carries the awaiting-approval counter. */
const COUNTER_HREF = "/queue";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** `awaitingApprovalCount`: outbound drafts waiting for approval; 0 hides the badge. */
export function NavLinks({ awaitingApprovalCount }: { awaitingApprovalCount: number }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        const showCount = href === COUNTER_HREF && awaitingApprovalCount > 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-sidebar-foreground/75 transition-colors outline-none",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0 text-sidebar-foreground/55 transition-colors group-hover:text-sidebar-foreground",
                active && "text-sidebar-foreground",
              )}
              aria-hidden
            />
            <span className="truncate">{label}</span>
            {showCount ? (
              <span
                className="tabular ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-lemon px-1.5 font-mono text-xs font-semibold text-lemon-foreground"
                aria-label={`${awaitingApprovalCount} ${awaitingApprovalCount === 1 ? "message awaits" : "messages await"} approval`}
              >
                {awaitingApprovalCount > 99 ? "99+" : awaitingApprovalCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
