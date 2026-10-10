"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  GLOBAL_SIDEBAR_NAV,
  WORKSPACE_PROCESSES,
  type WorkspaceProcessId,
} from "@/lib/trade/workspaceProcess";
import {
  useWorkspaceProcess,
  WorkspaceProcessProvider,
} from "@/components/layout/workspace-process";
import { MailboxHydrator } from "@/components/layout/mailbox-hydrator";
import { useTradeStore } from "@/lib/trade/store";
import {
  COMMERCIAL_MODEL_OPTIONS,
  type CommercialModelFilter,
} from "@/lib/trade/commercialModel";
import {
  DISPLAY_CURRENCY_OPTIONS,
  type DisplayCurrency,
} from "@/lib/trade/currencyDisplay";

function CommercialModelToggle() {
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const setFilter = useTradeStore((s) => s.setCommercialModelFilter);

  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Book
      </span>
      <select
        className="bg-transparent text-sm font-medium text-zinc-900 outline-none"
        value={filter}
        onChange={(e) =>
          setFilter(e.target.value as CommercialModelFilter)
        }
        aria-label="Agency vs trader book filter"
      >
        {COMMERCIAL_MODEL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.shortLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function CurrencyToggle() {
  const currency = useTradeStore((s) => s.displayCurrency);
  const setCurrency = useTradeStore((s) => s.setDisplayCurrency);

  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Currency
      </span>
      <select
        className="bg-transparent text-sm font-medium text-zinc-900 outline-none"
        value={currency}
        onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
        aria-label="Display currency"
      >
        {DISPLAY_CURRENCY_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.shortLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProcessToggle() {
  const { processId, setProcessId, hydrated } = useWorkspaceProcess();
  const processes = WORKSPACE_PROCESSES;

  // Two processes → pill toggle. Three+ → compact select (ready for expansion).
  if (processes.length > 2) {
    return (
      <label className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Process
        </span>
        <select
          className="bg-transparent text-sm font-medium text-zinc-900 outline-none"
          value={processId}
          disabled={!hydrated}
          onChange={(e) =>
            setProcessId(e.target.value as WorkspaceProcessId)
          }
          aria-label="Workspace process"
        >
          {processes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Workspace process"
      className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5"
    >
      {processes.map((p) => {
        const active = hydrated && processId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={!hydrated}
            onClick={() => setProcessId(p.id)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
              active
                ? "bg-teal-700 text-white shadow-sm"
                : "text-zinc-600 hover:text-zinc-900",
            )}
          >
            {p.shortLabel}
          </button>
        );
      })}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm",
        active
          ? "bg-teal-50 font-medium text-teal-900"
          : "text-zinc-600 hover:bg-zinc-50",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { process, processId } = useWorkspaceProcess();

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-4">
          <Link href="/home" className="block">
            <div className="text-xs font-medium uppercase tracking-wide text-teal-700">
              Vibrium Trade
            </div>
            <div className="text-sm font-semibold">Savvy Net Sourcing</div>
          </Link>
          <p className="mt-1 text-[11px] text-zinc-500">
            {process.description}
          </p>
        </div>
        <nav
          className="flex flex-1 flex-col overflow-y-auto p-2"
          aria-label={`${process.label} navigation`}
        >
          <div className="space-y-0.5">
            {process.nav.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              return (
                <NavLink
                  key={`${processId}-${item.href}`}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={active}
                />
              );
            })}
          </div>

          <div className="mt-2 space-y-0.5 border-t border-zinc-200 pt-2">
            {GLOBAL_SIDEBAR_NAV.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`) ||
                pathname === "/supplier-hub" ||
                pathname.startsWith("/supplier-hub/");
              return (
                <NavLink
                  key={`global-${item.href}`}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={active}
                />
              );
            })}
          </div>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <ProcessToggle />
            <CommercialModelToggle />
            <CurrencyToggle />
            <span className="hidden truncate text-xs text-zinc-500 sm:inline">
              {process.label} process
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MailboxHydrator />
            <div className="hidden items-center gap-2 rounded-full border border-zinc-200 px-2.5 py-1 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-[11px] font-semibold text-teal-800">
                SN
              </div>
              <div className="pr-1 leading-tight">
                <div className="text-xs font-medium text-zinc-900">
                  Savvy Net
                </div>
                <div className="text-[10px] text-zinc-500">
                  {processId === "finance" ? "Finance" : "Trade Ops"}
                </div>
              </div>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProcessProvider>
      <AppShellInner>{children}</AppShellInner>
    </WorkspaceProcessProvider>
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
