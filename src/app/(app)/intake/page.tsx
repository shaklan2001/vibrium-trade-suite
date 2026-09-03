"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import {
  extractRequirementLocal,
  PETRAGEOUS_FIXTURE_EMAIL,
  requirementFromWorkerOutput,
} from "@/lib/trade/parsers";
import { runWorkerAndWait } from "@/services/agentsApi";
import { getPresignedUpload } from "@/services/channelsApi";

export default function IntakePage() {
  const router = useRouter();
  const createDeal = useTradeStore((s) => s.createDeal);
  const setRequirement = useTradeStore((s) => s.setRequirement);
  const addDocument = useTradeStore((s) => s.addDocument);
  const addTimeline = useTradeStore((s) => s.addTimeline);
  const routing = useTradeStore((s) => s.routing);

  const [emailText, setEmailText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<ReturnType<
    typeof extractRequirementLocal
  > | null>(null);

  async function runExtract(forceLocal = false) {
    if (!emailText.trim()) {
      toast.error("Paste a buyer enquiry first");
      return;
    }
    setBusy(true);
    setStatus("Extracting…");
    try {
      let fields = extractRequirementLocal(emailText);
      let executionId: string | undefined;

      if (!forceLocal && routing.requirement_extractor) {
        setStatus("Running worker agent…");
        const ex = await runWorkerAndWait(
          routing.requirement_extractor,
          { email_text: emailText },
          (e) => setStatus(`Worker status: ${e.status}`),
        );
        if (ex.status !== "completed") {
          throw new Error(ex.error || `Worker ${ex.status}`);
        }
        fields = requirementFromWorkerOutput(ex.output);
        executionId = ex.execution_id;
      } else if (!forceLocal && !routing.requirement_extractor) {
        toast.message("No worker ID configured — using local extractor");
      }

      setPreview(fields);
      setStatus(executionId ? `Done · ${executionId}` : "Done · local");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Extract failed");
      setStatus("Failed — try local fallback");
    } finally {
      setBusy(false);
    }
  }

  function confirmDeal() {
    if (!preview) return;
    const deal = createDeal({
      title: preview.productCategory || "Buyer enquiry",
      parties: [
        {
          role: "buyer",
          name: preview.buyerContacts?.[0] || "Buyer",
          email: preview.buyerContacts?.[0],
        },
        { role: "agency", name: "SNSPL", company: "Savvy Net Sourcing" },
      ],
    });
    setRequirement(deal.id, preview);
    addTimeline(deal.id, {
      channel: "email",
      title: "Buyer enquiry received",
      detail: preview.summary,
    });
    toast.success("Deal created");
    router.push(`/deals/${deal.id}`);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text().catch(() => "");
      if (text && text.length < 200_000) setEmailText(text);

      try {
        const signed = await getPresignedUpload({
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          folder: "trade/rfq",
        });
        const uploadUrl = signed.upload_url || signed.url;
        if (uploadUrl) {
          await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          });
        }
        const deal = createDeal({ title: file.name });
        addDocument(deal.id, {
          name: file.name,
          type: "rfq",
          s3Key: signed.s3_key || signed.key,
          url: signed.public_url,
        });
        toast.success("Uploaded to vault (deal created)");
        router.push(`/deals/${deal.id}`);
      } catch {
        toast.message("File loaded locally (presign unavailable)");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Requirement Intake"
        description="Paste a buyer email or upload an enquiry. Runs the requirement_extractor worker when configured."
        actions={
          <Button
            variant="secondary"
            onClick={() => setEmailText(PETRAGEOUS_FIXTURE_EMAIL)}
          >
            Load Petrageous fixture
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Buyer enquiry" />
          <div className="space-y-3 p-4">
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
              <Label>Or upload file</Label>
              <input
                type="file"
                className="block w-full text-sm"
                onChange={(e) => void onFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void runExtract(false)}>
                Extract with worker
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void runExtract(true)}
              >
                Local extract
              </Button>
            </div>
            {status ? (
              <p className="text-xs text-zinc-500">{status}</p>
            ) : null}
          </div>
        </Card>

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
              <p className="text-zinc-500">Run extract to preview fields.</p>
            ) : (
              <>
                <Field label="Category" value={preview.productCategory} />
                <Field label="Materials" value={preview.materials} />
                <Field
                  label="Target factory cost"
                  value={
                    preview.targetFactoryCost != null
                      ? `$${preview.targetFactoryCost}`
                      : undefined
                  }
                />
                <Field
                  label="Retail"
                  value={
                    preview.targetRetailPrice != null
                      ? `$${preview.targetRetailPrice}`
                      : undefined
                  }
                />
                <Field label="Destination" value={preview.destination} />
                <Field label="Urgency" value={preview.urgency} />
                <Field
                  label="Contacts"
                  value={preview.buyerContacts?.join(", ")}
                />
                <Field label="Summary" value={preview.summary} />
                <Button onClick={confirmDeal}>Create deal & continue</Button>
              </>
            )}
          </div>
        </Card>
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
