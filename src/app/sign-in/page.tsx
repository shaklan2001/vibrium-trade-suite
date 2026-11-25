import type { Metadata } from "next";
import Link from "next/link";
import { authEnv, safeNextPath } from "@/lib/auth/session";
import { SignInForm } from "./sign-in-form";
import "@/styles/sign-in.css";

export const metadata: Metadata = { title: "Sign in — Vibrium × SNSPL" };
export const dynamic = "force-dynamic";

const VIBRIUM_LOGO =
  "https://vibrium-artifacts.s3.ap-south-1.amazonaws.com/site-artifacts/Vibrium-Logo.png";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="signin">
      <section className="signin-panel" aria-labelledby="signin-title">
        <div className="signin-lockup" aria-label="Vibrium and SNSPL">
          <span className="signin-tile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={VIBRIUM_LOGO} alt="Vibrium" width={44} height={44} />
          </span>
          <span className="signin-x" aria-hidden="true">
            ×
          </span>
          <span className="signin-tile signin-tile-wide">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/snspl-logo.png" alt="SNSPL" width={68} height={48} />
          </span>
        </div>

        <header className="signin-head">
          <p className="kicker">Vibrium × SNSPL</p>
          <h1 id="signin-title">Sign in to Trade Suite</h1>
          <p>Sourcing, shipments and finance for SNSPL.</p>
        </header>

        <SignInForm
          next={safeNextPath(Array.isArray(next) ? next[0] : next)}
          configured={authEnv() !== null}
        />

        <footer className="signin-foot">
          <span>Access is limited to authorised SNSPL accounts.</span>
          <nav aria-label="Legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}
