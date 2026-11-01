"use client";

import { cn } from "@/lib/utils";

export function LoadingBlock({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-teal-700"
        aria-hidden
      />
      <p className="text-sm font-medium text-zinc-700">{label}</p>
      <p className="max-w-sm text-xs text-zinc-500">
        Pulling the live mailbox book — figures appear when data is ready.
      </p>
    </div>
  );
}

export function KpiSkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-[72px] animate-pulse rounded-lg border border-zinc-200 bg-zinc-100"
        />
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100"
          style={{ animationDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  );
}
