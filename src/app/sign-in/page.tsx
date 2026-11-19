import type { Metadata } from "next";
import { authEnv, safeNextPath } from "@/lib/auth/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in — Vibrium Trade" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="marketing">
      <div className="marketing-inner mx-auto flex max-w-sm flex-col gap-6">
        <div>
          <p className="kicker">Vibrium Trade</p>
          <h1 className="text-2xl">Sign in</h1>
        </div>
        <SignInForm
          next={safeNextPath(Array.isArray(next) ? next[0] : next)}
          configured={authEnv() !== null}
        />
      </div>
    </div>
  );
}
