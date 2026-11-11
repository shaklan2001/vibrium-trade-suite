"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

const field =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600";

/**
 * Connect a team mailbox with its email + password (IMAP to read, SMTP to
 * send). The mail server is backend config (MAIL_IMAP_HOST …), so people only
 * enter what they know. Re-submitting an address updates its password.
 */
export function ImapConnectForm({
  onConnected,
  defaultEmail = "",
  defaultName = "",
  submitLabel = "Connect mailbox",
}: {
  onConnected: (email: string) => void;
  defaultEmail?: string;
  defaultName?: string;
  submitLabel?: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mail/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPassword("");
      toast.success(`${email.trim()} connected — importing mail`);
      onConnected(email.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-zinc-700">Email address</span>
        <input
          required
          type="email"
          autoComplete="username"
          className={field}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@snspl.in"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-zinc-700">Mailbox password</span>
        <input
          required
          type="password"
          autoComplete="current-password"
          className={field}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Same as Outlook / webmail"
        />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-zinc-700">
          Name <span className="font-normal text-zinc-400">(signs the replies)</span>
        </span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sanchita" />
      </label>

      {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {busy ? "Checking login…" : submitLabel}
        </button>
        <span className="text-xs text-zinc-500">
          The login is checked with the company mail server and stored encrypted. Several wrong passwords in a row can
          get the office IP blocked by the host.
        </span>
      </div>
    </form>
  );
}
