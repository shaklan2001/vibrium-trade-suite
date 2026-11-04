import Link from "next/link";
import { APP_NAME, COMPANY_NAME, LEGAL_LAST_UPDATED } from "@/lib/legal";

/** Public, unauthenticated page shell for /privacy and /terms. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <Link href="/" className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">
          {APP_NAME}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {LEGAL_LAST_UPDATED}</p>
        <article className="mt-8 space-y-6 text-[15px] leading-relaxed text-zinc-700 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-900 [&_li]:ml-5 [&_li]:list-disc [&_a]:text-teal-700 [&_a]:underline">
          {children}
        </article>
        <LegalFooter />
      </div>
    </div>
  );
}

export function LegalFooter() {
  return (
    <footer className="mt-16 flex flex-wrap gap-x-6 gap-y-2 border-t border-zinc-200 pt-6 text-sm text-zinc-500">
      <span>
        © {new Date().getFullYear()} {COMPANY_NAME}
      </span>
      <Link href="/privacy" className="hover:text-zinc-900">
        Privacy policy
      </Link>
      <Link href="/terms" className="hover:text-zinc-900">
        Terms of service
      </Link>
    </footer>
  );
}
