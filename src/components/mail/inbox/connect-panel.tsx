"use client";

import { useState } from "react";
import { Copy, Loader2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export type MailProvider = "gmail" | "outlook" | "forward";

export const PROVIDER_LABELS: Record<MailProvider, { name: string; via: string }> = {
  gmail: { name: "Gmail", via: "Google Workspace" },
  outlook: { name: "Outlook", via: "Microsoft 365" },
  forward: { name: "Mail", via: "mail forwarding" },
};

const PROVIDERS: { id: MailProvider; name: string; detail: string; button: string }[] = [
  { id: "gmail", name: "Gmail", detail: "Google Workspace and Gmail", button: "Sign in with Google" },
  { id: "outlook", name: "Outlook", detail: "Microsoft 365, Exchange Online and Outlook.com", button: "Sign in with Microsoft" },
  { id: "forward", name: "Any other mailbox", detail: "Zoho Mail, GoDaddy, Rediff or your own mail server", button: "I've set up forwarding" },
];

const STEPS = [
  { title: "Connect", text: "Sign in once. Nothing changes for your team — they keep using their usual mailbox." },
  { title: "Read", text: "Every new mail from buyers, factories and forwarders is read by the right stage agent." },
  { title: "Draft", text: "The agent links the mail to its deal, pulls out what matters and drafts the reply." },
  { title: "Send", text: "You review, edit if needed and send. Only real decisions reach you." },
];

const FORWARD_ADDRESS = "trade-7f3k2@in.mail.vibrium.ai";

export function ProviderMark({ provider, className = "h-6 w-6" }: { provider: MailProvider; className?: string }) {
  if (provider === "outlook") {
    return (
      <svg className={className} viewBox="0 0 32 32" aria-hidden>
        <rect x="2" y="4" width="28" height="24" rx="5" fill="#0a64d6" />
        <ellipse cx="13" cy="16" rx="5.2" ry="6.2" fill="none" stroke="#fff" strokeWidth="2.6" />
        <path d="M20 11h7v10h-7" fill="none" stroke="#9cc8ff" strokeWidth="2" />
      </svg>
    );
  }
  if (provider === "gmail") {
    return (
      <svg className={className} viewBox="0 0 32 32" aria-hidden>
        <rect x="2" y="6" width="28" height="20" rx="4" fill="#fff" stroke="#e3e8ec" />
        <path d="M4 9l12 9 12-9" fill="none" stroke="#ea4335" strokeWidth="3" strokeLinejoin="round" />
        <path d="M4 9v15" stroke="#4285f4" strokeWidth="3" />
        <path d="M28 9v15" stroke="#34a853" strokeWidth="3" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden>
      <rect x="2" y="4" width="28" height="24" rx="5" fill="#134e4a" />
      <path d="M8 12h16v10H8z" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M8 12l8 6 8-6" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M20 7l4 2-4 2" fill="none" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Shown until a mailbox is connected. */
export function ConnectPanel({
  mailboxAddress,
  onConnect,
}: {
  mailboxAddress: string;
  onConnect: (provider: MailProvider) => Promise<void> | void;
}) {
  const [provider, setProvider] = useState<MailProvider>("gmail");
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const chosen = PROVIDERS.find((p) => p.id === provider)!;

  async function copy() {
    try {
      await navigator.clipboard.writeText(FORWARD_ADDRESS);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      await onConnect(provider);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Trade mailbox</p>
      <h2 className="mt-1 text-xl font-semibold text-zinc-900">Connect your sourcing inbox</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
        Use the mailbox your team already works from. Your inbox opens here, Vibrium agents read every new mail,
        link it to the right deal and draft the reply — you just review and send.
      </p>

      <div className="mt-6 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mail provider">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={provider === p.id}
            onClick={() => setProvider(p.id)}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition",
              provider === p.id ? "border-teal-600 bg-teal-50/60 ring-1 ring-teal-600" : "border-zinc-200 hover:border-zinc-300",
            )}
          >
            <ProviderMark provider={p.id} className="mt-0.5 h-7 w-7 shrink-0" />
            <span>
              <strong className="block text-sm text-zinc-900">{p.name}</strong>
              <small className="text-xs text-zinc-500">{p.detail}</small>
            </span>
          </button>
        ))}
      </div>

      {provider === "forward" ? (
        <div className="mt-4 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">
          Add a forwarding rule that sends a copy of every mail for <b className="text-zinc-900">{mailboxAddress}</b> to
          this address:
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 text-xs text-zinc-800 ring-1 ring-zinc-200">{FORWARD_ADDRESS}</code>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
              <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      <ol className="mt-6 grid gap-4 sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="text-sm">
            <span className="flex items-center gap-2 font-semibold text-zinc-900">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-700 text-[11px] text-white">{i + 1}</span>
              {s.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{s.text}</span>
          </li>
        ))}
      </ol>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={connect}
          disabled={connecting}
          className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-70"
        >
          {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {connecting ? "Connecting…" : chosen.button}
        </button>
        <span className="text-xs text-zinc-500">You can disconnect at any time.</span>
      </div>
    </section>
  );
}
