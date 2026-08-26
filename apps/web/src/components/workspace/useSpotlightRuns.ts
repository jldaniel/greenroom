import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type {
  Profile,
  ReviewReference,
  RevisionId,
  SpotlightRunId,
  WorkflowRun,
  WorkflowRunEvent,
} from "@greenroom/schemas";

import type { SpotlightRunResource, SpotlightViewResource } from "../../api/client";
import {
  useApproveSpotlightRunContext,
  useApproveSpotlightRunPlan,
  useCancelWorkflowRun,
  useCreateSpotlightRun,
  spotlightKeys,
  useRefineSpotlightRunPlan,
  useRetryWorkflowRun,
  useSpotlightRun,
  useWorkflowRunEvents,
} from "../../api/hooks";
import { isWorkflowRunActive } from "../WorkflowPanels";
import { workflowRunQueuePosition } from "../workflowRunUtils";
import type { SpotlightRunKind } from "./workspaceTypes";
import {
  claimCompletedSpotlightWorkflowRefresh,
  latestLinkedWorkflowRun,
  latestSpotlightRun,
  profileBoolean,
  resumableSpotlightRunId,
} from "./workspaceUtils";

export interface SpotlightRunsController {
  approveContext: (runId: SpotlightRunId) => Promise<void>;
  approvePlan: (run: SpotlightRunResource) => Promise<void>;
  cancelRun: () => Promise<void>;
  consentMode: Profile["privacy"]["consentMode"];
  error: unknown;
  isApprovingContext: boolean;
  isApprovingPlan: boolean;
  isCancelling: boolean;
  isCreatingRun: boolean;
  isLoadingEvents: boolean;
  isRefiningPlan: boolean;
  isRetrying: boolean;
  lastRun: SpotlightRunResource | null;
  queuePosition: number | null;
  refinePlan: (runId: SpotlightRunId, instruction: string) => Promise<void>;
  retryRun: () => Promise<void>;
  startRun: (type: SpotlightRunKind, start: boolean) => Promise<void>;
  workflowEvents: readonly WorkflowRunEvent[];
  workflowRun: WorkflowRun | null;
}

/**
 * Spotlight run lifecycle for the workspace drawer section: manual run
 * creation (generate/update/regenerate/refine), the context and plan gates,
 * and the linked workflow run whose status the shared RunStatus renders.
 * Scope data (views, view diffs, coverage) lives in
 * useSpotlightScope; consent-mode dispatch stays with the page.
 */
