"use client";

import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "@/components/ui/primitives";

export function SignInForm({ next, configured }: { next: string; configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error || `Sign-in failed (${res.status})`);
        return;
      }
      // Full navigation so every request after this carries the new cookie.
      window.location.assign(next);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="card p-5 text-sm text-zinc-700">
        Sign-in isn&apos;t set up on this server yet. Set <code>APP_ACCESS_PASSWORD</code> and{" "}
        <code>APP_SESSION_SECRET</code> (32+ characters) in the environment, then reload.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-3 p-5">
      <Label>Team password</Label>
      <Input
        type="password"
        name="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
