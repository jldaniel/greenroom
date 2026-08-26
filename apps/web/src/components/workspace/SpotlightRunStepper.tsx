import { useState, type FormEvent } from "react";
import { Check, CheckCircle2, LoaderCircle, Sparkles } from "lucide-react";

import type { SpotlightRunResource } from "../../api/client";
import { ConsentCard } from "../ConsentCard";
import { SpotlightIntentBadge, spotlightRunStatusLabel } from "./SpotlightBadges";
import { spotlightRunSteps, type SpotlightStep } from "./spotlightStepper";
import type { SpotlightRunsController } from "./useSpotlightRuns";

/**
 * The Spotlight plan-approval flow rendered as a 3-step stepper:
 * Scope (context consent via the shared ConsentCard), Plan (outline drafting,
 * refinement, and approval), and Views (generation). Renders only while a run
 * is in flight; settled runs fall back to the run note in SpotlightSection.
 */
export function SpotlightRunStepper({ spotlight }: { spotlight: SpotlightRunsController }) {
  const lastRun = spotlight.lastRun;
  const steps =
    lastRun === null
      ? null
      : spotlightRunSteps(lastRun.status, spotlight.workflowRun?.status ?? null);

  if (lastRun === null || steps === null) {
    return null;
  }

  const activeStep = steps.find((step) => step.status === "active");

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <ol aria-label="Spotlight run steps" className="grid grid-cols-3 gap-1">
        {steps.map((step, index) => (
          <SpotlightStepItem key={step.id} index={index} step={step} />
        ))}
      </ol>

      {activeStep?.id === "scope" ? (
        <ConsentCard
          approveLabel="Approve Context"
          compact
          consent={spotlight.workflowRun?.consentSummary ?? null}
          fallback={<SpotlightContextSummary summary={lastRun.contextSummary} />}
          isApproving={spotlight.isApprovingContext}
          onApprove={() => void spotlight.approveContext(lastRun.id)}
        />
      ) : null}

      {activeStep?.id === "plan" ? (
        lastRun.status === "awaiting_plan_approval" ? (
          <SpotlightPlanApproval run={lastRun} spotlight={spotlight} />
        ) : (
          <SpotlightStepProgressNote label="Drafting a View plan for approval" />
        )
      ) : null}

      {activeStep?.id === "views" ? (
        <SpotlightStepProgressNote label={spotlightRunStatusLabel(lastRun)} />
      ) : null}
    </div>
  );
}

function SpotlightStepItem({ index, step }: { index: number; step: SpotlightStep }) {
  const active = step.status === "active";
  const complete = step.status === "complete";

  return (
    <li
      aria-current={active ? "step" : undefined}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium ${
        active
          ? "border-accent bg-accent-soft text-accent-ink"
          : complete
            ? "border-line bg-muted-surface text-ink"
            : "border-line bg-surface text-muted"
      }`}
    >
      <span
        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-xs ${
          active
            ? "border-accent/40 bg-surface text-accent-ink"
            : complete
              ? "border-success/30 bg-success-soft text-success-ink"
              : "border-line bg-muted-surface text-muted"
        }`}
      >
        {complete ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
      </span>
      {step.label}
    </li>
  );
}

function SpotlightStepProgressNote({ label }: { label: string }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-md border border-line bg-muted-surface px-3 py-2 text-xs font-medium text-muted">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      {label}
    </p>
  );
}

function SpotlightPlanApproval({
  run,
  spotlight,
}: {
  run: SpotlightRunResource;
  spotlight: SpotlightRunsController;
}) {
  const [instruction, setInstruction] = useState("");
  const outline = run.pendingOutline ?? [];

  function handleRefine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = instruction.trim();

    if (trimmed.length === 0) {
      return;
    }

    void spotlight.refinePlan(run.id, trimmed);
    setInstruction("");
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {outline.map((item, index) => (
          <div className="rounded-md bg-muted-surface px-3 py-2" key={`${item.title}-${index}`}>
            <div className="flex items-center gap-2">
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-xs font-medium text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 truncate text-sm font-medium text-ink">{item.title}</span>
            </div>
            <div className="mt-1">
              <SpotlightIntentBadge intent={item.intent} />
            </div>
            <p className="mt-1 break-words text-xs text-muted">{item.description}</p>
          </div>
        ))}
      </div>

      <form className="space-y-2" onSubmit={handleRefine}>
        <label className="grid gap-1 text-xs font-medium text-muted">
          <span>Refinement</span>
          <textarea
            className="min-h-20 resize-y rounded-md border border-line bg-surface px-2 py-2 text-sm font-normal text-ink"
            maxLength={4000}
            onChange={(event) => setInstruction(event.target.value)}
            value={instruction}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line text-sm font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
            disabled={spotlight.isRefiningPlan || instruction.trim().length === 0}
            type="submit"
          >
            {spotlight.isRefiningPlan ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" className="size-4" />
            )}
            Refine
          </button>
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-surface disabled:opacity-60"
            disabled={spotlight.isApprovingPlan || outline.length === 0}
            onClick={() => void spotlight.approvePlan(run)}
            type="button"
          >
            {spotlight.isApprovingPlan ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 aria-hidden="true" className="size-4" />
            )}
            Approve
          </button>
        </div>
      </form>
    </div>
  );
}

function SpotlightContextSummary({ summary }: { summary: SpotlightRunResource["contextSummary"] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted">
      <dt>Review</dt>
      <dd className="truncate text-ink">{summary.review.displayId}</dd>
      <dt>Revision</dt>
      <dd className="truncate font-mono text-ink">{summary.revision.id}</dd>
      <dt>Files</dt>
      <dd className="text-ink">{summary.fileCount}</dd>
      <dt>Hunks</dt>
      <dd className="text-ink">{summary.hunkCount}</dd>
      <dt>Changed</dt>
      <dd className="text-ink">{summary.changedLineCount} lines</dd>
      <dt>Approx.</dt>
      <dd className="text-ink">{summary.approximateTokenCount.toLocaleString()} tokens</dd>
      <dt>Profile</dt>
      <dd className="truncate text-ink">{summary.profile.name}</dd>
      <dt>Provider</dt>
      <dd className="truncate text-ink">
        {summary.profile.provider} / {summary.profile.model}
      </dd>
    </dl>
  );
}
