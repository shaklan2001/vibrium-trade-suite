"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  GLOBAL_SIDEBAR_NAV,
  WORKSPACE_PROCESSES,
  type NavItem,
  type WorkspaceProcessId,
} from "@/lib/trade/workspaceProcess";
import {
  useWorkspaceProcess,
  WorkspaceProcessProvider,
} from "@/components/layout/workspace-process";
import { MailboxHydrator } from "@/components/layout/mailbox-hydrator";
import { MailAutoSync } from "@/components/layout/mail-auto-sync";
import { useTradeStore } from "@/lib/trade/store";
import {
  COMMERCIAL_MODEL_OPTIONS,
  type CommercialModelFilter,
} from "@/lib/trade/commercialModel";
import {
  DISPLAY_CURRENCY_OPTIONS,
  type DisplayCurrency,
} from "@/lib/trade/currencyDisplay";

const LOGO_SRC =
  "https://vibrium-artifacts.s3.ap-south-1.amazonaws.com/site-artifacts/Vibrium-Logo.png";
const COLLAPSE_KEY = "vtrade.sidebar.collapsed";
const DESKTOP_QUERY = "(min-width: 981px)";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="rail-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function isActive(pathname: string, href: string, siblings: NavItem[]) {
  const matches = (target: string) =>
    pathname === target || pathname.startsWith(`${target}/`);
  const shadowed = siblings.some(
    (other) =>
      other.href.length > href.length &&
      other.href.startsWith(`${href}/`) &&
      matches(other.href),
  );
  if (
    href === "/partners" &&
    (pathname === "/supplier-hub" || pathname.startsWith("/supplier-hub/"))
  ) {
    return true;
  }
  return matches(href) && !shadowed;
}

