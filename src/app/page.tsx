import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#ecfdf5_0%,_#fafafa_55%)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-20">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">
            Vibrium Trade
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900">
            Sourcing automation for buying agencies
          </h1>
          <p className="mt-4 max-w-2xl text-base text-zinc-600">
            Phase A ships requirement intake, factory outreach, quote
            normalization, and buyer selection — using existing Vibrium worker
            agents and conversational agents. No new domain APIs.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/deals">
              <Button>Enter suite</Button>
            </Link>
            <Link href="/intake">
              <Button variant="secondary">Start intake</Button>
            </Link>
            <Link href="/docs">
              <Button variant="ghost">Process map</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              t: "Worker agents",
              d: "Extract requirements and normalize AS/quote sheets into a SKU matrix.",
            },
            {
              t: "Conversational agents",
              d: "WhatsApp / email / voice outreach for factories and buyer selection chase.",
            },
            {
              t: "Sequential phases",
              d: "A → G mirrors the buying-agency PPT: artwork through commission close.",
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
            <strong>1.</strong> Paste buyer enquiry → requirement extractor
          </li>
          <li>
            <strong>2.</strong> Enroll factory outreach workflow
          </li>
          <li>
            <strong>3.</strong> Upload AS LEATHER TOYS sheet → quote matrix
          </li>
          <li>
            <strong>4.</strong> Select SKUs → lock selection / chase buyer
          </li>
        </ol>
      </div>
    </div>
  );
}
