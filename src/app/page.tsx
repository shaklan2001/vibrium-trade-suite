import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { LegalFooter } from "@/components/legal/legal-page";

export default function HomePage() {
  return (
    <div className="marketing">
      <div className="marketing-inner flex flex-col gap-10">
        <div>
          <p className="kicker">Vibrium Trade</p>
          <h1>
            Command Center for <span className="gradient-text">buying-agency ops</span>
          </h1>
          <p className="lede">
            See what needs attention across your book of business — risks,
            today&apos;s todos, priority scores, and next steps — then drill
            into intake, quotes, pipeline, and docs with worker agents.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
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
              className="card p-5"
            >
              <h2 className="text-sm font-semibold">{x.t}</h2>
              <p className="mt-2 text-sm text-zinc-500">{x.d}</p>
            </div>
          ))}
        </div>

        <ol className="card space-y-2 p-5 text-sm text-zinc-700">
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

        <section className="card p-5 text-sm text-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-900">Connecting your mailbox</h2>
          <p className="mt-2">
            Each team member connects their mailbox with its email and password (IMAP to read,
            SMTP to send). Vibrium Trade reads trade emails and attachments — enquiries, quotes,
            purchase orders, invoices and shipping documents — turns them into deals, and drafts
            replies that are only sent when someone clicks Send.
          </p>
          <p className="mt-2">
            See our{" "}
            <Link href="/privacy" className="text-teal-700 underline">
              privacy policy
            </Link>{" "}
            for exactly what we store and how to remove it.
          </p>
        </section>

        <LegalFooter />
      </div>
    </div>
  );
}
