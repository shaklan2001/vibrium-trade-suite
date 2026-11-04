import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { LegalFooter } from "@/components/legal/legal-page";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#ecfdf5_0%,_#fafafa_55%)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-20">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">
            Vibrium Trade
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900">
            Command Center for buying-agency ops
          </h1>
          <p className="mt-4 max-w-2xl text-base text-zinc-600">
            See what needs attention across your book of business — risks,
            today&apos;s todos, priority scores, and next steps — then drill
            into intake, quotes, pipeline, and docs with worker agents.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/home">
              <Button>Enter Command Center</Button>
            </Link>
            <Link href="/intake">
              <Button variant="secondary">New enquiry</Button>
            </Link>
            <Link href="/docs">
              <Button variant="ghost">Process map</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              t: "See the day",
              d: "Pulse across the book — risks, todos, and priority scores with deal codes.",
            },
            {
              t: "Trace every email",
              d: "Requirement and quote sources stay on the deal so ops can always reopen the original thread.",
            },
            {
              t: "Pick the right factory",
              d: "Partner scores on size, output, on-time, shipments, and quality drive recommendations.",
            },
          ].map((x) => (
            <div
              key={x.t}
              className="rounded-xl border border-zinc-200 bg-white/80 p-5"
            >
              <h2 className="text-sm font-semibold">{x.t}</h2>
              <p className="mt-2 text-sm text-zinc-500">{x.d}</p>
            </div>
          ))}
        </div>

        <ol className="space-y-2 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
          <li>
            <strong>1.</strong> Open Command Center → load book of business
          </li>
          <li>
            <strong>2.</strong> Work Today&apos;s todos by deal code
          </li>
          <li>
            <strong>3.</strong> Open a deal → review Day-N timeline & source emails
          </li>
          <li>
            <strong>4.</strong> Use Buyers & factories when choosing outreach targets
          </li>
        </ol>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-900">Connecting your Gmail</h2>
          <p className="mt-2">
            Vibrium Trade can connect to your Gmail or Google Workspace inbox with{" "}
            <strong>read-only</strong> access. It reads trade emails and their attachments —
            enquiries, quotes, purchase orders, invoices and shipping documents — and turns them
            into deals in your book, so nobody has to forward or upload them. It never sends,
            deletes or changes your email, and you can disconnect at any time.
          </p>
          <p className="mt-2">
            See our{" "}
            <Link href="/privacy" className="text-teal-700 underline">
              privacy policy
            </Link>{" "}
            for exactly what we access and how Google user data is handled.
          </p>
        </section>

        <LegalFooter />
      </div>
    </div>
  );
}