function CommercialModelToggle() {
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const setFilter = useTradeStore((s) => s.setCommercialModelFilter);

  return (
    <label className="chip-select">
      <span className="chip-label">Book</span>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as CommercialModelFilter)}
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
    <label className="chip-select">
      <span className="chip-label">Currency</span>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
        aria-label="Filter by commission payment currency"
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

  return (
    <div className="segment" role="tablist" aria-label="Workspace process">
      {WORKSPACE_PROCESSES.map((p) => {
        const active = hydrated && processId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={!hydrated}
            onClick={() => setProcessId(p.id)}
          >
            {p.shortLabel}
          </button>
        );
      })}
    </div>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  open,
  onToggle,
  collapsed,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  open: boolean;
  onToggle: () => void;
  collapsed: boolean;
}) {
  const groupId = `nav-group-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const shown = collapsed || open;
  return (
    <div className="nav-group">
      <button
        className="nav-section"
        type="button"
        aria-expanded={shown}
        aria-controls={groupId}
        tabIndex={collapsed ? -1 : 0}
        onClick={onToggle}
      >
        <span className="fade-label">{label}</span>
        <svg
          className={shown ? "chevron open" : "chevron"}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      <div
        className={shown ? "nav-group-items open" : "nav-group-items"}
        id={groupId}
        inert={shown ? undefined : true}
      >
        <div>
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href, items);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
                data-label={item.label}
              >
                <Icon className="nav-icon" />
                <span className="fade-label">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function JumpPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: { href: string; label: string; group: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  function go(href: string) {
    router.push(href);
    onClose();
  }

  return (
    <div className="palette-layer open">
      <button className="palette-scrim" type="button" aria-label="Close search" onClick={onClose} />
      <div className="palette" role="dialog" aria-label="Jump to">
        <div className="palette-search">
          <Glyph>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </Glyph>
          <input
            autoFocus
            placeholder="Jump to…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && filtered[index]) {
                go(filtered[index].href);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="palette-empty">No pages match.</p>
        ) : (
          <ul className="palette-list">
            {filtered.map((item, i) => (
              <li key={`${item.group}-${item.href}`}>
                <button
                  type="button"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(item.href)}
                >
                  {item.label}
                  <small>{item.group}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { process, processId } = useWorkspaceProcess();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);

  const home = process.nav.find((item) => item.href === "/home");
  const processItems = process.nav.filter((item) => item.href !== "/home");

  useEffect(() => {
    setIsCollapsed(document.documentElement.dataset.rail === "collapsed");
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    document.documentElement.dataset.rail = isCollapsed ? "collapsed" : "expanded";
    try {
      window.localStorage.setItem(COLLAPSE_KEY, isCollapsed ? "1" : "0");
    } catch {
      /* toggle still works this visit */
    }
  }, [isCollapsed, isReady]);

  const toggleCollapsed = useCallback(() => {
    setTip(null);
    setIsCollapsed((collapsed) => !collapsed);
  }, []);

  useEffect(() => {
    setIsNavOpen(false);
    setIsPaletteOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
      } else if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleCollapsed();
      } else if (event.key === "Escape") {
        setIsNavOpen(false);
        setIsPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

  const crumbs = useMemo(() => {
    const all = [...process.nav, ...GLOBAL_SIDEBAR_NAV];
    const match = [...all]
      .sort((a, b) => b.href.length - a.href.length)
      .find(
        (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
      );
    const trail: { label: string; href?: string }[] = [
      { label: "Trade Suite", href: "/home" },
    ];
    if (!match || match.href === "/home") {
      trail.push({ label: "Command Center" });
      return trail;
    }
    trail.push({ label: process.label });
    if (pathname === match.href) {
      trail.push({ label: match.label });
    } else {
      trail.push({ label: match.label, href: match.href });
      trail.push({ label: "Detail" });
    }
    return trail;
  }, [pathname, process.label, process.nav]);

  const paletteItems = useMemo(
    () => [
      ...WORKSPACE_PROCESSES.flatMap((p) =>
        p.nav.map((item) => ({
          href: item.href,
          label: item.label,
          group: p.label,
        })),
      ),
      ...GLOBAL_SIDEBAR_NAV.map((item) => ({
        href: item.href,
        label: item.label,
        group: "Desk",
      })),
    ],
    [],
  );

  function showTip(event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    if (!isCollapsed || !window.matchMedia(DESKTOP_QUERY).matches) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-label]");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setTip({ label: target.dataset.label ?? "", top: rect.top + rect.height / 2 });
  }

  const HomeIcon = home?.icon;

  return (
    <>
      <div className={isReady ? "shell ready" : "shell"}>
        <button
          className={isNavOpen ? "backdrop open" : "backdrop"}
          type="button"
          aria-label="Close menu"
          onClick={() => setIsNavOpen(false)}
        />
        <aside className={isNavOpen ? "sidebar open" : "sidebar"} aria-label="Suite navigation">
          <div className="brand-row">
            <Link className="brand" href="/home" data-label="Command Center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="brand-logo" src={LOGO_SRC} alt="" width={32} height={32} />
              <p className="fade-label">
                <strong>Vibrium</strong>
                <span>Trade Suite</span>
              </p>
            </Link>
            <button
              className="drawer-close"
              type="button"
              aria-label="Close menu"
              onClick={() => setIsNavOpen(false)}
            >
              <Glyph>
                <path d="M6 6l12 12M18 6 6 18" />
              </Glyph>
            </button>
          </div>
          <button
            className="rail-button"
            type="button"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isCollapsed}
            onClick={toggleCollapsed}
          >
            <Glyph>
              <path d="m15 6-6 6 6 6" />
            </Glyph>
          </button>
          <nav
            aria-label="Suite"
            onMouseOver={showTip}
            onFocus={showTip}
            onMouseLeave={() => setTip(null)}
          >
            {home && HomeIcon ? (
              <Link
                href="/home"
                className="nav-link"
                aria-current={pathname === "/home" ? "page" : undefined}
                data-label={home.label}
              >
                <HomeIcon className="nav-icon" />
                <span className="fade-label">{home.label}</span>
              </Link>
            ) : null}
            <NavGroup
              label={process.label}
              items={processItems}
              pathname={pathname}
              open={openGroups[process.id] !== false}
              collapsed={isCollapsed}
              onToggle={() =>
                setOpenGroups((current) => ({
                  ...current,
                  [process.id]: current[process.id] === false,
                }))
              }
            />
            <NavGroup
              label="Desk"
              items={GLOBAL_SIDEBAR_NAV}
              pathname={pathname}
              open={openGroups.desk !== false}
              collapsed={isCollapsed}
              onToggle={() =>
                setOpenGroups((current) => ({
                  ...current,
                  desk: current.desk === false,
                }))
              }
            />
          </nav>
          <div
            className="account"
            data-label={`Savvy Net · ${processId === "finance" ? "Finance" : "Trade Ops"}`}
            onMouseOver={showTip}
            onMouseLeave={() => setTip(null)}
          >
            <div className="account-avatar" aria-hidden="true">
              SN
            </div>
            <div className="account-copy fade-label">
              <p>Savvy Net</p>
              <span>{processId === "finance" ? "Finance" : "Trade Ops"}</span>
            </div>
          </div>
        </aside>
        {tip && isCollapsed ? (
          <span className="rail-tip" role="tooltip" style={{ top: tip.top }}>
            {tip.label}
          </span>
        ) : null}
        <div className="workspace">
          <header className="topbar">
            <div className="topbar-start">
              <button
                className="icon-button menu-button"
                type="button"
                aria-label="Open menu"
                onClick={() => setIsNavOpen(true)}
              >
                <Glyph>
                  <path d="M4 7h16M4 12h16M4 17h10" />
                </Glyph>
              </button>
              <nav className="crumbs" aria-label="Breadcrumb">
                <ol>
                  {crumbs.map((crumb, index) => {
                    const isLast = index === crumbs.length - 1;
                    return (
                      <li key={`${crumb.label}-${index}`}>
                        {crumb.href && !isLast ? (
                          <Link href={crumb.href}>{crumb.label}</Link>
                        ) : (
                          <span aria-current={isLast ? "page" : undefined}>
                            {crumb.label}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </div>
            <div className="topbar-actions">
              <ProcessToggle />
              <CommercialModelToggle />
              <CurrencyToggle />
              <MailAutoSync />
              <MailboxHydrator />
              <button
                className="search-trigger"
                type="button"
                onClick={() => setIsPaletteOpen(true)}
                aria-label="Search pages"
              >
                <Glyph>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </Glyph>
                <span>Jump to…</span>
                <kbd>⌘K</kbd>
              </button>
            </div>
          </header>
          <div className="page-wide">{children}</div>
          <footer className="suite-footer">
            <p>Vibrium Trade Suite</p>
          </footer>
        </div>
      </div>
      <JumpPalette
        open={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        items={paletteItems}
      />
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
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
  actions?: ReactNode;
}) {
  const { process } = useWorkspaceProcess();
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div>
          <p className="kicker">{process.label}</p>
          <h1>{title}</h1>
          {description ? <p className="lede">{description}</p> : null}
        </div>
        {actions}
      </div>
    </div>
  );
}