export function useSpotlightRuns({
  currentRevisionId,
  enabled,
  profile,
  reviewId,
  reviewWorkflowRuns,
  selectedView,
}: {
  currentRevisionId: RevisionId | null;
  enabled: boolean;
  profile: Profile | null;
  reviewId: ReviewReference;
  reviewWorkflowRuns: readonly WorkflowRun[];
  selectedView: SpotlightViewResource | null;
}): SpotlightRunsController {
  const [lastRunId, setLastRunId] = useState<SpotlightRunId | null>(null);
  const createRun = useCreateSpotlightRun();
  const approveContext = useApproveSpotlightRunContext();
  const refinePlan = useRefineSpotlightRunPlan();
  const approvePlan = useApproveSpotlightRunPlan();
  const cancelRun = useCancelWorkflowRun();
  const retryRun = useRetryWorkflowRun();
  const queryClient = useQueryClient();
  const refreshedWorkflowRunIds = useRef(new Set<string>());
  // Once a run exists, keep tracking it even while the Spotlight drawer
  // section is closed: polling continues at page level so the run
  // state is current when the section reopens.
  const runTrackingEnabled = enabled || lastRunId !== null;
  const lastRunQuery = useSpotlightRun(reviewId, lastRunId, runTrackingEnabled);

  // Recover active-run visibility after a page reload: the tracked
  // spotlight run id lives only in client state, so seed it from the linked
  // spotlight workflow run in the review's workflow-run list when this
  // session has not touched a run yet. Runs started or acted on in-session
  // set `lastRunId` and always win over seeding; terminal workflow runs are
  // never resurrected (a pending_consent two-step run does seed, so its
  // gates stay reachable).
  useEffect(() => {
    if (lastRunId !== null) {
      return;
    }

    const resumableId = resumableSpotlightRunId(reviewWorkflowRuns);

    if (resumableId !== null) {
      setLastRunId(resumableId);
    }
  }, [lastRunId, reviewWorkflowRuns]);
  const manualRunsGated = useMemo(
    () => profileBoolean(profile?.contextPreferences.manualRunsGated, true),
    [profile],
  );
  const lastRun = useMemo(
    () =>
      latestSpotlightRun(
        [createRun.data, approveContext.data, refinePlan.data, approvePlan.data, lastRunQuery.data],
        lastRunId,
      ),
    [
      approveContext.data,
      approvePlan.data,
      createRun.data,
      lastRunId,
      lastRunQuery.data,
      refinePlan.data,
    ],
  );
  const workflowRun = useMemo(
    () => latestLinkedWorkflowRun(reviewWorkflowRuns, "spotlightRunId", lastRunId),
    [lastRunId, reviewWorkflowRuns],
  );
  useEffect(() => {
    if (!claimCompletedSpotlightWorkflowRefresh(workflowRun, refreshedWorkflowRunIds.current)) {
      return;
    }

    void queryClient.invalidateQueries({ queryKey: spotlightKeys.all(reviewId) });
  }, [queryClient, reviewId, workflowRun]);
  const workflowEvents = useWorkflowRunEvents(
    workflowRun?.id ?? null,
    runTrackingEnabled && workflowRun !== null,
    workflowRun !== null && isWorkflowRunActive(workflowRun.status),
  );
  const queuePosition = useMemo(
    () => workflowRunQueuePosition(reviewWorkflowRuns, workflowRun?.id ?? null),
    [reviewWorkflowRuns, workflowRun],
  );

  const handleStartRun = useCallback(
    async (type: SpotlightRunKind, start: boolean) => {
      if (currentRevisionId === null || profile === null) {
        return;
      }

      if (type === "refine_view" && selectedView === null) {
        return;
      }

      const run = await createRun.mutateAsync({
        reviewId,
        input: {
          type,
          trigger: "manual",
          gated: type === "update" || type === "refine_view" ? true : manualRunsGated,
          revisionId: currentRevisionId,
          profileId: profile.id,
          ...(type === "refine_view" && selectedView !== null
            ? { targetViewId: selectedView.displayRef }
            : {}),
          ...(type === "regenerate" ? { confirmed: true } : {}),
          ...(start ? { start: true } : {}),
        },
      });
      setLastRunId(run.id);
    },
    [createRun, currentRevisionId, manualRunsGated, profile, reviewId, selectedView],
  );

  const handleApproveContext = useCallback(
    async (runId: SpotlightRunId) => {
      const run = await approveContext.mutateAsync({ reviewId, runId });
      setLastRunId(run.id);
    },
    [approveContext, reviewId],
  );

  const handleRefinePlan = useCallback(
    async (runId: SpotlightRunId, instruction: string) => {
      const run = await refinePlan.mutateAsync({
        reviewId,
        runId,
        input: { instruction },
      });
      setLastRunId(run.id);
    },
    [refinePlan, reviewId],
  );

  const handleApprovePlan = useCallback(
    async (run: SpotlightRunResource) => {
      if (run.pendingOutline === null) {
        return;
      }

      const completed = await approvePlan.mutateAsync({
        reviewId,
        runId: run.id,
        input: { approvedOutline: run.pendingOutline },
      });
      setLastRunId(completed.id);
    },
    [approvePlan, reviewId],
  );

  const handleCancelRun = useCallback(async () => {
    if (workflowRun === null) {
      return;
    }

    await cancelRun.mutateAsync({
      runId: workflowRun.id,
      input: { reason: "Cancelled from the review workspace." },
    });
  }, [cancelRun, workflowRun]);

  const handleRetryRun = useCallback(async () => {
    if (workflowRun === null) {
      return;
    }

    await retryRun.mutateAsync(workflowRun.id);
  }, [retryRun, workflowRun]);

  const error = enabled
    ? (createRun.error ??
      approveContext.error ??
      refinePlan.error ??
      approvePlan.error ??
      cancelRun.error ??
      retryRun.error ??
      lastRunQuery.error ??
      workflowEvents.error)
    : null;

  return {
    approveContext: handleApproveContext,
    approvePlan: handleApprovePlan,
    cancelRun: handleCancelRun,
    consentMode: profile?.privacy.consentMode ?? "one_click",
    error,
    isApprovingContext: approveContext.isPending,
    isApprovingPlan: approvePlan.isPending,
    isCancelling: cancelRun.isPending,
    isCreatingRun: createRun.isPending,
    isLoadingEvents: workflowEvents.isLoading,
    isRefiningPlan: refinePlan.isPending,
    isRetrying: retryRun.isPending,
    lastRun,
    queuePosition,
    refinePlan: handleRefinePlan,
    retryRun: handleRetryRun,
    startRun: handleStartRun,
    workflowEvents: workflowEvents.data ?? [],
    workflowRun,
  };
}
