import { ALL_STAGES, STAGE_LABELS, type DealStage } from "@/types/trade";
import { stageStep } from "@/lib/trade/dealDisplay";

/** Stage name plus a 12-segment track showing how far along the deal is. */
export function StageProgress({
  stage,
  size = "sm",
}: {
  stage: DealStage;
  size?: "sm" | "lg";
}) {
  const { step, total } = stageStep(stage);
  const closed = stage === "closed";
  return (
    <div className={`stage-progress stage-progress-${size}`}>
      <div className="stage-progress-label">
        <span className="stage-progress-name">{STAGE_LABELS[stage]}</span>
        <span className="stage-progress-step">
          {closed ? "Done" : `Step ${step} of ${total}`}
        </span>
      </div>
      <div
        className="stage-progress-track"
        role="img"
        aria-label={`${STAGE_LABELS[stage]}, step ${step} of ${total}`}
      >
        {ALL_STAGES.map((s, i) => (
          <span
            key={s}
            title={size === "lg" ? STAGE_LABELS[s] : undefined}
            className={`stage-seg ${i + 1 < step || closed ? "is-done" : i + 1 === step ? "is-current" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Agency / Trader marker, same wording everywhere. */
export function ModelTag({ model }: { model: "agency_commission" | "trader_principal" }) {
  return model === "trader_principal" ? (
    <span className="model-tag model-trader">Trader</span>
  ) : (
    <span className="model-tag model-agency">Agency</span>
  );
}
