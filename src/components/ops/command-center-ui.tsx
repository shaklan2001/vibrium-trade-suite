"use client";

import { useState } from "react";
import type { ProvenanceCite } from "@/types/trade";

/** Compact source count — expand only on demand */
export function ProvenanceList({
  sources,
  title,
  defaultOpen = false,
  alwaysShow = false,
}: {
  sources: ProvenanceCite[];
  title?: string;
  defaultOpen?: boolean;
  /** When true, show excerpts inline without a toggle */
  alwaysShow?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!sources?.length) {
    return (
      <p className="text-[10px] text-zinc-400">No source messages linked</p>
    );
  }
  if (alwaysShow) {
    return (
      <ul className="mt-1 space-y-1.5">
        {title ? (
          <li className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {title}
          </li>
        ) : null}
        {sources.map((s, i) => (
          <li
            key={`${s.sourceId || s.dealId}-${i}`}
            className="rounded border border-zinc-100 bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-700"
          >
            <div className="font-medium text-zinc-900">
              {s.subject || s.kind || "Source"}
            </div>
            {s.from ? (
              <div className="text-[10px] text-zinc-500">{s.from}</div>
            ) : null}
            {s.excerpt ? (
              <p className="mt-0.5 leading-snug text-zinc-600">{s.excerpt}</p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 hover:bg-zinc-200"
        onClick={() => setOpen((v) => !v)}
        title="Source messages"
      >
        {sources.length} source{sources.length === 1 ? "" : "s"}
      </button>
      {open ? (
        <ul className="absolute z-10 mt-1 max-w-xs space-y-1 rounded border border-zinc-200 bg-white p-2 shadow-lg">
          {sources.map((s, i) => (
            <li
              key={`${s.sourceId || s.dealId}-${i}`}
              className="text-[10px] text-zinc-600"
            >
              <span className="font-mono text-zinc-800">
                {s.dealCode || ""}
              </span>{" "}
              {(s.subject || "").slice(0, 48)}
              {s.excerpt ? (
                <p className="mt-0.5 text-zinc-500">{s.excerpt.slice(0, 120)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  tone = "neutral",
  size = "md",
  onClick,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  size?: "md" | "lg";
  onClick?: () => void;
  href?: string;
}) {
  const ring =
    tone === "danger"
      ? "border-red-200 bg-red-50/50"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/50"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50/50"
          : tone === "info"
            ? "border-sky-200 bg-sky-50/50"
            : "border-zinc-200 bg-white";
  const clickable = Boolean(onClick || href);
  const className = `rounded-lg border shadow-sm ${ring} ${
    size === "lg" ? "px-4 py-4" : "px-3 py-3"
  } ${
    clickable
      ? "cursor-pointer transition hover:border-teal-400 hover:shadow-md hover:ring-2 hover:ring-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      : ""
  }`;
  const inner = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
        {clickable ? (
          <span className="ml-1 font-normal normal-case text-teal-700">
            · open
          </span>
        ) : null}
      </div>
      <div
        className={`mt-1 font-semibold tabular-nums tracking-tight text-zinc-900 ${
          size === "lg" ? "text-2xl sm:text-3xl" : "text-xl"
        }`}
      >
        {value}
      </div>
    </>
  );
  if (href) {
    return (
      <a href={href} className={`block ${className}`}>
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`w-full text-left ${className}`}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

export function ExpandSection({
  id,
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  id: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-zinc-50/80"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-700">
            {title}
          </h2>
          {badge ? (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
              {badge}
            </span>
          ) : null}
        </div>
        <span className="text-[11px] font-medium text-teal-800">
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? <div className="border-t border-zinc-100 px-3 py-3">{children}</div> : null}
    </section>
  );
}
