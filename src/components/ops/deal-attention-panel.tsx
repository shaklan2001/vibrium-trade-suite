"use client";

import { Card, CardHeader } from "@/components/ui/primitives";
import { EarlyWarningBody } from "@/components/ops/early-warnings-card";
import { collectEarlyWarnings } from "@/lib/trade/earlyWarnings";
import { useTradeStore } from "@/lib/trade/store";
import type { Deal } from "@/types/trade";

export function DealAttentionPanel({ deal }: { deal: Deal }) {
  const status = useTradeStore((s) => s.mailboxBookStatus);
  const error = useTradeStore((s) => s.mailboxBookError);
  const rows = collectEarlyWarnings([deal]).filter((row) => row.dealId === deal.id);

  return (
    <Card>
      <CardHeader
        title="Early warnings"
        description="PO at risk, delivery at risk, or action needed on this deal"
      />
      <EarlyWarningBody rows={rows} status={status} error={error} />
    </Card>
  );
}
