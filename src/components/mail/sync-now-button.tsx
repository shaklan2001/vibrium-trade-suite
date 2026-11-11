"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/primitives";
import { describeSync, syncMailNow } from "@/lib/mail/client";
import { hydrateMailboxBook } from "@/lib/trade/mailboxHydrate";

/** Pull new mail from every connected inbox, then refresh the deal book. */
export function SyncNowButton({
  onSynced,
  label = "Sync now",
}: {
  onSynced?: () => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const id = toast.loading("Syncing connected inboxes…");
    try {
      const r = await syncMailNow({
        onProgress: (p) =>
          toast.loading(
            `Syncing… ${p.ingested} new message${p.ingested === 1 ? "" : "s"}${p.remaining ? ` · ${p.remaining} to go` : ""}`,
            { id },
          ),
      });
      if (r.errors.length) toast.error(r.errors[0], { id });
      else toast.success(describeSync(r), { id });
      await hydrateMailboxBook();
      onSynced?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      toast.error(msg.includes("No database") ? "Mail sync isn't configured on the server yet" : msg, { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={run} disabled={busy}>
      <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Syncing…" : label}
    </Button>
  );
}
