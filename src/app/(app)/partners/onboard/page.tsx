"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { SupplierOnboardingForm } from "@/components/ops/supplier-onboarding-form";

function OnboardInner() {
  const params = useSearchParams();
  const id = params.get("id") || undefined;
  const mode = params.get("mode") === "supplier" ? "supplier" : "ops";

  return (
    <div>
      <PageHeader
        title="Supplier HUB onboarding"
        description="Registration & export readiness — on submit the factory enters the directory and is eligible for deal recommendations."
      />
      <SupplierOnboardingForm
        applicationId={id}
        defaultFilledBy={mode}
      />
    </div>
  );
}

export default function SupplierOnboardPage() {
  return (
    <Suspense
      fallback={
        <p className="px-1 py-6 text-sm text-zinc-500">Loading form…</p>
      }
    >
      <OnboardInner />
    </Suspense>
  );
}
