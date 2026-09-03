"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  FileText,
  FolderOpen,
  LayoutDashboard,
  MessageSquare,
  Route,
  Send,
  Settings2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/deals", label: "Deal Board", icon: LayoutDashboard },
  { href: "/intake", label: "Requirement Intake", icon: Upload },
  { href: "/quotes", label: "Quotes", icon: Boxes },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/vault", label: "Document Vault", icon: FolderOpen },
  { href: "/routing", label: "Agent Routing", icon: Route },
  { href: "/copilot", label: "Ops Copilot", icon: MessageSquare },
  { href: "/docs", label: "Process map", icon: FileText },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-4">
          <Link href="/" className="block">
            <div className="text-xs font-medium uppercase tracking-wide text-teal-700">
              Vibrium Trade
            </div>
            <div className="text-sm font-semibold">Sourcing Suite</div>
          </Link>
          <p className="mt-1 text-[11px] text-zinc-500">
            Phase A · Buying agency
          </p>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm",
                  active
                    ? "bg-teal-50 font-medium text-teal-900"
                    : "text-zinc-600 hover:bg-zinc-50",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-zinc-100 p-3 text-[11px] text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Existing Vibrium APIs only
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
