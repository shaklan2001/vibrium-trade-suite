"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardHeader,
} from "@/components/ui/primitives";
import { useTradeStore } from "@/lib/trade/store";
import type { SupplierHubApplication } from "@/types/trade";
import {
  ONBOARDING_STEPS,
  createEmptySupplierApplication,
  suggestReadinessAssessment,
  type OnboardingStepId,
} from "@/lib/trade/supplierOnboarding";
import {
  firstErrorMessage,
  validateOnboardingStep,
  type FieldErrors,
} from "@/lib/trade/supplierFormGuide";
import {
  AssessmentStep,
  BuyerSupportStep,
  CapacityStep,
  CommercialStep,
  CompanyStep,
  ExportDocsStep,
  InfrastructureStep,
  MarketStep,
  MetaStep,
  PackagingStep,
  ProductsStep,
  QualityStep,
  WorkforceStep,
} from "@/components/ops/supplier-onboarding-steps";
import { cn } from "@/lib/utils";

export function SupplierOnboardingForm({
  applicationId,
  defaultFilledBy = "ops",
}: {
  applicationId?: string;
  defaultFilledBy?: "ops" | "supplier";
}) {
  const router = useRouter();
  const save = useTradeStore((s) => s.saveSupplierApplication);
  const submit = useTradeStore((s) => s.submitSupplierApplication);
  const getApp = useTradeStore((s) => s.getSupplierApplication);

  const [stepIdx, setStepIdx] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [app, setApp] = useState<SupplierHubApplication>(() => {
    if (applicationId) {
      const existing = getApp(applicationId);
      if (existing) return existing;
    }
    return createEmptySupplierApplication(defaultFilledBy);
  });

  useEffect(() => {
    const hydrate = () => {
      if (applicationId) {
        const existing = getApp(applicationId);
        if (existing) setApp(existing);
        return;
      }
      save(app);
    };
    const api = useTradeStore.persist;
    if (api?.hasHydrated?.()) {
      hydrate();
      return;
    }
    return api?.onFinishHydration?.(hydrate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per id
  }, [applicationId]);

  const step = ONBOARDING_STEPS[stepIdx]!;
  const isLast = stepIdx === ONBOARDING_STEPS.length - 1;

  function clearError(key: string) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function patch(mutator: (draft: SupplierHubApplication) => void) {
    setApp((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }

  function persistDraft() {
    save(app);
    toast.success("Draft saved");
  }

  function validateCurrent(stepId: OnboardingStepId = step.id): FieldErrors {
    const nextErrors = validateOnboardingStep(stepId, app);
    setErrors(nextErrors);
    return nextErrors;
  }

  function goNext() {
    const stepErrors = validateCurrent();
    if (Object.keys(stepErrors).length) {
      toast.error(
        firstErrorMessage(stepErrors) || "Please fix the highlighted fields",
      );
      return;
    }
    save(app);
    if (!isLast) {
      const nextIdx = Math.min(stepIdx + 1, ONBOARDING_STEPS.length - 1);
      const nextStep = ONBOARDING_STEPS[nextIdx]!;
      if (
        nextStep.id === "assessment" &&
        !app.assessment.dimensions.some((d) => d.score > 0)
      ) {
        const suggested = suggestReadinessAssessment(app);
        const withAssess = { ...app, assessment: suggested };
        setApp(withAssess);
        save(withAssess);
      }
      setErrors({});
      setStepIdx(nextIdx);
    }
  }

  function goBack() {
    setErrors({});
    setStepIdx((i) => Math.max(0, i - 1));
  }

  function jumpToStep(i: number) {
    if (i > stepIdx) {
      const stepErrors = validateCurrent();
      if (Object.keys(stepErrors).length) {
        toast.error(
          firstErrorMessage(stepErrors) || "Please fix the highlighted fields",
        );
        return;
      }
      save(app);
    }
    setErrors({});
    setStepIdx(i);
  }

  function refreshAssessment() {
    patch((d) => {
      d.assessment = suggestReadinessAssessment(d);
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next.classification;
      delete next.declaration;
      delete next.authorisedName;
      return next;
    });
    toast.message("Scores auto-suggested from answers — edit freely");
  }

  function handleSubmit() {
    let toSubmit = app;
    if (
      toSubmit.assessment.autoSuggested !== false &&
      !toSubmit.assessment.dimensions.some((d) => d.score > 0)
    ) {
      toSubmit = {
        ...toSubmit,
        assessment: suggestReadinessAssessment(toSubmit),
      };
      setApp(toSubmit);
    }
    const stepErrors = validateOnboardingStep("assessment", toSubmit);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length) {
      toast.error(
        firstErrorMessage(stepErrors) || "Please fix the highlighted fields",
      );
      return;
    }
    save(toSubmit);
    const result = submit(toSubmit.id);
    if (!result.ok) {
      toast.error(`Missing: ${result.errors.join(", ")}`);
      return;
    }
    toast.success(
      `${result.profile.company} added to factory directory · score ${result.profile.scores.overall}`,
    );
    router.push("/partners");
  }

  const readinessPreview = useMemo(() => {
    if (step.id !== "assessment") return null;
    return app.assessment.totalScore;
  }, [app.assessment.totalScore, step.id]);

  const stepProps = { app, patch, errors, clearError };
  const errorCount = Object.keys(errors).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ONBOARDING_STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jumpToStep(i)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px]",
              i === stepIdx
                ? "bg-teal-800 text-white"
                : i < stepIdx
                  ? "bg-teal-50 text-teal-800"
                  : "bg-zinc-100 text-zinc-500",
            )}
          >
            {i + 1}. {s.short}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={step.title}
          description="Example placeholders show the expected format. Hover ? icons for guidance. Continue validates the current step."
          action={
            app.status === "submitted" ? (
              <Badge tone="success">Submitted</Badge>
            ) : (
              <Badge>Draft</Badge>
            )
          }
        />

        <div className="space-y-4 px-4 py-4">
          {errorCount > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorCount} field{errorCount === 1 ? "" : "s"} need
              {errorCount === 1 ? "s" : ""} attention on this step before you can
              continue.
            </div>
          ) : null}

          {step.id === "meta" ? <MetaStep {...stepProps} /> : null}
          {step.id === "company" ? <CompanyStep {...stepProps} /> : null}
          {step.id === "infrastructure" ? (
            <InfrastructureStep {...stepProps} />
          ) : null}
          {step.id === "capacity" ? <CapacityStep {...stepProps} /> : null}
          {step.id === "workforce" ? <WorkforceStep {...stepProps} /> : null}
          {step.id === "products" ? <ProductsStep {...stepProps} /> : null}
          {step.id === "packaging" ? <PackagingStep {...stepProps} /> : null}
          {step.id === "quality" ? <QualityStep {...stepProps} /> : null}
          {step.id === "market" ? <MarketStep {...stepProps} /> : null}
          {step.id === "exportDocs" ? <ExportDocsStep {...stepProps} /> : null}
          {step.id === "buyerSupport" ? (
            <BuyerSupportStep {...stepProps} />
          ) : null}
          {step.id === "commercial" ? <CommercialStep {...stepProps} /> : null}
          {step.id === "assessment" ? (
            <AssessmentStep {...stepProps} onRefresh={refreshAssessment} />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-3">
          <div className="text-xs text-zinc-500">
            {readinessPreview != null
              ? `Readiness ${readinessPreview}/100`
              : `Step ${stepIdx + 1} of ${ONBOARDING_STEPS.length}`}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={persistDraft}>
              Save draft
            </Button>
            <Button
              variant="secondary"
              disabled={stepIdx === 0}
              onClick={goBack}
            >
              Back
            </Button>
            {!isLast ? (
              <Button onClick={goNext}>Continue</Button>
            ) : (
              <Button onClick={handleSubmit}>
                {app.status === "submitted"
                  ? "Update directory profile"
                  : "Submit & add to directory"}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export type _StepId = OnboardingStepId;
