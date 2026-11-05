import { PageHeader } from "@/components/layout/app-shell";
import { AgentInbox } from "@/components/mail/inbox/agent-inbox";

export default function InboxPage() {
  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Vibrium agents read every mail, pull out what matters for the deal, and draft the reply. You review and send."
      />
      <AgentInbox />
    </div>
  );
}
