"use client";

import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { PageHeader } from "@/components/layout/app-shell";

export default function CopilotPage() {
  return (
    <div>
      <PageHeader
        title="Ops Copilot"
        description="Savvy — ask about any deal or PO, parties, payments, shipments, or what needs attention. Answers come from the live mailbox book."
      />
      <CopilotPanel />
    </div>
  );
}
