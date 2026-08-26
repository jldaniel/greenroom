import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  BuiltinReviewRun,
  BuiltinReviewRunId,
  Profile,
  ProfileConsentMode,
  ProfileId,
  ReviewReference,
  RevisionId,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunId,
} from "@greenroom/schemas";

import {
  useApproveBuiltinReviewDraft,
  useApproveBuiltinReviewRun,
  useBuiltinReviewRun,
  useCancelWorkflowRun,
  useCreateBuiltinReviewConsent,
  useRecoverWorkflowRunFingerprint,
  useRetryWorkflowRun,
  useWorkflowRun,
  useWorkflowRunEvents,
} from "../../api/hooks";
import { isWorkflowRunActive } from "../WorkflowPanels";
import { workflowRunQueuePosition } from "../workflowRunUtils";
import { resumableBuiltinReviewRunId } from "./workspaceUtils";

export interface AiReviewRunsController {
  approveDraft: () => Promise<void>;
  approveRun: () => Promise<void>;
  builtinRun: BuiltinReviewRun | null;
  cancelRun: () => Promise<void>;
  consentMode: ProfileConsentMode;
  createConsent: (start: boolean) => Promise<void>;
  error: unknown;
  events: readonly WorkflowRunEvent[];
  isApprovingDraft: boolean;
  isApprovingRun: boolean;
  isCancelling: boolean;
  isCreatingConsent: boolean;
  isLoadingEvents: boolean;
  isRecoveringFingerprint: boolean;
  isRetrying: boolean;
  profileId: ProfileId | null;
  queuePosition: number | null;
  recoverFingerprint: () => Promise<void>;
  retryRun: () => Promise<void>;
  selectedProfile: Profile | null;
  setProfileId: (profileId: ProfileId | null) => void;
  workflowRun: WorkflowRun | null;
}

/**
 * AI Review run state for the workspace drawer section: profile selection,
 * the one-click/two-step consent creation, run polling, and the run actions
 * the shared RunStatus/ConsentCard components render.
 * Consent-mode dispatch (dialog vs trusted vs two-step) stays with the page,
 * which owns the shared RunConsentDialog.
 */
