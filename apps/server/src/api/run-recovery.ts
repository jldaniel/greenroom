import type {
  Profile,
  ProfileConsentMode,
  ReviewPr,
  RevisionSnapshot,
  WorkflowRun,
  WorkflowRunId,
} from "@greenroom/schemas";

import { deriveWorkflowRunDiagnostics } from "../workflows/diagnostics";
import { consentModeForRequest } from "./consent";
import { ApiHttpError } from "./errors";
import { createWorkflowRunForReview, refreshReview, type GreenroomApiServices } from "./services";

/**
 * Fingerprint-change recovery.
 *
 * When a run failed because the worktree fingerprint changed under it, the
 * consented revision snapshot no longer matches reality. Recovery is one
 * atomic server-side action: refresh the review to a new revision snapshot of
 * the current worktree state, then create a fresh run of the same workflow
 * kind and profile whose consent summary references the NEW revision. The old
 * consent scope is never reused.
 *
 * Consent semantics follow the profile's consent mode:
 * - `one_click` / `trusted`: the user's recovery click is the confirmation of
 *   the new scope, so the new run is approved and queued immediately.
 * - `two_step`: the new run lands in `pending_consent` and must be approved
 *   through the normal approve endpoint after inspecting the new scope.
 */
export interface WorkflowRunFingerprintRecovery {
  /** The newly created run, consented against the refreshed revision. */
  run: WorkflowRun;
  /** True when the run was approved and queued as part of recovery. */
  started: boolean;
  consentMode: ProfileConsentMode;
  recoveredFromRunId: WorkflowRunId;
  review: ReviewPr;
  /** The review's revision after the refresh; the new run targets this. */
  revision: RevisionSnapshot;
  /** True when the worktree already matched and no new revision was created. */
  reusedRevision: boolean;
}

export async function recoverWorkflowRunFromFingerprintChange(
  services: GreenroomApiServices,
  runId: WorkflowRunId,
): Promise<WorkflowRunFingerprintRecovery> {
  const failedRun = services.workflowRunner.readRun(runId);

  if (failedRun === null) {
    throw new ApiHttpError(404, "not_found", `Workflow run ${runId} was not found`);
  }

  if (failedRun.status !== "failed") {
    throw new ApiHttpError(
      409,
      "conflict",
      `Workflow run ${runId} is ${failedRun.status}; only failed runs can be recovered`,
    );
  }

  const review = services.reviews.getByDisplayId(failedRun.reviewDisplayId);
  const diagnostics = deriveWorkflowRunDiagnostics({
    run: failedRun,
    events: services.workflowRunner.listEvents(runId),
    transcripts: services.transcripts.listByRun(runId),
    currentRevisionId: review?.currentRevisionId ?? null,
  });

  if (diagnostics.failureCategory !== "fingerprint_changed") {
    throw new ApiHttpError(
      409,
      "conflict",
      `Workflow run ${runId} failed with category ${diagnostics.failureCategory ?? "unknown"}; ` +
        "fingerprint recovery only applies to fingerprint_changed failures",
    );
  }

  const profile = requireRecoveryProfile(services, failedRun);
  const refreshed = await refreshReview(services, failedRun.reviewDisplayId);
  const startImmediately = profile.privacy.consentMode !== "two_step";
  const consentMode = consentModeForRequest(startImmediately, profile);
  const threadCreationGate = failedRun.consentSummary.threadCreationGate;
  const created = createWorkflowRunForReview(services, {
    reviewDisplayId: failedRun.reviewDisplayId,
    workflowKind: failedRun.workflowKind,
    profileId: profile.id,
    revisionId: refreshed.revision.id,
    harnessKind: failedRun.harnessKind,
    scopeLabel: failedRun.consentSummary.scopeLabel,
    allowedMcpCapabilities: [...failedRun.consentSummary.allowedMcpCapabilities],
    expectedOutputMode: failedRun.consentSummary.expectedOutputMode,
    threadCreationGate,
    metadata: {
      recoveredFromRunId: failedRun.id,
      recoveryReason: "fingerprint_changed",
      consentMode,
      ...(threadCreationGate === null ? {} : { threadCreationGateMode: threadCreationGate.mode }),
      ...(typeof failedRun.metadata.builtinReviewApiVersion === "number"
        ? { builtinReviewApiVersion: failedRun.metadata.builtinReviewApiVersion }
        : {}),
    },
  });

  services.workflows.recordEvent({
    runId: failedRun.id,
    eventType: "lifecycle",
    summary: "Fingerprint-change recovery created a replacement run against the current revision.",
    metadata: {
      recoveryRunId: created.id,
      recoveryRevisionId: refreshed.revision.id,
      reusedRevision: refreshed.reused,
    },
  });

  const run = startImmediately ? services.workflowRunner.approveRun(created.id) : created;

  return {
    run,
    started: startImmediately,
    consentMode,
    recoveredFromRunId: failedRun.id,
    review: refreshed.review,
    revision: refreshed.revision,
    reusedRevision: refreshed.reused,
  };
}

function requireRecoveryProfile(services: GreenroomApiServices, run: WorkflowRun): Profile {
  const profile = services.profiles.get(run.profileId);

  if (profile === null) {
    throw new ApiHttpError(
      409,
      "conflict",
      `Profile ${run.profileId} for workflow run ${run.id} no longer exists`,
    );
  }

  return profile;
}
