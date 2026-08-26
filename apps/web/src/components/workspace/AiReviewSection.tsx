import { Bot, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

import type { Profile, ProfileId, RevisionId } from "@greenroom/schemas";

import { AiReadinessNote } from "../AiReadinessNote";
import type { AiRunReadiness } from "../aiReadinessUtils";
import { ConsentCard } from "../ConsentCard";
import { EmptyState } from "../Feedback";
import { RunStatus } from "../RunStatus";
import { WorkflowDraftFindingsPanel, WorkflowValidationIssueList } from "../WorkflowPanels";
import type { AiReviewRunsController } from "./useAiReviewRuns";
import { worktreeDirtyWarning } from "./workspaceTypes";

/**
 * AI Review drawer section: profile selection and the run CTA, followed
 * by the shared RunStatus/ConsentCard for the active run and its draft
 * findings. Consent-mode dispatch happens in the page via onPrepare and
 * onRecoverFingerprint so the shared RunConsentDialog stays page-owned.
 */
export function AiReviewSection({
  ai,
  canPrepare,
  currentRevisionId,
  isCheckingReadiness,
  isRefreshing,
  onPrepare,
  onRecoverFingerprint,
  onRefreshReview,
  profiles,
  readiness,
  worktreeDirty,
}: {
  ai: AiReviewRunsController;
  canPrepare: boolean;
  currentRevisionId: RevisionId | null;
  isCheckingReadiness: boolean;
  isRefreshing: boolean;
  onPrepare: () => void;
  onRecoverFingerprint: () => void;
  onRefreshReview: () => void;
  profiles: Profile[];
  readiness: AiRunReadiness;
  worktreeDirty: boolean;
}) {
  return (
    <div className="w-full min-w-0 space-y-4">
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot aria-hidden="true" className="size-4 text-accent-ink" />
            AI Review
          </div>
          <p className="mt-1 text-xs text-muted">
            {ai.consentMode === "trusted"
              ? "Trusted profile: runs start immediately and validated findings become threads."
              : ai.consentMode === "one_click"
                ? "Confirm the scope once to start a harness run."
                : "Prepare a scoped harness run before creating review threads."}
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <label className="grid gap-1 text-xs font-medium text-muted">
            <span>Profile</span>
            <select
              className="h-9 min-w-0 w-full max-w-full rounded-md border border-line bg-surface px-2 text-sm text-ink"
              disabled={profiles.length === 0 || ai.isCreatingConsent}
              onChange={(event) =>
                ai.setProfileId(
                  event.target.value.length === 0 ? null : (event.target.value as ProfileId),
                )
              }
              value={ai.profileId ?? ""}
            >
              {profiles.length === 0 ? <option value="">No AI Review profiles</option> : null}
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs text-muted">
            <dt>Provider</dt>
            <dd className="truncate text-ink">{ai.selectedProfile?.provider ?? "None"}</dd>
            <dt>Model</dt>
            <dd className="truncate font-mono text-ink">{ai.selectedProfile?.model ?? "None"}</dd>
            <dt>Revision</dt>
            <dd className="truncate font-mono text-ink">{currentRevisionId ?? "None"}</dd>
          </dl>

          <AiReadinessNote isChecking={isCheckingReadiness} readiness={readiness} />

          {profiles.length === 0 ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
              Create a built-in review profile in Settings before preparing a run.
            </p>
          ) : ai.selectedProfile !== null && ai.selectedProfile.provider !== "harness" ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
              Built-in AI Review requires a harness-backed profile.
            </p>
          ) : currentRevisionId === null ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
              This review has no current revision to inspect.
            </p>
          ) : null}

          {worktreeDirty ? (
            <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
              <p>{worktreeDirtyWarning}</p>
              <button
                className="mt-2 inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-xs font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
                disabled={isRefreshing}
                onClick={onRefreshReview}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Refresh review
              </button>
            </div>
          ) : null}

          <button
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-surface disabled:opacity-60"
            disabled={!canPrepare || ai.isCreatingConsent}
            onClick={onPrepare}
            title={readiness.reason ?? undefined}
            type="button"
          >
            {ai.isCreatingConsent ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ShieldCheck aria-hidden="true" className="size-4" />
            )}
            {ai.consentMode === "two_step" ? "Prepare consent" : "Run AI review"}
          </button>
        </div>
      </section>

      <AiReviewRunDetails ai={ai} onRecoverFingerprint={onRecoverFingerprint} />
    </div>
  );
}

function AiReviewRunDetails({
  ai,
  onRecoverFingerprint,
}: {
  ai: AiReviewRunsController;
  onRecoverFingerprint: () => void;
}) {
  const workflowRun = ai.workflowRun;

  if (workflowRun === null) {
    return (
      <section className="rounded-lg border border-line bg-surface p-4">
        <EmptyState
          title="No AI Review run"
          body="Prepare consent to review the workflow scope before launching a harness run."
        />
      </section>
    );
  }

  const draft =
    workflowRun.draftOutput?.kind === "builtin_review_findings" ? workflowRun.draftOutput : null;
  const hasBlockingIssues = workflowRun.validationIssues.some(
    (issue) => issue.severity === "error",
  );
  const requiresDraftApproval =
    workflowRun.consentSummary.threadCreationGate?.mode === "draft_approval_required";
  const canApproveDraft =
    draft !== null &&
    requiresDraftApproval &&
    workflowRun.status === "awaiting_user" &&
    !hasBlockingIssues;
  const canApproveRun =
    workflowRun.status === "pending_consent" || ai.builtinRun?.status === "pending_consent";

  return (
    <div className="min-w-0 space-y-4">
      <RunStatus
        cancel={{ isPending: ai.isCancelling, onAction: () => void ai.cancelRun() }}
        emptyEventsLabel="No AI Review workflow events yet."
        events={ai.events}
        isLoadingEvents={ai.isLoadingEvents}
        isRecoveringFingerprint={ai.isRecoveringFingerprint}
        onRecoverFingerprint={onRecoverFingerprint}
        queuePosition={ai.queuePosition}
        retry={{ isPending: ai.isRetrying, onAction: () => void ai.retryRun() }}
        run={workflowRun}
      />
      <ConsentCard
        consent={workflowRun.consentSummary}
        {...(canApproveRun
          ? { isApproving: ai.isApprovingRun, onApprove: () => void ai.approveRun() }
          : {})}
      />
      <WorkflowValidationIssueList issues={workflowRun.validationIssues} />

      {draft === null ? (
        <section className="rounded-lg border border-line bg-surface p-4">
          <EmptyState
            title="No draft findings"
            body={
              workflowRun.status === "pending_consent"
                ? "Approve the run after reviewing the consent scope."
                : "Draft findings will appear here after validation."
            }
          />
        </section>
      ) : (
        <>
          {requiresDraftApproval && workflowRun.status === "awaiting_user" ? (
            <p className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-ink">
              Draft findings are validated but no review threads will be created until approval.
            </p>
          ) : null}
          <WorkflowDraftFindingsPanel
            canApprove={canApproveDraft}
            createdThreadRefs={ai.builtinRun?.createdThreadRefs ?? []}
            draft={draft}
            isApproving={ai.isApprovingDraft}
            {...(requiresDraftApproval ? { onApproveAll: () => void ai.approveDraft() } : {})}
          />
        </>
      )}
    </div>
  );
}