export function useAiReviewRuns({
  currentRevisionId,
  enabled,
  profiles,
  reviewId,
  reviewWorkflowRuns,
}: {
  currentRevisionId: RevisionId | null;
  enabled: boolean;
  profiles: Profile[];
  reviewId: ReviewReference;
  reviewWorkflowRuns: readonly WorkflowRun[];
}): AiReviewRunsController {
  const [profileId, setProfileId] = useState<ProfileId | null>(null);
  const [runId, setRunId] = useState<BuiltinReviewRunId | null>(null);
  const createConsent = useCreateBuiltinReviewConsent();
  const approveRun = useApproveBuiltinReviewRun();
  const approveDraft = useApproveBuiltinReviewDraft();
  const cancelRun = useCancelWorkflowRun();
  const retryRun = useRetryWorkflowRun();
  const recoverFingerprint = useRecoverWorkflowRunFingerprint();
  const defaultProfileId = profiles[0]?.id ?? null;
  const selectedProfile =
    profileId === null ? null : (profiles.find((profile) => profile.id === profileId) ?? null);
  const consentMode = selectedProfile?.privacy.consentMode ?? "one_click";
  const workflowRunId = runId as WorkflowRunId | null;
  // Once a run exists, keep tracking it even while the AI Review drawer
  // section is closed: polling continues at page level so the run
  // state is current when the section reopens.
  const runTrackingEnabled = enabled || runId !== null;
  const run = useBuiltinReviewRun(runId, runTrackingEnabled);
  const workflowRun = useWorkflowRun(workflowRunId, runTrackingEnabled, approveRun.isPending);
  const events = useWorkflowRunEvents(
    workflowRunId,
    runTrackingEnabled,
    approveRun.isPending ||
      (workflowRun.data !== undefined && isWorkflowRunActive(workflowRun.data.status)),
  );
  const queuePosition = useMemo(
    () => workflowRunQueuePosition(reviewWorkflowRuns, workflowRunId),
    [reviewWorkflowRuns, workflowRunId],
  );

  useEffect(() => {
    if (profileId === null && defaultProfileId !== null) {
      setProfileId(defaultProfileId);
    }
  }, [defaultProfileId, profileId]);

  // Recover active-run visibility after a page reload: the tracked
  // run id lives only in client state, so seed it from the review's
  // workflow-run list when this session has not touched a run yet. Runs
  // started or acted on in-session set `runId` and always win over seeding;
  // terminal runs are never resurrected (a pending_consent two-step run does
  // seed, so its approval gate stays reachable).
  useEffect(() => {
    if (runId !== null) {
      return;
    }

    const resumableId = resumableBuiltinReviewRunId(reviewWorkflowRuns);

    if (resumableId !== null) {
      setRunId(resumableId);
    }
  }, [reviewWorkflowRuns, runId]);

  const handleCreateConsent = useCallback(
    async (start: boolean) => {
      if (currentRevisionId === null || profileId === null) {
        return;
      }

      const created = await createConsent.mutateAsync({
        reviewId,
        input: {
          profileId,
          revisionId: currentRevisionId,
          maxApproximateTokens: 24_000,
          ...(start ? { start: true } : {}),
        },
      });
      setRunId(created.id);
    },
    [createConsent, currentRevisionId, profileId, reviewId],
  );

  const handleApproveRun = useCallback(async () => {
    if (runId === null) {
      return;
    }

    const approved = await approveRun.mutateAsync(runId);
    setRunId(approved.id);
  }, [approveRun, runId]);

  const handleApproveDraft = useCallback(async () => {
    if (runId === null) {
      return;
    }

    const approved = await approveDraft.mutateAsync(runId);
    setRunId(approved.id);
  }, [approveDraft, runId]);

  const handleCancelRun = useCallback(async () => {
    if (workflowRunId === null) {
      return;
    }

    const cancelled = await cancelRun.mutateAsync({
      runId: workflowRunId,
      input: { reason: "Cancelled from the review workspace." },
    });
    setRunId(cancelled.id as BuiltinReviewRunId);
  }, [cancelRun, workflowRunId]);

  const handleRetryRun = useCallback(async () => {
    if (workflowRunId === null) {
      return;
    }

    const retried = await retryRun.mutateAsync(workflowRunId);
    setRunId(retried.id as BuiltinReviewRunId);
  }, [retryRun, workflowRunId]);

  const handleRecoverFingerprint = useCallback(async () => {
    if (workflowRunId === null) {
      return;
    }

    // Atomic server-side recovery: refreshes the review to a new revision
    // snapshot and creates a run consented against that new revision.
    const recovery = await recoverFingerprint.mutateAsync(workflowRunId);
    setRunId(recovery.run.id as BuiltinReviewRunId);
  }, [recoverFingerprint, workflowRunId]);

  const error = enabled
    ? (createConsent.error ??
      approveRun.error ??
      approveDraft.error ??
      cancelRun.error ??
      retryRun.error ??
      recoverFingerprint.error ??
      run.error ??
      workflowRun.error ??
      events.error)
    : null;

  return {
    approveDraft: handleApproveDraft,
    approveRun: handleApproveRun,
    builtinRun: run.data ?? approveRun.data ?? createConsent.data ?? null,
    cancelRun: handleCancelRun,
    consentMode,
    createConsent: handleCreateConsent,
    error,
    events: events.data ?? [],
    isApprovingDraft: approveDraft.isPending,
    isApprovingRun: approveRun.isPending,
    isCancelling: cancelRun.isPending,
    isCreatingConsent: createConsent.isPending,
    isLoadingEvents: events.isLoading,
    isRecoveringFingerprint: recoverFingerprint.isPending,
    isRetrying: retryRun.isPending,
    profileId,
    queuePosition,
    recoverFingerprint: handleRecoverFingerprint,
    retryRun: handleRetryRun,
    selectedProfile,
    setProfileId,
    workflowRun: workflowRun.data ?? null,
  };
}
