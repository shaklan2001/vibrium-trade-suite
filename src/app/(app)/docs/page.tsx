import { readFile } from "fs/promises";
import path from "path";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardHeader } from "@/components/ui/primitives";

const DOC_LINKS = [
  { href: "/docs#index", label: "Docs index (rendered below)" },
  {
    file: "CONTINUATION_GUIDE.md",
    label: "Continuation guide",
  },
  { file: "RUNBOOK.md", label: "Runbook" },
  { file: "architecture/ARCHITECTURE.md", label: "Architecture" },
  { file: "phases/PHASE_A.md", label: "Phase A" },
  { file: "phases/PHASES_B_TO_G.md", label: "Phases B–G" },
  { file: "agents/AGENT_ROSTER.md", label: "Agent roster" },
  { file: "samples/README.md", label: "Sample artefacts" },
];

async function readDoc(rel: string) {
  try {
    return await readFile(path.join(process.cwd(), "docs", rel), "utf8");
  } catch {
    return `Missing: docs/${rel}`;
  }
}

export default async function DocsPage() {
  const index = await readDoc("README.md");
  const continuation = await readDoc("CONTINUATION_GUIDE.md");
  const processMap = await readDoc("Sourcing-Buying-Agency-Process-Map.md");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentation"
        description="Full knowledge base lives in the repo docs/ folder. Continue Phase B+ from CONTINUATION_GUIDE.md — not from export_automation."
      />

      <Card>
        <CardHeader title="Quick links (repo paths)" />
        <ul className="grid gap-2 p-4 text-sm sm:grid-cols-2">
          {DOC_LINKS.map((l) => (
            <li key={l.label} className="text-teal-800">
              {l.file ? (
                <code className="text-xs">docs/{l.file}</code>
              ) : (
                <Link href={l.href}>{l.label}</Link>
              )}{" "}
              — {l.label}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6" id="index">
        <h2 className="mb-3 text-sm font-semibold">docs/README.md</h2>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-700">
          {index}
        </pre>
      </Card>

      <Card className="p-6">
        <h2 className="mb-3 text-sm font-semibold">CONTINUATION_GUIDE.md</h2>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-700">
          {continuation}
        </pre>
      </Card>

      <Card className="p-6">
        <h2 className="mb-3 text-sm font-semibold">
          Sourcing-Buying-Agency-Process-Map.md
        </h2>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-700">
          {processMap}
        </pre>
      </Card>
    </div>
  );
}
