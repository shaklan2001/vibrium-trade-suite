"use client";

import Link from "next/link";
import { ImapConnectForm } from "@/components/mail/imap-connect-form";

const STEPS = [
  { title: "Connect", text: "Each team member connects their mailbox once with email + password." },
  { title: "Read", text: "Every connected mailbox lands in one shared inbox; deal mail goes to its stage agent." },
  { title: "Draft", text: "Vibrium Copilot drafts the reply from the whole conversation." },
  { title: "Send", text: "Review and send — it goes out from that member's own address and lands in Sent." },
];

/** Shown when no team mailbox is connected yet. */
export function ConnectPanel({ onConnected }: { onConnected: (email: string) => void }) {
  return (
    <section className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Team inbox</p>
      <h2 className="mt-1 text-xl font-semibold text-zinc-900">Connect the first mailbox</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
        Connect each team member&apos;s mailbox and everyone works from one inbox: switch between people, or see all of
        them together. More mailboxes can be added on{" "}
        <Link href="/mailbox/connections" className="font-medium text-teal-700 hover:underline">
          Email connections
        </Link>
        .
      </p>
      <div className="mt-6">
        <ImapConnectForm onConnected={onConnected} />
      </div>
      <ol className="mt-6 grid gap-4 border-t border-zinc-100 pt-5 sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="text-sm">
            <span className="flex items-center gap-2 font-semibold text-zinc-900">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-700 text-[11px] text-white">
                {i + 1}
              </span>
              {s.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
