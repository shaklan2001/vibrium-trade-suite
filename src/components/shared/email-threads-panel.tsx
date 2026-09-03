"use client";

import { useState } from "react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { listEmailThreads } from "@/services/channelsApi";

export function EmailThreadsPanel() {
  const [rows, setRows] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const data = await listEmailThreads({ limit: 20 });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const threads = Array.isArray(rows)
    ? rows
    : rows && typeof rows === "object" && "threads" in (rows as object)
      ? ((rows as { threads: unknown[] }).threads || [])
      : [];

  return (
    <Card>
      <CardHeader
        title="Email SES threads"
        description="Inbound/outbound mailbox history from existing email-ses APIs"
        action={
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            Load threads
          </Button>
        }
      />
      <div className="max-h-72 overflow-auto p-4 text-sm">
        {error ? <p className="text-red-600">{error}</p> : null}
        {threads.length === 0 && !error ? (
          <p className="text-zinc-500">
            No threads loaded yet (or mailbox not registered on this org).
          </p>
        ) : (
          <ul className="space-y-2">
            {threads.map((t, i) => {
              const row = t as Record<string, unknown>;
              return (
                <li key={String(row.id || row.thread_id || i)} className="border-b border-zinc-50 pb-2">
                  <div className="font-medium">
                    {String(row.subject || row.title || "Untitled")}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {String(row.from || row.sender || "")}{" "}
                    {row.updated_at
                      ? `· ${String(row.updated_at)}`
                      : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
