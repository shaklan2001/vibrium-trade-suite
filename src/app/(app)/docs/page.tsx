import { readFile } from "fs/promises";
import path from "path";
import { PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/primitives";

export default async function DocsPage() {
  const file = path.join(
    process.cwd(),
    "docs/Sourcing-Buying-Agency-Process-Map.md",
  );
  let md = "Process map not found.";
  try {
    md = await readFile(file, "utf8");
  } catch {
    /* ignore */
  }

  return (
    <div>
      <PageHeader
        title="Buying-agency process map"
        description="Ground truth for sequential phases. Phase A is live; B–G follow the same worker + conversational pattern."
      />
      <Card className="p-6">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-700">
          {md}
        </pre>
      </Card>
    </div>
  );
}
