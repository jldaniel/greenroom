import {
  builtinReviewConsentCreateInputSchema,
  builtinReviewRunIdSchema,
  builtinReviewRunSchema,
  type BuiltinReviewConsentCreateInput,
  type BuiltinReviewContextFile,
  type BuiltinReviewContextPack,
  type BuiltinReviewRun,
  type BuiltinReviewRunId,
  type DiffFile,
  type Profile,
  type Repository,
  type ReviewPr,
  type ReviewDisplayId,
  type RevisionId,
  type RevisionSnapshot,
  type ThreadWithComments,
  type TokenId,
  type WorkflowRun,
  type WorkflowRunId,
} from "@greenroom/schemas";
import type { StoredReviewPr } from "@greenroom/core";

import {
  assertProfileAllowsOneClickConsent,
  consentModeForRequest,
  isTrustedProfile,
} from "./consent";
import { ApiHttpError } from "./errors";
import { createWorkflowRunForReview, type GreenroomApiServices } from "./services";
import {
  builtinReviewOutputFromDraft,
  createBuiltinReviewThreadsForDraft,
  recordBuiltinReviewPersistenceEvents,
  shouldAutoCreateBuiltinReviewThreads,
} from "../workflows/builtin-review";

export interface CreateBuiltinReviewConsentRequest extends BuiltinReviewConsentCreateInput {
  reviewDisplayId: ReviewDisplayId;
}

export async function createBuiltinReviewConsent(
  services: GreenroomApiServices,
  input: CreateBuiltinReviewConsentRequest,
): Promise<BuiltinReviewRun> {
  const { reviewDisplayId, ...body } = input;
  const parsed = builtinReviewConsentCreateInputSchema.parse(body);
  const review = requireBuiltinReviewReview(services, reviewDisplayId);
  const profile = requireBuiltinReviewProfile(services, parsed.profileId);
  const requestedRevisionId = parsed.revisionId ?? review.currentRevisionId;

  if (profile.provider !== "harness") {
    throw new ApiHttpError(400, "bad_request", "Built-in review runs require a harness profile");
  }

  if (requestedRevisionId === null) {
    throw new ApiHttpError(404, "not_found", `Review ${reviewDisplayId} has no revision`);
  }

  if (review.currentRevisionId !== requestedRevisionId) {
    throw new ApiHttpError(
      409,
      "conflict",
      "Built-in review runs must target the current revision",
    );
  }

  if (parsed.start) {
    assertProfileAllowsOneClickConsent(profile);
  }

  // Trusted profiles start immediately even without start: true.
  const start = parsed.start || isTrustedProfile(profile);
  const autoCreateThreads = shouldAutoCreateBuiltinReviewThreads(profile);
  const run = createWorkflowRunForReview(services, {
    reviewDisplayId,
    workflowKind: "builtin_review",
    profileId: profile.id,
    revisionId: requestedRevisionId,
    expectedOutputMode: "builtin_review_findings",
    scopeLabel: "All changed files",
    threadCreationGate: {
      mode: autoCreateThreads ? "auto_create_after_validation" : "draft_approval_required",
      autoCreateThreads,
      reason: isTrustedProfile(profile)
        ? "Trusted profile auto-creates threads from validated findings."
        : autoCreateThreads
          ? "Profile explicitly enables automatic thread creation after validation."
          : "Built-in review defaults to validated draft approval before creating threads.",
    },
    metadata: {
      builtinReviewApiVersion: 2,
      consentMode: consentModeForRequest(parsed.start, profile),
      threadCreationGateMode: autoCreateThreads
        ? "auto_create_after_validation"
        : "draft_approval_required",
    },
  });

  if (start) {
    return approveBuiltinReviewRun(services, run.id as BuiltinReviewRunId);
  }

  return builtinReviewRunFromWorkflowRun(services, run);
}

export function readBuiltinReviewRun(
  services: GreenroomApiServices,
  runId: BuiltinReviewRunId,
): BuiltinReviewRun {
  return builtinReviewRunFromWorkflowRun(
    services,
    requireBuiltinReviewWorkflowRun(services, runId),
  );
}

