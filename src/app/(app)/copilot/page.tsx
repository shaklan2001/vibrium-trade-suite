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
        description="Savvy — answers attention, todos, product, process, and deal questions. Grounded on Command Center pulse + current deal."
      />
      <CopilotPanel dealId={dealId} />
    </div>
  );
}
