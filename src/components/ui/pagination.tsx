"use client";

import { Button } from "@/components/ui/primitives";

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);

  if (total <= pageSize) {
    return (
      <p className="mt-4 text-center text-xs text-zinc-500">
        {total === 0 ? "No rows" : `Showing ${total}`}
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-zinc-500">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Previous
        </Button>
        <span className="text-xs tabular-nums text-zinc-600">
          Page {safePage} / {pages}
        </span>
        <Button
          variant="secondary"
          disabled={safePage >= pages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
