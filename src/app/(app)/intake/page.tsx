"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { EmailThreadsPanel } from "@/components/shared/email-threads-panel";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Label,
  Textarea,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import { PETRAGEOUS_FIXTURE_EMAIL } from "@/lib/trade/fixtures";
import { requirementFromWorkerOutput } from "@/lib/trade/parsers";
import { parseEmailMeta } from "@/lib/trade/partyProfiles";
import type { RequirementFields } from "@/types/trade";
import { getExecutionResult, runWorkerAndWait } from "@/services/agentsApi";
import { getPresignedUpload } from "@/services/channelsApi";
import { FactoryRecommendations } from "@/components/ops/factory-recommendations";

export default function IntakePage() {
  const router = useRouter();
  const createDeal = useTradeStore((s) => s.createDeal);
  const setRequirement = useTradeStore((s) => s.setRequirement);
  const addDocument = useTradeStore((s) => s.addDocument);
  const addSource = useTradeStore((s) => s.addSource);
  const addTimeline = useTradeStore((s) => s.addTimeline);
  const routing = useTradeStore((s) => s.routing);

  const [emailText, setEmailText] = useState("");
  const [documentUrl, setDocumentUrl] = useState<string | undefined>();
  const [pendingFile, setPendingFile] = useState<{
    name: string;
    s3Key?: string;
    url?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<RequirementFields | null>(null);
  const [executionId, setExecutionId] = useState<string | undefined>();

  async function runExtract() {
    if (!emailText.trim()) {
      toast.error("Paste a buyer enquiry first");
      return;
    }
    if (!routing.requirement_extractor) {
      toast.error(
        "Configure requirement_extractor in Agent Routing before extracting",
      );
      return;
    }

    setBusy(true);
    setStatus("Running requirement_extractor…");
    setPreview(null);
    try {
      const input: Record<string, unknown> = { email_text: emailText };
      if (documentUrl) input.document_url = documentUrl;

      const ex = await runWorkerAndWait(
        routing.requirement_extractor,
        input,
        (e) => setStatus(`Worker status: ${e.status}`),
      );
      if (ex.status !== "completed") {
        throw new Error(ex.error || `Worker ${ex.status}`);
      }

      const fields = requirementFromWorkerOutput(getExecutionResult(ex));
      setPreview(fields);
      setExecutionId(ex.execution_id);
      setStatus(`Done · ${ex.execution_id}`);
      toast.success("Requirement extracted by agent");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Extract failed");
      setStatus("Failed");
    } finally {
      setBusy(false);
    }
  }

  function confirmDeal() {
    if (!preview) return;
    const meta = parseEmailMeta(emailText);
    const deal = createDeal({
      title:
        preview.productCategory ||
        preview.subject ||
        preview.buyerCompany ||
        "Buyer enquiry",
      parties: [
        {
          role: "buyer",
          name:
            preview.buyerCompany ||
            preview.buyerContacts?.[0] ||
            "Buyer",
          email: preview.buyerContacts?.find((c) => c.includes("@")),
          company: preview.buyerCompany,
        },
        { role: "agency", name: "SNSPL", company: "Savvy Net Sourcing" },
      ],
      sources: [
        {
          id: `src-req-${Date.now()}`,
          kind: "requirement",
          body: emailText,
          subject: meta.subject || preview.subject,
          from: meta.from,
          to: meta.to,
          receivedAt: new Date().toISOString(),
          label: "Buyer enquiry",
          extractedBy: "requirement_extractor",
          extractedSummary: preview.summary,
          attachments: pendingFile
            ? [
                {
                  name: pendingFile.name,
                  url: pendingFile.url,
                  extractedBy: "requirement_extractor",
                  extractedSummary: preview.summary,
                },
              ]
            : [],
        },
      ],
    });
    setRequirement(deal.id, preview, executionId);
    if (pendingFile) {
      addDocument(deal.id, {
        name: pendingFile.name,
        type: "rfq",
        s3Key: pendingFile.s3Key,
        url: pendingFile.url,
      });
    }
    // Ensure source survives if create already set it
    if (!(deal.sources || []).some((s) => s.kind === "requirement")) {
      addSource(deal.id, {
        kind: "requirement",
        body: emailText,
        subject: meta.subject || preview.subject,
        from: meta.from,
        to: meta.to,
        label: "Buyer enquiry",
      });
    }
    addTimeline(deal.id, {
      channel: "email",
      title: "Buyer enquiry extracted",
      detail: preview.summary,
      meta: { executionId, confidence: preview.confidence },
    });
    toast.success(`Deal ${deal.code} created`);
    router.push(`/deals/${deal.id}`);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text().catch(() => "");
      if (text && text.length < 200_000 && !file.name.match(/\.xlsx?$/i)) {
        setEmailText(text);
      }

      const signed = await getPresignedUpload({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        folder: "trade/rfq",
      });
      const uploadUrl = signed.upload_url || signed.url;
      if (!uploadUrl) throw new Error("Presign returned no upload URL");

      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      const publicUrl = signed.public_url || undefined;
      setDocumentUrl(publicUrl);
      setPendingFile({
        name: file.name,
        s3Key: signed.s3_key || signed.key,
        url: publicUrl,
      });
      toast.success(
        publicUrl
          ? "Uploaded — document_url will be sent to the agent"
          : "Uploaded — paste email text; agent needs a public document URL when available",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Requirement Intake"
        description="Paste the buyer enquiry. The original email is stored on the deal for full traceability."
        actions={
          <Button
            variant="secondary"
            onClick={() => setEmailText(PETRAGEOUS_FIXTURE_EMAIL)}
          >
            Load Petrageous enquiry
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Buyer enquiry" />
          <div className="space-y-3 p-4">
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50/80 px-3 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Mail className="h-4 w-4 text-zinc-500" aria-hidden />
                <span className="text-sm font-medium text-zinc-800">
                  Team mailboxes
                </span>
              </div>
              <p className="mb-3 text-xs text-zinc-500">
                Connected mailboxes bring buyer enquiries into the shared Inbox and the
                deal book automatically. Or paste an email below.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/mailbox/connections"
                  className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  Email connections
                </Link>
                <Link
                  href="/mailbox/inbox"
                  className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
                >
                  Open shared inbox →
                </Link>
              </div>
            </div>
            <div>
              <Label>Email / message text</Label>
              <Textarea
                rows={16}
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Paste buyer email…"
              />
            </div>
            <div>
              <Label>Optional attachment</Label>
              <input
                type="file"
                className="block w-full text-sm"
                onChange={(e) => void onFile(e.target.files?.[0] || null)}
              />
              {documentUrl ? (
                <p className="mt-1 truncate text-[11px] text-zinc-500">
                  Attachment uploaded
                </p>
              ) : null}
            </div>
            <Button disabled={busy} onClick={() => void runExtract()}>
              Extract requirement
            </Button>
            {status ? (
              <p className="text-xs text-zinc-500">{status}</p>
            ) : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Extracted fields"
              description="Confirm before creating the deal"
              action={
                preview?.confidence != null ? (
                  <Badge tone="info">
                    {Math.round(preview.confidence * 100)}% conf
                  </Badge>
                ) : null
              }
            />
            <div className="space-y-3 p-4 text-sm">
              {!preview ? (
                <p className="text-zinc-500">
                  Extract the enquiry to preview commercial fields.
                </p>
              ) : (
                <>
                  <Field label="Category" value={preview.productCategory} />
                  <Field label="Materials" value={preview.materials} />
                  <Field label="Buyer company" value={preview.buyerCompany} />
                  <Field
                    label="Target factory cost"
                    value={
                      preview.targetFactoryCost != null
                        ? `${preview.currency || "USD"} ${preview.targetFactoryCost}`
                        : undefined
                    }
                  />
                  <Field
                    label="Retail"
                    value={
                      preview.targetRetailPrice != null
                        ? `${preview.currency || "USD"} ${preview.targetRetailPrice}`
                        : undefined
                    }
                  />
                  <Field label="Destination" value={preview.destination} />
                  <Field label="Urgency" value={preview.urgency} />
                  <Field
                    label="Contacts"
                    value={preview.buyerContacts?.join(", ")}
                  />
                  <Field
                    label="Current sourcing"
                    value={preview.currentSourcingNotes}
                  />
                  <Field
                    label="Open questions"
                    value={preview.openQuestions?.join(" · ")}
                  />
                  <Field
                    label="Next actions"
                    value={preview.nextActions?.join(" · ")}
                  />
                  <Field label="Summary" value={preview.summary} />
                  <Button onClick={confirmDeal}>Create deal & continue</Button>
                </>
              )}
            </div>
          </Card>
          {preview ? <FactoryRecommendations requirement={preview} /> : null}
        </div>
      </div>

      <div className="mt-4">
        <EmailThreadsPanel />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}
