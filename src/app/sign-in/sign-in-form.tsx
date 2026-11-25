"use client";

import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui/primitives";

export function SignInForm({ next, configured }: { next: string; configured: boolean }) {
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          res.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : body?.error || `Sign-in failed (${res.status})`,
        );
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
      <p className="signin-note">
        Sign-in isn&apos;t set up on this server yet. Set <code>APP_ADMIN_EMAIL</code>,{" "}
        <code>APP_ADMIN_PASSWORD</code> and <code>APP_JWT_SECRET</code> (32+ characters) in the
        environment, then reload.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="signin-form">
      <div>
        <label htmlFor="sign-in-email" className="field-label">
          Email
        </label>
        <Input
          id="sign-in-email"
          type="email"
          name="email"
          autoComplete="username"
          placeholder="you@snspl.in"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="sign-in-password" className="field-label">
          Password
        </label>
        <Input
          id="sign-in-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="signin-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="signin-submit" disabled={busy || !email || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