export async function approveBuiltinReviewRun(
  services: GreenroomApiServices,
  runId: BuiltinReviewRunId,
): Promise<BuiltinReviewRun> {
  let run = requireBuiltinReviewWorkflowRun(services, runId);

  if (run.status === "completed" || run.status === "awaiting_user") {
    return builtinReviewRunFromWorkflowRun(services, run);
  }

  if (run.status === "queued" || run.status === "running" || run.status === "repairing") {
    return builtinReviewRunFromWorkflowRun(services, run);
  }

  if (run.status === "failed") {
    throw new ApiHttpError(409, "conflict", "Failed built-in review runs cannot be approved again");
  }

  if (run.status === "cancelled") {
    throw new ApiHttpError(409, "conflict", "Cancelled built-in review runs cannot be approved");
  }

  const profile = requireBuiltinReviewProfile(services, run.profileId);

  if (profile.provider !== "harness") {
    throw new ApiHttpError(400, "bad_request", "Built-in review runs require a harness profile");
  }

  if (services.harnessClient === null) {
    throw new ApiHttpError(400, "bad_request", "Provider harness is not configured");
  }

  if (run.status === "pending_consent") {
    recordBuiltinReviewStartEvent(services, run);
    run = services.workflowRunner.approveRun(run.id);
  }

  return builtinReviewRunFromWorkflowRun(services, run);
}

export function approveBuiltinReviewDraft(
  services: GreenroomApiServices,
  runId: BuiltinReviewRunId,
): BuiltinReviewRun {
  const run = requireBuiltinReviewWorkflowRun(services, runId);

  if (run.status === "completed") {
    return builtinReviewRunFromWorkflowRun(services, run);
  }

  if (
    run.status !== "awaiting_user" ||
    run.metadata.threadCreationGateMode !== "draft_approval_required"
  ) {
    throw new ApiHttpError(
      409,
      "conflict",
      "Built-in review draft approval requires a validated draft awaiting user approval",
    );
  }

  if (run.validationIssues.some((issue) => issue.severity === "error")) {
    throw new ApiHttpError(409, "conflict", "Invalid built-in review drafts cannot create threads");
  }

  if (run.draftOutput === null || run.draftOutput.kind !== "builtin_review_findings") {
    throw new ApiHttpError(409, "conflict", "Built-in review run has no validated draft findings");
  }

  const result = createBuiltinReviewThreadsForDraft(services, run, run.draftOutput);
  recordBuiltinReviewPersistenceEvents({ services, run, result });
  const withFinal = services.workflows.saveFinalOutput(run.id, run.draftOutput) ?? run;
  const completed =
    services.workflows.updateStatus(withFinal.id, {
      status: "completed",
      phase: "completed",
      metadata: {
        createdThreadRefs: result.createdThreadRefs,
        createdThreadCount: result.createdThreadCount,
        validatedFindingCount: result.findingCount,
        threadCreationApprovedAt: services.clock(),
      },
    }) ?? withFinal;

  services.workflows.recordEvent({
    runId: completed.id,
    eventType: "persistence",
    summary: "Workflow run completed after built-in review draft approval.",
    metadata: {
      workflowKind: completed.workflowKind,
      createdThreadCount: result.createdThreadCount,
    },
  });
  revokeWorkflowGrantIfPresent(services, completed);

  return builtinReviewRunFromWorkflowRun(
    services,
    services.workflowRunner.readRun(completed.id) ?? completed,
  );
}

function requireBuiltinReviewWorkflowRun(
  services: GreenroomApiServices,
  runId: BuiltinReviewRunId,
): WorkflowRun {
  const parsedRunId = builtinReviewRunIdSchema.parse(runId);
  const run = services.workflowRunner.readRun(parsedRunId as WorkflowRunId);

  if (run === null || run.workflowKind !== "builtin_review") {
    throw new ApiHttpError(404, "not_found", `Built-in review run ${parsedRunId} was not found`);
  }

  return run;
}

