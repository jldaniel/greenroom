import {
  CheckCircle2,
  CircleDot,
  Eye,
  FileCode2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import type { SpotlightViewRef } from "@greenroom/schemas";

import type { SpotlightRunResource, SpotlightViewResource } from "../../api/client";
import { AiReadinessNote } from "../AiReadinessNote";
import { CopyRefButton } from "../CopyRefButton";
import type { AiRunReadiness } from "../aiReadinessUtils";
import { EmptyState } from "../Feedback";
import { RunStatus } from "../RunStatus";
import { WorkflowValidationIssueList } from "../WorkflowPanels";
import {
  SpotlightHealthBadge,
  SpotlightIntentBadge,
  spotlightRunStatusLabel,
} from "./SpotlightBadges";
import { SpotlightRunStepper } from "./SpotlightRunStepper";
import type { SpotlightRunsController } from "./useSpotlightRuns";
import type { SpotlightRunKind, SpotlightSelection } from "./workspaceTypes";

/**
 * Spotlight drawer section: run operations, the shared run status, the
 * 3-step plan-approval stepper (Scope → Plan → Views), and the
 * View/Coverage list whose selection filters the center diff in place. Run
 * CTAs dispatch through the page (onStartRun) so consent modes share the one
 * RunConsentDialog.
 */
export function SpotlightSection({
  canRefineSelectedView,
  coverageAnchorCount,
  coverageFileCount,
  isCheckingReadiness,
  isCoverageLoading,
  isLoadingViews,
  onSelectCoverage,
  onSelectView,
  onStartRun,
  profileLoading,
  profileReady,
  readiness,
  selection,
  spotlight,
  views,
}: {
  canRefineSelectedView: boolean;
  coverageAnchorCount: number;
  coverageFileCount: number;
  isCheckingReadiness: boolean;
  isCoverageLoading: boolean;
  isLoadingViews: boolean;
  onSelectCoverage: () => void;
  onSelectView: (viewRef: SpotlightViewRef) => void;
  onStartRun: (type: SpotlightRunKind) => void;
  profileLoading: boolean;
  profileReady: boolean;
  readiness: AiRunReadiness;
  selection: SpotlightSelection | null;
  spotlight: SpotlightRunsController;
  views: SpotlightViewResource[];
}) {
  const lastRun = spotlight.lastRun;
  const runInProgress =
    lastRun !== null && lastRun.status !== "completed" && lastRun.status !== "failed";
  // Point-of-use readiness: a blocked backing runtime disables the
  // run CTAs up front instead of letting them fail after click.
  const operationsDisabled =
    spotlight.isCreatingRun ||
    runInProgress ||
    profileLoading ||
    !profileReady ||
    readiness.blocked;

  return (
    <section className="w-full min-w-0 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Search aria-hidden="true" className="size-4 text-accent-ink" />
            Spotlight
          </div>
          <p className="mt-1 text-xs text-muted">
            {isLoadingViews
              ? "Loading views"
              : `${views.length} ${views.length === 1 ? "view" : "views"}`}
          </p>
        </div>
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-surface disabled:opacity-60"
          disabled={operationsDisabled}
          onClick={() => onStartRun("generate")}
          type="button"
        >
          {spotlight.isCreatingRun ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden="true" className="size-4" />
          )}
          Generate
        </button>
      </div>

      <AiReadinessNote className="mt-3" isChecking={isCheckingReadiness} readiness={readiness} />

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line px-2 text-xs font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
          disabled={operationsDisabled || views.length === 0}
          onClick={() => onStartRun("update")}
          title="Update Views"
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          Update
        </button>
        <button
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line px-2 text-xs font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
          disabled={operationsDisabled}
          onClick={() => onStartRun("regenerate")}
          title="Regenerate fresh"
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Reset
        </button>
        <button
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line px-2 text-xs font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
          disabled={operationsDisabled || !canRefineSelectedView}
          onClick={() => onStartRun("refine_view")}
          title="Refine selected View"
          type="button"
        >
          <Sparkles aria-hidden="true" className="size-3.5" />
          Refine
        </button>
      </div>

      <div className="mt-3">
        <SpotlightRunNote isGenerating={spotlight.isCreatingRun} lastRun={lastRun} />
        <SpotlightRunStepper spotlight={spotlight} />
        {spotlight.workflowRun === null ? null : (
          <div className="mt-3 space-y-3">
            <RunStatus
              cancel={{
                isPending: spotlight.isCancelling,
                onAction: () => void spotlight.cancelRun(),
              }}
              emptyEventsLabel="No Spotlight workflow events yet."
              events={spotlight.workflowEvents}
              isLoadingEvents={spotlight.isLoadingEvents}
              queuePosition={spotlight.queuePosition}
              retry={{ isPending: spotlight.isRetrying, onAction: () => void spotlight.retryRun() }}
              run={spotlight.workflowRun}
            />
            <WorkflowValidationIssueList
              issues={
                spotlight.workflowRun.status === "completed"
                  ? []
                  : spotlight.workflowRun.validationIssues
              }
            />
          </div>
        )}
        {profileLoading ? (
          <p className="mt-2 rounded-md border border-line bg-muted-surface px-3 py-2 text-xs text-muted">
            Loading Spotlight profile.
          </p>
        ) : !profileReady ? (
          <p className="mt-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
            No Spotlight profile is available.
          </p>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        <button
          aria-current={selection?.kind === "coverage" ? "true" : undefined}
          className={spotlightListButtonClassName(selection?.kind === "coverage")}
          onClick={onSelectCoverage}
          type="button"
        >
          <span className="flex min-w-0 items-start gap-2">
            <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-ink" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">Coverage</span>
              <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                <span>{isCoverageLoading ? "Loading" : `${coverageAnchorCount} unlit lines`}</span>
                <span>{coverageFileCount} files</span>
              </span>
            </span>
          </span>
          <SpotlightIntentBadge intent="coverage" />
        </button>

        {views.map((view) => (
          <div className="flex items-start gap-2" key={view.displayRef}>
            <button
              aria-current={
                selection?.kind === "view" && selection.viewRef === view.displayRef
                  ? "true"
                  : undefined
              }
              className={`min-w-0 flex-1 ${spotlightListButtonClassName(
                selection?.kind === "view" && selection.viewRef === view.displayRef,
              )}`}
              onClick={() => onSelectView(view.displayRef)}
              type="button"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-6 shrink-0 items-center justify-center rounded-md border border-line bg-muted-surface px-1.5 font-mono text-xs font-semibold text-accent-ink">
                    {view.displayRef}
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{view.title}</span>
                </span>
                <span className="mt-2 flex flex-wrap gap-2">
                  <SpotlightIntentBadge intent={view.intent} />
                  <SpotlightHealthBadge health={view.health} />
                  <span className="inline-flex items-center gap-1 rounded-md border border-line bg-muted-surface px-2 py-0.5 text-xs font-medium text-muted">
                    <FileCode2 aria-hidden="true" className="size-3.5" />
                    {view.associatedFiles.length}
                  </span>
                </span>
              </span>
            </button>
            <CopyRefButton compact refValue={view.displayRef} stopPropagation />
          </div>
        ))}

        {!isLoadingViews && views.length === 0 ? (
          <div className="pt-2">
            <EmptyState title="No Spotlight views" body="Generate views to create review lenses." />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SpotlightRunNote({
  isGenerating,
  lastRun,
}: {
  isGenerating: boolean;
  lastRun: SpotlightRunResource | null;
}) {
  if (isGenerating) {
    return (
      <p className="inline-flex items-center gap-2 rounded-md border border-line bg-muted-surface px-2 py-1 text-xs font-medium text-muted">
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        Generating views
      </p>
    );
  }

  // Active runs render through the 3-step stepper; this note only
  // reports settled outcomes.
  if (lastRun === null || (lastRun.status !== "completed" && lastRun.status !== "failed")) {
    return null;
  }

  const failed = lastRun.status === "failed";
  const completed = lastRun.status === "completed";
  const Icon = failed ? TriangleAlert : completed ? CheckCircle2 : CircleDot;

  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        failed
          ? "border-danger/30 bg-danger-soft text-danger-ink"
          : completed
            ? "border-success/30 bg-success-soft text-success-ink"
            : "border-line bg-muted-surface text-muted"
      }`}
    >
      <p className="flex items-center gap-2 font-medium">
        <Icon aria-hidden="true" className="size-3.5" />
        {spotlightRunStatusLabel(lastRun)}
      </p>
      {lastRun.errorMessage === null ? null : (
        <p className="mt-1 break-words">{lastRun.errorMessage}</p>
      )}
    </div>
  );
}

function spotlightListButtonClassName(active: boolean): string {
  return `grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-3 text-left ${
    active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-muted-surface"
  }`;
}
