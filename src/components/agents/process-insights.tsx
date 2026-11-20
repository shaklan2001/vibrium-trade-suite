"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { EditableName } from "@/components/agents/editable-name";
import { useCrewNames } from "@/components/agents/use-crew-names";
import { WorkerAvatar } from "@/components/agents/worker-avatar";
import { useWorkspaceProcess } from "@/components/layout/workspace-process";
import {
  AGENCY_LANE_MARK,
  AUTONOMY_HINTS,
  AUTONOMY_LABELS,
  AUTONOMY_ORDER,
  crewFor,
  identityOf,
  type AgentKind,
  type CrewAgent,
} from "@/lib/trade/crew";
import { bookFor, type ProcessStep } from "@/lib/trade/processBook";

type InsightView = "squad" | "map";

const GROUPS: { kind: AgentKind; title: string; text: string }[] = [
  {
    kind: "conversational",
    title: "Talk to people",
    text: "Chat and email. They answer the desk and draft the reply a person sends.",
  },
  {
    kind: "functional",
    title: "Do the work",
    text: "They read documents and update the book. They do not hold the conversation.",
  },
  {
    kind: "analytical",
    title: "Read and explain",
    text: "They rank and explain. They cite the book and never invent a number.",
  },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Squad and process map for the process currently on screen. */
export function ProcessInsights() {
  const { process, processId } = useWorkspaceProcess();
  const [view, setView] = useState<InsightView | null>(null);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const agents = crewFor(processId);
  const book = bookFor(processId);

  useEffect(() => setMounted(true), []);

  const open = useCallback((next: InsightView) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setView(next);
  }, []);

  const close = useCallback(() => {
    setView(null);
    returnFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (!view) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      cancelAnimationFrame(frame);
    };
  }, [view, close]);

  const openView = view !== null;

  return (
    <>
      <div className="insight-triggers" role="group" aria-label="Process reference">
        <button className="insight-trigger" type="button" onClick={() => open("squad")} aria-haspopup="dialog">
          <Icon>
            <rect x="5" y="8" width="14" height="11" rx="3" />
            <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" />
          </Icon>
          <span>Squad</span>
          <b>{agents.length}</b>
        </button>
        <button className="insight-trigger" type="button" onClick={() => open("map")} aria-haspopup="dialog">
          <Icon>
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="12" r="2" />
            <circle cx="6" cy="18" r="2" />
            <path d="M8 6h4a4 4 0 0 1 4 4M8 18h4a4 4 0 0 0 4-4" />
          </Icon>
          <span>Map</span>
          <b>{book.steps.length}</b>
        </button>
      </div>
      {mounted
        ? createPortal(
            <div className={openView ? "insight-layer open" : "insight-layer"} aria-hidden={!openView}>
              <button className="insight-scrim" type="button" tabIndex={-1} aria-label="Close" onClick={close} />
              <div
                className="insight-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="insight-title"
                ref={panelRef}
                tabIndex={-1}
              >
                <header className="insight-head">
                  <div>
                    <p className="kicker">{process.label}</p>
                    <h2 id="insight-title">{view === "map" ? "Process Map" : "Agentic Squad"}</h2>
                  </div>
                  <div className="insight-switch" role="tablist" aria-label="Reference view">
                    <button type="button" role="tab" aria-selected={view === "squad"} onClick={() => open("squad")}>
                      Squad
                    </button>
                    <button type="button" role="tab" aria-selected={view === "map"} onClick={() => open("map")}>
                      Map
                    </button>
                  </div>
                  <button className="icon-button" type="button" aria-label="Close" onClick={close}>
                    <Icon>
                      <path d="M6 6l12 12M18 6 6 18" />
                    </Icon>
                  </button>
                </header>
                <div className="insight-body">
                  {view === "squad" ? <SquadPanel agents={agents} /> : null}
                  {view === "map" ? <MapPanel steps={book.steps} phases={book.phases} /> : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function SquadPanel({ agents }: { agents: CrewAgent[] }) {
  const { names, rename } = useCrewNames();
  const used = AUTONOMY_ORDER.filter((level) => agents.some((agent) => agent.autonomy === level));

  return (
    <>
      <section className="squad-intro crew-surface">
        <div>
          <h2>{agents.length} agents run this process</h2>
          <p>
            Each card is a person on this process. Click the name to rename them. The portrait stays
            with the role.{" "}
            <Link href="/agents">See the full team</Link>
          </p>
        </div>
        <ul className="autonomy-legend" aria-label="Autonomy levels">
          {used.map((level) => (
            <li key={level}>
              <span className={`autonomy-badge ${level}`}>{AUTONOMY_LABELS[level]}</span>
              <span>{AUTONOMY_HINTS[level]}</span>
            </li>
          ))}
        </ul>
      </section>
      {GROUPS.map((group) => {
        const members = agents.filter((agent) => agent.kind === group.kind);
        if (members.length === 0) return null;
        return (
          <section className="section" key={group.kind}>
            <div className="group-head">
              <h2>{group.title}</h2>
              <p className="meta">{group.text}</p>
            </div>
            <div className="squad-grid">
              {members.map((agent) => {
                const identity = identityOf(agent, names);
                return (
                  <article className="agent-card crew-surface" key={agent.id}>
                    <header className="agent-head">
                      <WorkerAvatar identity={identity} size="md" online />
                      <div>
                        <h3>
                          <EditableName
                            agentId={agent.id}
                            name={identity.name}
                            overridden={Boolean(names[agent.id])}
                            onRename={rename}
                          />
                        </h3>
                        <p className="meta">
                          <b className="team-title">{identity.title}</b> · {agent.role}
                        </p>
                      </div>
                      <span className="agent-live">
                        <i aria-hidden="true" /> On shift
                      </span>
                    </header>
                    <p className="agent-summary">{agent.summary}</p>
                    <div className="agent-autonomy">
                      <span className={`autonomy-badge ${agent.autonomy}`}>{AUTONOMY_LABELS[agent.autonomy]}</span>
                      <span className="meta">{AUTONOMY_HINTS[agent.autonomy]}</span>
                    </div>
                    <div className="agent-chips">
                      {agent.channels.map((channel) => (
                        <span className="chip channel" key={channel}>
                          {channel}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

function phaseLabel(phase: string) {
  const parts = phase.split("·");
  return (parts.length > 1 ? parts.slice(1).join("·") : phase).trim();
}

function MapPanel({ steps, phases }: { steps: ProcessStep[]; phases: readonly string[] }) {
  const columns = Array.from(new Set(steps.map((step) => step.phase)));
  const lanes = Array.from(new Set(steps.map((step) => step.lane)));

  return (
    <>
      <section className="crew-surface map-intro">
        <div>
          <h2>Who does what, in order</h2>
          <p>
            Read left to right. Blue rows are the agency agents. Amber rows are the buyer, factory,
            or forwarder, where a person decides.
          </p>
        </div>
        <ol className="phase-strip" aria-label="Phases">
          {phases.map((phase, index) => (
            <li key={phase}>
              <b>{index + 1}</b> {phase}
            </li>
          ))}
        </ol>
        <p className="meta">
          <Link href="/docs">Open the full process map</Link>
        </p>
      </section>
      <section className="section">
        <h2>Swimlanes</h2>
        <div className="swim-scroll" tabIndex={0}>
          <div
            className="swim"
            style={{ gridTemplateColumns: `10rem repeat(${columns.length}, minmax(8.5rem, 1fr))` }}
          >
            <span className="swim-corner">Actor</span>
            {columns.map((phase) => (
              <span className="swim-phase" key={phase}>
                {phaseLabel(phase)}
              </span>
            ))}
            {lanes.map((lane) => {
              const isAgent = lane.includes(AGENCY_LANE_MARK);
              return (
                <LaneRow key={lane} lane={lane} isAgent={isAgent} columns={columns} steps={steps} />
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

function LaneRow({
  lane,
  isAgent,
  columns,
  steps,
}: {
  lane: string;
  isAgent: boolean;
  columns: string[];
  steps: ProcessStep[];
}) {
  return (
    <>
      <span className={`swim-lane ${isAgent ? "agent" : "human"}`}>
        {lane}
        <small>{isAgent ? "Agent" : "Person or system"}</small>
      </span>
      {columns.map((phase) => {
        const owned = steps.filter((step) => step.lane === lane && step.phase === phase);
        return (
          <span className="swim-cell" key={`${lane}-${phase}`}>
            {owned.map((step) => (
              <span className={`swim-step ${isAgent ? "agent" : "human"}`} key={step.id}>
                <b>{step.id}</b>
                {step.title}
              </span>
            ))}
          </span>
        );
      })}
    </>
  );
}