function builtinReviewRunFromWorkflowRun(
  services: GreenroomApiServices,
  run: WorkflowRun,
): BuiltinReviewRun {
  const hasBlockingIssues = run.validationIssues.some((issue) => issue.severity === "error");
  const output = hasBlockingIssues
    ? null
    : builtinReviewOutputFromDraft(run.finalOutput ?? run.draftOutput);

  return builtinReviewRunSchema.parse({
    id: run.id,
    reviewDisplayId: run.reviewDisplayId,
    profileId: run.profileId,
    status: builtinReviewStatusFromWorkflowRun(run),
    context: buildBuiltinReviewContextSummary(services, run),
    createdAt: run.createdAt,
    approvedAt: run.queuedAt,
    completedAt: run.completedAt,
    errorMessage: run.errorMessage,
    output,
    createdThreadRefs: stringArrayMetadata(run.metadata.createdThreadRefs),
  });
}

function builtinReviewStatusFromWorkflowRun(run: WorkflowRun): BuiltinReviewRun["status"] {
  switch (run.status) {
    case "pending_consent":
      return "pending_consent";
    case "queued":
    case "running":
    case "repairing":
      return "approved";
    case "awaiting_user":
      return "awaiting_user";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function buildBuiltinReviewContextSummary(
  services: GreenroomApiServices,
  run: WorkflowRun,
): BuiltinReviewContextPack {
  const review = requireBuiltinReviewReview(services, run.reviewDisplayId);
  const repository = requireBuiltinReviewRepository(services, review.repositoryId);
  const revision = requireBuiltinReviewRevision(services, review, run.revisionId);
  const files = services.reviews.listDiffFiles(revision.id);
  const visibleFiles = files.slice(0, 250).map(builtinReviewContextFileSummary);
  const omittedFiles = files.slice(250).map((file) => ({
    path: file.path,
    oldPath: file.oldPath,
    reason: "Context summary file limit exceeded",
    approximateTokenCount: approximateTokens(JSON.stringify(diffFileSummaryForTokens(file))),
    changedLineCount: changedLineCount(file),
  }));
  const existingThreads = services.threads
    .listByReview(review.id)
    .filter((thread) => thread.status === "open")
    .map(existingThreadSummary);
  const spotlightViews = services.spotlight.listViewsWithRegionsByReview(review.id).map((view) => ({
    displayRef: view.displayRef,
    title: view.title,
    intent: view.intent,
    health: view.health,
    associatedFiles: associatedFilesForAnchoredRegions(view.regions),
  }));
  const approximateTokenCount = approximateTokens(
    JSON.stringify({
      review: { title: review.title, displayId: review.displayId },
      repository: { id: repository.id, displayName: repository.displayName },
      revision: {
        id: revision.id,
        baseSha: revision.baseSha,
        headSha: revision.headSha,
        diffSummary: revision.diffSummary,
      },
      files: visibleFiles,
      omittedFiles,
      existingThreads,
      spotlightViews,
      workflowConsentSummary: run.consentSummary,
    }),
  );

  return {
    review,
    repository,
    revision,
    files: visibleFiles,
    omittedFiles,
    existingThreads,
    spotlightViews,
    approximateTokenCount,
    generatedAt: services.clock(),
  };
}

function builtinReviewContextFileSummary(file: DiffFile): BuiltinReviewContextFile {
  const summary = {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    isBinary: file.isBinary,
    additions: file.additions,
    deletions: file.deletions,
    hunks: [],
    changedLineCount: changedLineCount(file),
    approximateTokenCount: 0,
  };

  return {
    ...summary,
    approximateTokenCount: approximateTokens(JSON.stringify(summary)),
  };
}

function diffFileSummaryForTokens(file: DiffFile) {
  return {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    isBinary: file.isBinary,
    additions: file.additions,
    deletions: file.deletions,
    changedLineCount: changedLineCount(file),
  };
}

function changedLineCount(file: DiffFile): number {
  if (file.isBinary) {
    return 0;
  }

  return file.hunks.reduce(
    (sum, hunk) =>
      sum +
      hunk.lines.filter((line) => line.type === "addition" || line.type === "deletion").length,
    0,
  );
}

function recordBuiltinReviewStartEvent(services: GreenroomApiServices, run: WorkflowRun): void {
  services.agentEvents.create({
    reviewDisplayId: run.reviewDisplayId,
    eventType: "status_update",
    source: {
      kind: "system",
      displayName: "Stage Manager",
      metadata: {
        workflowType: "builtin_review",
        workflowRunId: run.id,
      },
    },
    threadRefs: [],
    summary: "Built-in review run started",
    metadata: {
      workflowRunId: run.id,
      profileId: run.profileId,
      harnessKind: run.harnessKind,
    },
  });
}

function revokeWorkflowGrantIfPresent(services: GreenroomApiServices, run: WorkflowRun): void {
  const grantId = typeof run.metadata.mcpGrantId === "string" ? run.metadata.mcpGrantId : null;

  if (grantId === null) {
    return;
  }

  services.tokens.revoke(grantId as TokenId);
  services.workflows.updateStatus(run.id, {
    status: run.status,
    metadata: { mcpGrantRevokedAt: services.clock() },
  });
}

function requireBuiltinReviewProfile(
  services: GreenroomApiServices,
  profileId: Profile["id"],
): Profile {
  const profile = services.profiles.get(profileId);

  if (profile === null) {
    throw new ApiHttpError(404, "not_found", `Profile ${profileId} was not found`);
  }

  if (profile.workflowType !== "builtin_review") {
    throw new ApiHttpError(
      400,
      "bad_request",
      "Built-in review runs require a builtin_review profile",
    );
  }

  return profile;
}

function requireBuiltinReviewReview(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
): StoredReviewPr {
  const review = services.reviews.getByDisplayId(reviewDisplayId);

  if (review === null) {
    throw new ApiHttpError(404, "not_found", `Review ${reviewDisplayId} was not found`);
  }

  return review;
}

function requireBuiltinReviewRepository(
  services: GreenroomApiServices,
  repositoryId: Repository["id"],
): Repository {
  const repository = services.repositories.get(repositoryId);

  if (repository === null) {
    throw new ApiHttpError(404, "not_found", `Repository ${repositoryId} was not found`);
  }

  return repository;
}

function requireBuiltinReviewRevision(
  services: GreenroomApiServices,
  review: ReviewPr,
  revisionId: RevisionId,
): RevisionSnapshot {
  const revision = services.reviews.getRevision(revisionId);

  if (revision === null || revision.reviewDisplayId !== review.displayId) {
    throw new ApiHttpError(404, "not_found", `Revision ${revisionId} was not found`);
  }

  return revision;
}

function stringArrayMetadata(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function existingThreadSummary(thread: ThreadWithComments) {
  const firstComment = thread.comments[0] ?? null;
  const [title, ...bodyParts] = firstComment?.body.split("\n\n") ?? [];

  return {
    shortRef: thread.shortRef,
    status: thread.status,
    type: thread.type,
    severity: thread.severity,
    filePath: thread.anchor.filePath,
    oldPath: thread.anchor.oldFilePath,
    lineNumber: thread.anchor.lineNumber,
    title: title === undefined || title.trim().length === 0 ? null : title.trim().slice(0, 240),
    bodyPreview: (bodyParts.join("\n\n") || firstComment?.body || "").slice(0, 1000),
  };
}

function associatedFilesForAnchoredRegions(
  regions: ReadonlyArray<{ filePath: string; oldPath: string | null }>,
): Array<{ path: string; oldPath: string | null }> {
  const files = new Map<string, { path: string; oldPath: string | null }>();

  for (const region of regions) {
    files.set(`${region.filePath}\0${region.oldPath ?? ""}`, {
      path: region.filePath,
      oldPath: region.oldPath,
    });
  }

  return Array.from(files.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function approximateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}
