import { MailReplyMark } from "@/components/agents/mail-reply-mark";
import { PageHeader } from "@/components/layout/app-shell";
import { AgentInbox } from "@/components/mail/inbox/agent-inbox";

export default function InboxPage() {
  return (
    <div>
      <PageHeader
        title="Inbox"
        description="The reply writer reads every mail, pulls out what matters for the deal, and drafts the reply. You review and send."
        actions={<MailReplyMark />}
      />
      <AgentInbox />
    </div>
  );
}
