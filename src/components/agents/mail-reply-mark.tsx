"use client";

import Link from "next/link";
import { useCrewNames } from "@/components/agents/use-crew-names";
import { WorkerAvatar } from "@/components/agents/worker-avatar";
import { CREW, MAIL_REPLY_AGENT_ID, identityOf } from "@/lib/trade/crew";

export function useMailReplyName() {
  const { names } = useCrewNames();
  const agent = CREW.find((item) => item.id === MAIL_REPLY_AGENT_ID);
  return agent ? identityOf(agent, names).name : "Reply Writer";
}

/** The person who reads the thread and drafts the reply. */
export function MailReplyMark() {
  const { names } = useCrewNames();
  const agent = CREW.find((item) => item.id === MAIL_REPLY_AGENT_ID);
  if (!agent) return null;
  const identity = identityOf(agent, names);

  return (
    <Link href={`/agents#agent-${MAIL_REPLY_AGENT_ID}`} className="mail-reply-mark">
      <WorkerAvatar identity={identity} size="sm" online />
      <span>
        <strong>{identity.name}</strong>
        <small>{identity.title} · drafts the reply</small>
      </span>
    </Link>
  );
}
