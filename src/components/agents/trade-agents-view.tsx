"use client";

import Link from "next/link";
import { WorkerAvatar } from "@/components/agents/worker-avatar";
import { EditableName } from "@/components/agents/editable-name";
import { useCrewNames } from "@/components/agents/use-crew-names";
import { WORKSPACE_PROCESSES } from "@/lib/trade/workspaceProcess";
import {
  AUTONOMY_LABELS,
  CREW,
  CREW_BANNER_FACE_LIMIT,
  MAIL_REPLY_AGENT_ID,
  identityOf,
  type CrewAgent,
} from "@/lib/trade/crew";

const MAIL_SECTION_ID = "mail";

const PROCESS_COPY: Record<string, { oneLiner: string }> = {
  ops: {
    oneLiner:
      "From the buyer enquiry through artwork, samples, production, and the booking.",
  },
  finance: {
    oneLiner:
      "Reads payments into the ledger, runs the payment clock, and closes commission.",
  },
};

export function TradeAgentsView() {
  const { names, rename } = useCrewNames();
  const faces = Array.from(
    new Map(CREW.map((agent) => [identityOf(agent, names).seed, identityOf(agent, names)])).values(),
  );
  const talkers = CREW.filter((agent) => agent.kind === "conversational").length;

  return (
    <main className="crew-page">
      <header className="page-header">
        <p className="kicker">Your trade team</p>
        <h1>Trade Agents</h1>
        <p className="lede">
          The people behind each process: who they are, what they do, and how far they go on
          their own. Click a name to rename them. The face stays.
        </p>
      </header>

      <section className="crew-banner crew-surface" aria-label="Team on shift">
        <div className="crew-banner-faces">
          {faces.slice(0, CREW_BANNER_FACE_LIMIT).map((identity) => (
            <span key={identity.seed} className="crew-banner-face" title={`${identity.name} · ${identity.title}`}>
              <WorkerAvatar identity={identity} size="sm" />
            </span>
          ))}
          {faces.length > CREW_BANNER_FACE_LIMIT ? (
            <span className="crew-banner-more">+{faces.length - CREW_BANNER_FACE_LIMIT}</span>
          ) : null}
        </div>
        <div className="crew-banner-text">
          <strong>
            <span className="crew-live-dot" aria-hidden="true" /> {CREW.length} agents on shift
          </strong>
          <span className="meta">
            {talkers} talk to the desk · {CREW.length - talkers} work the files · {WORKSPACE_PROCESSES.length} processes
          </span>
        </div>
        <nav className="crew-jump" aria-label="Jump to a process">
          <a href={`#crew-${MAIL_SECTION_ID}`} className="chip">
            Mail
          </a>
          {WORKSPACE_PROCESSES.map((process) => (
            <a key={process.id} href={`#crew-${process.id}`} className="chip">
              {process.label}
            </a>
          ))}
        </nav>
      </section>

      <ProcessCrew
        sectionId={MAIL_SECTION_ID}
        label="Mail"
        home="/mailbox/inbox"
        oneLiner="Reads the mailbox and drafts the reply. You review it and send it."
        agents={CREW.filter((agent) => agent.id === MAIL_REPLY_AGENT_ID)}
        names={names}
        onRename={rename}
      />

      {WORKSPACE_PROCESSES.map((process) => (
        <ProcessCrew
          key={process.id}
          sectionId={process.id}
          label={process.label}
          home={process.homeHref}
          oneLiner={PROCESS_COPY[process.id]?.oneLiner ?? process.description}
          agents={CREW.filter(
            (agent) => agent.processId === process.id && agent.id !== MAIL_REPLY_AGENT_ID,
          )}
          names={names}
          onRename={rename}
        />
      ))}
    </main>
  );
}

function ProcessCrew({
  sectionId,
  label,
  home,
  oneLiner,
  agents,
  names,
  onRename,
}: {
  sectionId: string;
  label: string;
  home: string;
  oneLiner: string;
  agents: CrewAgent[];
  names: Record<string, string>;
  onRename: (id: string, value: string) => void;
}) {
  const conversational = agents.filter((agent) => agent.kind === "conversational");
  const functional = agents.filter((agent) => agent.kind !== "conversational");

  return (
    <section className="crew-card crew-surface" id={`crew-${sectionId}`}>
      <header className="crew-card-head">
        <svg className="crew-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="8" width="16" height="11" rx="2.5" />
          <path d="M12 4v4M9 13h.01M15 13h.01M2 13v2M22 13v2" />
        </svg>
        <h2>
          <Link href={home}>{label}</Link>
        </h2>
        <span className="crew-card-count">
          <span className="flow-crew-faces">
            {agents.slice(0, 5).map((agent) => (
              <WorkerAvatar key={agent.id} identity={identityOf(agent, names)} size="xs" />
            ))}
          </span>
          {agents.length} agents
        </span>
      </header>
      <div className="crew-card-body">
        <p className="crew-desc">{oneLiner}</p>
        {conversational.length > 0 ? (
          <CrewGroup title="Conversational" agents={conversational} names={names} onRename={onRename} />
        ) : null}
        {functional.length > 0 ? (
          <CrewGroup title="Functional" agents={functional} names={names} onRename={onRename} />
        ) : null}
      </div>
    </section>
  );
}

function CrewGroup({
  title,
  agents,
  names,
  onRename,
}: {
  title: string;
  agents: CrewAgent[];
  names: Record<string, string>;
  onRename: (id: string, value: string) => void;
}) {
  return (
    <div className="crew-group">
      <p className="crew-group-title">{title}</p>
      <div className="crew-grid">
        {agents.map((agent) => (
          <CrewTile key={agent.id} agent={agent} names={names} onRename={onRename} />
        ))}
      </div>
    </div>
  );
}

function CrewTile({
  agent,
  names,
  onRename,
}: {
  agent: CrewAgent;
  names: Record<string, string>;
  onRename: (id: string, value: string) => void;
}) {
  const identity = identityOf(agent, names);
  return (
    <article className="crew-tile team-card" id={`agent-${agent.id}`} tabIndex={0}>
      <header className="crew-tile-head">
        <WorkerAvatar identity={identity} size="md" online />
        <div>
          <p className="crew-label">{identity.title}</p>
          <h3>
            <EditableName
              agentId={agent.id}
              name={identity.name}
              overridden={Boolean(names[agent.id])}
              onRename={onRename}
            />
          </h3>
          <p className="meta">{agent.role}</p>
        </div>
        <span className="crew-working" aria-label="Working">
          <i />
          <i />
          <i />
        </span>
      </header>
      <p className="crew-summary">{agent.summary}</p>
      <footer className="crew-tile-foot">
        <span className={`autonomy-badge ${agent.autonomy}`}>{AUTONOMY_LABELS[agent.autonomy]}</span>
        {agent.channels.map((channel) => (
          <span className="chip channel" key={channel}>
            {channel}
          </span>
        ))}
      </footer>
    </article>
  );
}
