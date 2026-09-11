"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { SupplierOnboardingForm } from "@/components/ops/supplier-onboarding-form";

/**
 * Self-serve entry for manufacturers (same wizard as /partners/onboard).
 * Ops can also share this URL with a supplier.
 */
function HubInner() {
  const params = useSearchParams();
  const id = params.get("id") || undefined;

  return (
    <div>
      <PageHeader
        title="Savvy Net Supplier HUB"
        description="Manufacturer registration & export readiness assessment. Prior export experience is not required."
      />
      <SupplierOnboardingForm applicationId={id} defaultFilledBy="supplier" />
    </div>
  );
}

export default function SupplierHubPage() {
  return (
    <Suspense
      fallback={
        <p className="px-1 py-6 text-sm text-zinc-500">Loading form…</p>
      }
    >
      <HubInner />
    </Suspense>
  );
}
