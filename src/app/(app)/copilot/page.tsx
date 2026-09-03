"use client";

import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { PageHeader } from "@/components/layout/app-shell";
import { useTradeStore } from "@/lib/trade/store";

export default function CopilotPage() {
  const dealId = useTradeStore((s) => s.deals[0]?.id);
  return (
    <div>
      <PageHeader
        title="Ops Copilot"
        description="Conversational agent (agents-api) grounded with the current deal JSON."
      />
      <CopilotPanel dealId={dealId} />
    </div>
  );
}
