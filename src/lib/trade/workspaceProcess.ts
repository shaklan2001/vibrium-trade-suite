import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Building2,
  FileText,
  FolderOpen,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListTodo,
  Mail,
  MessageSquare,
  Plug,
  Radar,
  Route,
  Send,
  Ship,
  Upload,
  Workflow,
} from "lucide-react";

/** Workspace process / role. Extend this union when adding a third process. */
export type WorkspaceProcessId = "ops" | "finance";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shared across every process (Command Center). */
  shared?: boolean;
}

export interface WorkspaceProcess {
  id: WorkspaceProcessId;
  label: string;
  shortLabel: string;
  description: string;
  /** Landing path when switching into this process (not Command Center). */
  homeHref: string;
  nav: NavItem[];
}

const SHARED_NAV: NavItem[] = [
  { href: "/home", label: "Command Center", icon: Radar, shared: true },
];

const OPS_NAV: NavItem[] = [
  { href: "/operations", label: "Operations", icon: ListTodo },
  { href: "/shipments", label: "Shipment map", icon: Ship },
  { href: "/deals", label: "Deal Board", icon: LayoutDashboard },
  { href: "/intake", label: "Requirement Intake", icon: Upload },
  { href: "/quotes", label: "Quotes", icon: Boxes },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/pipeline", label: "Stage pipeline", icon: Workflow },
  { href: "/vault", label: "Document Vault", icon: FolderOpen },
  { href: "/routing", label: "Agent Routing", icon: Route },
  { href: "/copilot", label: "Ops Copilot", icon: MessageSquare },
  { href: "/docs", label: "Process map", icon: FileText },
];

const FINANCE_NAV: NavItem[] = [
  { href: "/finance", label: "Finance", icon: Landmark },
  { href: "/partners/commissions", label: "Agency commissions", icon: Landmark },
  { href: "/deals", label: "Deal Board", icon: LayoutDashboard },
  { href: "/vault", label: "Document Vault", icon: FolderOpen },
  { href: "/docs", label: "Process map", icon: FileText },
];

/**
 * Always-visible sidebar section below process nav (not Finance / Ops scoped).
 * Separated visually with a divider in the shell.
 */
export const GLOBAL_SIDEBAR_NAV: NavItem[] = [
  { href: "/partners", label: "Supplier Hub", icon: Building2 },
  { href: "/partners/commissions", label: "Agency commissions", icon: Landmark },
  { href: "/mailbox/inbox", label: "Inbox", icon: Inbox },
  { href: "/mailbox", label: "Mailbox book", icon: Mail },
  { href: "/mailbox/connections", label: "Email connections", icon: Plug },
];

/** Paths that belong to the global sidebar (never process-gated). */
export function isGlobalSidebarPath(pathname: string): boolean {
  return GLOBAL_SIDEBAR_NAV.some(
    (item) =>
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`) ||
      pathname === "/supplier-hub" ||
      pathname.startsWith("/supplier-hub/") ||
      pathname.startsWith("/partners/commissions"),
  );
}

/**
 * Ordered process registry. With 2 entries the shell renders a pill toggle;
 * with 3+ it can switch to a compact select without changing page code.
 */
export const WORKSPACE_PROCESSES: WorkspaceProcess[] = [
  {
    id: "finance",
    label: "Finance",
    shortLabel: "Finance",
    description: "Working capital and commission settlement",
    homeHref: "/finance",
    nav: [...SHARED_NAV, ...FINANCE_NAV],
  },
  {
    id: "ops",
    label: "Ops",
    shortLabel: "Ops",
    description: "Sourcing execution across the book",
    homeHref: "/operations",
    nav: [...SHARED_NAV, ...OPS_NAV],
  },
];

export const DEFAULT_WORKSPACE_PROCESS: WorkspaceProcessId = "finance";

export const WORKSPACE_PROCESS_STORAGE_KEY = "vibrium-workspace-process";

export function getWorkspaceProcess(
  id: WorkspaceProcessId,
): WorkspaceProcess {
  return (
    WORKSPACE_PROCESSES.find((p) => p.id === id) || WORKSPACE_PROCESSES[0]!
  );
}

export function isValidWorkspaceProcess(
  value: string | null | undefined,
): value is WorkspaceProcessId {
  return WORKSPACE_PROCESSES.some((p) => p.id === value);
}

/** True if the path belongs to this process's nav (exact or nested), or is global. */
export function pathAllowedInProcess(
  pathname: string,
  processId: WorkspaceProcessId,
): boolean {
  if (isGlobalSidebarPath(pathname)) return true;
  const process = getWorkspaceProcess(processId);
  return process.nav.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

/**
 * Infer process from URL when the path is exclusive to one process.
 * Shared paths (/home, /deals, /vault, /docs) and global sidebar leave the
 * current process alone.
 */
export function inferProcessFromPath(
  pathname: string,
): WorkspaceProcessId | null {
  if (isGlobalSidebarPath(pathname)) return null;

  const hrefOwners = new Map<string, WorkspaceProcessId[]>();
  for (const process of WORKSPACE_PROCESSES) {
    for (const item of process.nav) {
      if (item.shared) continue;
      const owners = hrefOwners.get(item.href) || [];
      if (!owners.includes(process.id)) owners.push(process.id);
      hrefOwners.set(item.href, owners);
    }
  }

  for (const [href, owners] of hrefOwners) {
    if (owners.length !== 1) continue;
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      return owners[0]!;
    }
  }
  return null;
}
