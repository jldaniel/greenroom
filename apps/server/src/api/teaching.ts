import {
  commentCreateInputSchema,
  structuredTeachingOutputSchema,
  teachingContextPackSchema,
  teachingFollowUpResponseSchema,
  teachingPromotionInputSchema,
  teachingRunResultSchema,
  threadCreateInputSchema,
  type DiffFile,
  type Profile,
  type ProviderKind,
  type Repository,
  type RepositoryId,
  type ReviewPr,
  type ReviewDisplayId,
  type SpotlightViewRef,
  type StructuredTeachingOutput,
  type TeachingConsentCreateInput,
  type TeachingContextFile,
  type TeachingContextOmittedRegion,
  type TeachingContextPack,
  type TeachingContextSpotlightRegion,
  type TeachingFollowUpResponse,
  type TeachingPromotionInput,
  type TeachingRunId,
  type TeachingRunResult,
  type ThreadAnchor,
  type ThreadWithComments,
  type WorkflowChangedFileSummary,
  type WorkflowMcpCapability,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
  type WorkflowRunId,
} from "@greenroom/schemas";
import { threadAnchorLineKey, type StoredReviewPr } from "@greenroom/core";

import {
  assertProfileAllowsOneClickConsent,
  consentModeForRequest,
  isTrustedProfile,
} from "./consent";
import { ApiHttpError } from "./errors";
import {
  workflowRepositoryAccessMetadata,
  workflowRepositoryAccessSummaryForProfile,
} from "./repository-access";
import type { GreenroomApiServices } from "./services";

export interface TeachingProviderRequest {
  runId?: TeachingRunId;
  profile: Profile;
  context: TeachingContextPack;
}

export interface TeachingFollowUpProviderRequest extends TeachingProviderRequest {
  output: StructuredTeachingOutput;
  question: string;
}

export interface TeachingProvider {
  readonly kind: ProviderKind;
  generateTeaching: (request: TeachingProviderRequest) => Promise<StructuredTeachingOutput>;
  answerFollowUp: (request: TeachingFollowUpProviderRequest) => Promise<string>;
}

export type TeachingProviderRegistry = Partial<Record<ProviderKind, TeachingProvider>>;

export interface CreateTeachingConsentRequest extends TeachingConsentCreateInput {
  reviewDisplayId: ReviewDisplayId;
}

export function createDefaultTeachingProviders(): TeachingProviderRegistry {
  return {
    mock: createMockTeachingProvider(),
  };
}

export async function createTeachingConsent(
  services: GreenroomApiServices,
  input: CreateTeachingConsentRequest,
): Promise<TeachingRunResult> {
  const profile = requireTeachingProfile(services, input.profileId);
  const context = buildTeachingContextPack(services, input.reviewDisplayId, input);

  if (context.review.currentRevisionId !== context.revision.id) {
    throw new ApiHttpError(409, "conflict", "Teaching runs must target the current revision");
  }

  if (input.start === true) {
    assertProfileAllowsOneClickConsent(profile);
  }

  // Trusted profiles start immediately even without start: true.
  const start = input.start === true || isTrustedProfile(profile);
  const run = createTeachingGenerateWorkflowRun(services, profile, context, input);

  services.workflows.recordEvent({
    runId: run.id,
    eventType: "lifecycle",
    summary: "Teaching consent summary created.",
    metadata: {
      teachingScopeKind: context.scope.kind,
      scopeLabel: run.consentSummary.scopeLabel,
      allowedMcpCapabilities: run.consentSummary.allowedMcpCapabilities,
      expectedMcpResources: run.consentSummary.expectedMcpResources,
      spotlightViewRef: context.scope.kind === "spotlight_view" ? context.scope.viewRef : null,
      spotlightRegionCount: context.spotlightRegions.length,
    },
  });

  if (start) {
    return approveTeachingRun(services, run.id as TeachingRunId);
  }

  return teachingRunResultFromWorkflowRun(services, run);
}

export function readTeachingRun(
  services: GreenroomApiServices,
  runId: TeachingRunId,
): TeachingRunResult {
  return teachingRunResultFromWorkflowRun(services, requireTeachingWorkflowRun(services, runId));
}

export async function approveTeachingRun(
  services: GreenroomApiServices,
  runId: TeachingRunId,
): Promise<TeachingRunResult> {
  let run = requireTeachingWorkflowRun(services, runId);

  if (run.status === "completed") {
    return teachingRunResultFromWorkflowRun(services, run);
  }

  if (run.status === "queued" || run.status === "running" || run.status === "repairing") {
    return teachingRunResultFromWorkflowRun(services, run);
  }

  if (run.status === "failed") {
    throw new ApiHttpError(409, "conflict", "Failed teaching runs cannot be approved again");
  }

  if (run.status === "cancelled") {
    throw new ApiHttpError(409, "conflict", "Cancelled teaching runs cannot be approved");
  }

  const profile = requireTeachingProfile(services, run.profileId);

  if (profile.provider === "harness" && services.harnessClient === null) {
    throw new ApiHttpError(400, "bad_request", "Provider harness is not configured");
  }

  if (profile.provider !== "harness") {
    requireProvider(services, profile.provider);
  }

  if (run.status === "pending_consent") {
    recordTeachingGenerationStarted(services, run);
    run = services.workflowRunner.approveRun(run.id);
  }

  return teachingRunResultFromWorkflowRun(services, run);
}

export async function answerTeachingFollowUp(
  services: GreenroomApiServices,
  runId: TeachingRunId,
  question: string,
): Promise<TeachingFollowUpResponse> {
  const run = requireTeachingWorkflowRun(services, runId);
  const source = teachingRunResultFromWorkflowRun(services, run);

  if (source.status !== "completed" || source.output === null) {
    throw new ApiHttpError(409, "conflict", "Follow-up questions require a completed teaching run");
  }

  const profile = requireTeachingProfile(services, run.profileId);

  if (profile.provider === "harness" && services.harnessClient === null) {
    throw new ApiHttpError(400, "bad_request", "Provider harness is not configured");
  }

  if (profile.provider !== "harness") {
    requireProvider(services, profile.provider);
  }

  const followUpRun = createTeachingFollowUpWorkflowRun(services, run, question);
  const approved = services.workflowRunner.approveRun(followUpRun.id);

  return teachingFollowUpResponseSchema.parse({
    runId,
    followUpRunId: approved.id,
    status: teachingFollowUpResponseStatusFromWorkflowRun(approved),
    answer: null,
    createdAt: approved.queuedAt ?? approved.createdAt,
  });
}

export function promoteTeachingPoint(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  input: TeachingPromotionInput,
): ThreadWithComments {
  const parsed = teachingPromotionInputSchema.parse(input);
  const sourceRun = parsed.runId === undefined ? null : readTeachingRun(services, parsed.runId);

  if (parsed.anchor.reviewDisplayId !== reviewDisplayId) {
    throw new ApiHttpError(400, "bad_request", "Teaching thread review must match the route");
  }

  if (sourceRun !== null && sourceRun.reviewDisplayId !== reviewDisplayId) {
    throw new ApiHttpError(400, "bad_request", "Teaching run review must match the route");
  }

  assertTeachingAnchorTargetsChangedLine(services, parsed.anchor);

  if (sourceRun !== null) {
    assertTeachingAnchorWithinRunScope(sourceRun, parsed.anchor);
  }

  const metadata = teachingThreadSourceMetadata(parsed, sourceRun);
  const threadInput = threadCreateInputSchema.parse({
    reviewDisplayId,
    type: "question",
    severity: null,
    source: {
      kind: "teaching",
      displayName: "Teaching",
      profileId: parsed.profileId ?? sourceRun?.profileId ?? null,
      metadata,
    },
    anchor: parsed.anchor,
    firstComment: commentCreateInputSchema.omit({ threadRef: true }).parse({
      authorKind: "teaching",
      authorDisplayName: "Teaching",
      body:
        parsed.title === undefined || parsed.title === null
          ? parsed.body
          : `${parsed.title}\n\n${parsed.body}`,
    }),
  });

  return services.threads.create(threadInput);
}

export function buildTeachingContextPack(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  input: Pick<TeachingConsentCreateInput, "revisionId" | "scope" | "maxApproximateTokens">,
): TeachingContextPack {
  const review = requireTeachingReview(services, reviewDisplayId);
  const repository = requireTeachingRepository(services, review.repositoryId);
  const requestedRevisionId = input.revisionId ?? review.currentRevisionId;
  const scope = input.scope ?? { kind: "full_pr" };

  if (requestedRevisionId === null) {
    throw new ApiHttpError(404, "not_found", `Review ${reviewDisplayId} has no revision`);
  }

  const revision = services.reviews.getRevision(requestedRevisionId);

  if (revision === null || revision.reviewDisplayId !== review.displayId) {
    throw new ApiHttpError(404, "not_found", `Revision ${requestedRevisionId} was not found`);
  }

  if (scope.kind === "spotlight_view") {
    return buildSpotlightViewTeachingContextPack(services, {
      review,
      repository,
      revision,
      viewRef: scope.viewRef,
      maxApproximateTokens: input.maxApproximateTokens ?? 16_000,
    });
  }

  const files = services.reviews.listDiffFiles(revision.id);
  const maxApproximateTokens = input.maxApproximateTokens ?? 16_000;
  const selectedFiles: TeachingContextFile[] = [];
  const omittedFiles: string[] = [];
  let approximateTokenCount = approximateTokens(
    JSON.stringify({
      scope,
      review: { title: review.title },
      repository: { displayName: repository.displayName },
      revision: { baseSha: revision.baseSha, headSha: revision.headSha },
    }),
  );

  for (const file of files) {
    const contextFile = contextFileFromDiff(file);
    const nextTokenCount = approximateTokenCount + contextFile.approximateTokenCount;

    if (selectedFiles.length > 0 && nextTokenCount > maxApproximateTokens) {
      omittedFiles.push(file.path);
      continue;
    }

    selectedFiles.push(contextFile);
    approximateTokenCount = nextTokenCount;
  }

  return teachingContextPackSchema.parse({
    review,
    repository,
    revision,
    scope,
    files: selectedFiles,
    omittedFiles,
    spotlightRegions: [],
    omittedRegions: [],
    approximateTokenCount,
    generatedAt: services.clock(),
  });
}

export function buildTeachingContextPackForWorkflowRun(
  services: GreenroomApiServices,
  run: WorkflowRun,
): TeachingContextPack {
  const scopeKind = stringMetadata(run.metadata, "teachingScopeKind") ?? "full_pr";
  const maxApproximateTokens =
    numberMetadata(run.metadata, "teachingMaxApproximateContext") ?? 16_000;

  if (scopeKind === "spotlight_view") {
    const viewRef = stringMetadata(run.metadata, "spotlightViewRef");

    if (viewRef === null) {
      throw new Error(`Teaching workflow ${run.id} is missing spotlightViewRef metadata`);
    }

    return buildTeachingContextPack(services, run.reviewDisplayId, {
      revisionId: run.revisionId,
      scope: { kind: "spotlight_view", viewRef },
      maxApproximateTokens,
    });
  }

  return buildTeachingContextPack(services, run.reviewDisplayId, {
    revisionId: run.revisionId,
    scope: { kind: "full_pr" },
    maxApproximateTokens,
  });
}

interface BuildSpotlightViewTeachingContextInput {
  review: ReviewPr;
  repository: Repository;
  revision: TeachingContextPack["revision"];
  viewRef: SpotlightViewRef;
  maxApproximateTokens: number;
}

interface SpotlightTeachingFileCandidate {
  file: DiffFile;
  contextFile: TeachingContextFile;
  regions: TeachingContextSpotlightRegion[];
}

function buildSpotlightViewTeachingContextPack(
  services: GreenroomApiServices,
  input: BuildSpotlightViewTeachingContextInput,
): TeachingContextPack {
  if (input.review.currentRevisionId !== input.revision.id) {
    throw new ApiHttpError(
      409,
      "conflict",
      "Spotlight View teaching requires the current revision",
    );
  }

  const view = services.spotlight.getViewWithRegionsByRef(input.viewRef);

  if (view === null || view.reviewDisplayId !== input.review.displayId) {
    throw new ApiHttpError(404, "not_found", `Spotlight view ${input.viewRef} was not found`);
  }

  const scope = {
    kind: "spotlight_view" as const,
    viewRef: view.displayRef,
    title: view.title,
    health: view.health,
  };
  const files = services.reviews.listDiffFiles(input.revision.id);
  const filesByKey = new Map(files.map((file) => [teachingFileKey(file.path, file.oldPath), file]));
  const regionsByFile = new Map<string, TeachingContextSpotlightRegion[]>();
  const omittedRegions: TeachingContextOmittedRegion[] = [];

  for (const region of view.regions) {
    const currentAnchors = uniqueTeachingAnchors(
      region.anchors.filter((anchor) => anchor.revisionId === input.revision.id),
    );
    const regionSummary = {
      filePath: region.filePath,
      oldPath: region.oldPath,
      anchors: currentAnchors,
    };

    if (currentAnchors.length === 0) {
      omittedRegions.push({
        filePath: region.filePath,
        oldPath: region.oldPath,
        anchorCount: Math.max(1, region.anchors.length),
      });
      continue;
    }

    const key = teachingFileKey(region.filePath, region.oldPath);

    if (!filesByKey.has(key)) {
      omittedRegions.push({
        filePath: region.filePath,
        oldPath: region.oldPath,
        anchorCount: currentAnchors.length,
      });
      continue;
    }

    regionsByFile.set(key, [...(regionsByFile.get(key) ?? []), regionSummary]);
  }

  const candidates: SpotlightTeachingFileCandidate[] = [];

  for (const file of files) {
    const key = teachingFileKey(file.path, file.oldPath);
    const regions = regionsByFile.get(key) ?? [];

    if (regions.length === 0) {
      continue;
    }

    const anchors = regions.flatMap((region) => region.anchors);
    const relevantHunks = file.isBinary
      ? []
      : file.hunks.filter((hunk) =>
          anchors.some((anchor) => teachingHunkContainsAnchor(hunk, anchor)),
        );

    if (!file.isBinary && relevantHunks.length === 0) {
      omittedRegions.push(
        ...regions.map((region) => ({
          filePath: region.filePath,
          oldPath: region.oldPath,
          anchorCount: region.anchors.length,
        })),
      );
      continue;
    }

    candidates.push({
      file,
      contextFile: contextFileFromDiff(file, relevantHunks),
      regions,
    });
  }

  const selectedFiles: TeachingContextFile[] = [];
  const selectedRegions: TeachingContextSpotlightRegion[] = [];
  const omittedFiles: string[] = [];
  let approximateTokenCount = approximateTokens(
    JSON.stringify({
      scope,
      review: { title: input.review.title },
      repository: { displayName: input.repository.displayName },
      revision: { baseSha: input.revision.baseSha, headSha: input.revision.headSha },
    }),
  );

  for (const candidate of candidates) {
    const regionTokenCount = approximateTokens(JSON.stringify(candidate.regions));
    const nextTokenCount =
      approximateTokenCount + candidate.contextFile.approximateTokenCount + regionTokenCount;

    if (selectedFiles.length > 0 && nextTokenCount > input.maxApproximateTokens) {
      omittedFiles.push(candidate.file.path);
      omittedRegions.push(
        ...candidate.regions.map((region) => ({
          filePath: region.filePath,
          oldPath: region.oldPath,
          anchorCount: region.anchors.length,
        })),
      );
      continue;
    }

    selectedFiles.push(candidate.contextFile);
    selectedRegions.push(...candidate.regions);
    approximateTokenCount = nextTokenCount;
  }

  return teachingContextPackSchema.parse({
    review: input.review,
    repository: input.repository,
    revision: input.revision,
    scope,
    files: selectedFiles,
    omittedFiles,
    spotlightRegions: selectedRegions,
    omittedRegions,
    approximateTokenCount,
    generatedAt: services.clock(),
  });
}

export function createMockTeachingProvider(): TeachingProvider {
  return {
    kind: "mock",
    async generateTeaching(request) {
      const firstFile = request.context.files[0] ?? null;
      const firstAnchor =
        firstFile === null ? null : firstAnchorForFile(request.context, firstFile);

      return structuredTeachingOutputSchema.parse({
        changeSummary: `Mock teaching summary for ${request.context.review.title}.`,
        architectureExplanation:
          "This review changes local code paths. Trace the changed files first, then connect each hunk to the surrounding workflow.",
        walkthrough: [
          {
            id: "walkthrough-1",
            title: firstFile === null ? "Review shape" : firstFile.path,
            body:
              firstFile === null
                ? "There are no textual hunks in the selected context."
                : `Read ${firstFile.path} by checking the changed lines before generalizing the design intent.`,
            filePath: firstFile?.path ?? null,
            lineNumber: firstAnchor?.lineNumber ?? null,
            anchor: firstAnchor,
          },
        ],
        quiz: [
          {
            id: "quiz-1",
            prompt: "What should you inspect first when learning from a code review diff?",
            choices: [
              { id: "changed-lines", label: "The changed lines and nearby context" },
              { id: "unrelated-files", label: "Unrelated files outside the review" },
            ],
            correctChoiceId: "changed-lines",
            explanation:
              "Changed lines and nearby context explain the behavior under review without widening scope too early.",
            missedConcept: "Start from the scoped diff context.",
            anchor: firstAnchor,
          },
        ],
        missedConcepts: ["Start from the scoped diff context."],
      });
    },
    async answerFollowUp(request) {
      return `Mock follow-up answer scoped to ${request.context.review.title}: ${request.question}`;
    },
  };
}

function createTeachingGenerateWorkflowRun(
  services: GreenroomApiServices,
  profile: Profile,
  context: TeachingContextPack,
  input: Pick<
    CreateTeachingConsentRequest,
    "maxApproximateTokens" | "scope" | "reviewDisplayId" | "start"
  >,
): WorkflowRun {
  const harnessKind = harnessKindForTeachingProfile(profile);
  const changedFiles = workflowChangedFilesForTeachingContext(context);
  const allowedMcpCapabilities = teachingWorkflowMcpCapabilities(context);
  const expectedMcpResources = teachingWorkflowExpectedMcpResources(context);
  const repositoryAccess = workflowRepositoryAccessSummaryForProfile({
    profile,
    repository: context.repository,
    revision: context.revision,
  });

  return services.workflowRunner.createRun({
    run: {
      workflowKind: "teaching_generate",
      revisionId: context.revision.id,
      profileId: profile.id,
      harnessKind,
      consentSummary: {
        workflowKind: "teaching_generate",
        selectedHarness: harnessKind,
        profile: {
          id: profile.id,
          name: profile.name,
          workflowType: profile.workflowType,
          provider: profile.provider,
          model: profile.model,
        },
        reviewDisplayId: context.review.displayId,
        revisionId: context.revision.id,
        scopeLabel: teachingScopeLabel(context),
        changedFiles,
        allowedMcpCapabilities,
        expectedMcpResources,
        expectedOutputMode: "teaching_draft",
        repositoryAccess,
        threadCreationGate: null,
        tracingStatus: "disabled",
      },
      metadata: {
        workflowFamily: "teaching",
        teachingApiVersion: 2,
        ...workflowRepositoryAccessMetadata(repositoryAccess),
        consentMode: consentModeForRequest(input.start === true, profile),
        teachingScopeKind: context.scope.kind,
        teachingMaxApproximateContext: input.maxApproximateTokens ?? 16_000,
        contextApproximateSize: context.approximateTokenCount,
        omittedFiles: context.omittedFiles,
        omittedRegionCount: context.omittedRegions.length,
        spotlightRegionCount: context.spotlightRegions.length,
        allowedMcpCapabilities,
        expectedMcpResources,
        changedFileManifest: changedFiles.files,
        ...(context.scope.kind === "spotlight_view"
          ? {
              spotlightViewRef: context.scope.viewRef,
              spotlightViewTitle: context.scope.title,
              spotlightViewHealth: context.scope.health,
            }
          : {}),
      },
    },
  });
}

function createTeachingFollowUpWorkflowRun(
  services: GreenroomApiServices,
  sourceRun: WorkflowRun,
  question: string,
): WorkflowRun {
  const metadata = teachingScopeMetadataForFollowUp(sourceRun);

  return services.workflowRunner.createRun({
    run: {
      workflowKind: "teaching_follow_up",
      revisionId: sourceRun.revisionId,
      profileId: sourceRun.profileId,
      harnessKind: sourceRun.harnessKind,
      consentSummary: {
        ...sourceRun.consentSummary,
        workflowKind: "teaching_follow_up",
        expectedOutputMode: "teaching_follow_up_answer",
        threadCreationGate: null,
      },
      metadata: {
        workflowFamily: "teaching",
        teachingApiVersion: 2,
        teachingStage: "follow_up",
        originalTeachingRunId: sourceRun.id,
        teachingFollowUpQuestion: question,
        ...workflowRepositoryAccessMetadata(sourceRun.consentSummary.repositoryAccess),
        ...metadata,
      },
    },
  });
}

function teachingRunResultFromWorkflowRun(
  services: GreenroomApiServices,
  run: WorkflowRun,
): TeachingRunResult {
  const output = run.validationIssues.some((issue) => issue.severity === "error")
    ? null
    : teachingOutputFromDraft(run.finalOutput ?? run.draftOutput);

  return teachingRunResultSchema.parse({
    id: run.id,
    reviewDisplayId: run.reviewDisplayId,
    profileId: run.profileId,
    status: teachingStatusFromWorkflowRun(run),
    context: buildTeachingContextPackForWorkflowRun(services, run),
    createdAt: run.createdAt,
    approvedAt: run.queuedAt,
    completedAt: run.completedAt,
    errorMessage: run.errorMessage,
    output,
  });
}

function teachingStatusFromWorkflowRun(run: WorkflowRun): TeachingRunResult["status"] {
  switch (run.status) {
    case "pending_consent":
      return "pending_consent";
    case "queued":
    case "running":
    case "repairing":
    case "awaiting_user":
      return "approved";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
  }
}

function teachingFollowUpResponseStatusFromWorkflowRun(
  run: WorkflowRun,
): "pending" | "queued" | "running" | "repairing" | "completed" | "failed" | "cancelled" {
  switch (run.status) {
    case "pending_consent":
      return "pending";
    case "queued":
    case "running":
    case "repairing":
    case "completed":
    case "failed":
    case "cancelled":
      return run.status;
    case "awaiting_user":
      return "running";
  }
}

function requireTeachingWorkflowRun(
  services: GreenroomApiServices,
  runId: TeachingRunId,
): WorkflowRun {
  const run = services.workflowRunner.readRun(runId as WorkflowRunId);

  if (run === null || run.workflowKind !== "teaching_generate") {
    throw new ApiHttpError(404, "not_found", `Teaching run ${runId} was not found`);
  }

  return run;
}

function teachingOutputFromDraft(
  draft: WorkflowRun["draftOutput"] | WorkflowRun["finalOutput"],
): StructuredTeachingOutput | null {
  if (draft === null || draft.kind !== "teaching_draft") {
    return null;
  }

  return structuredTeachingOutputSchema.parse(draft);
}

function recordTeachingGenerationStarted(services: GreenroomApiServices, run: WorkflowRun): void {
  services.workflows.recordEvent({
    runId: run.id,
    eventType: "lifecycle",
    summary: "Teaching generation started.",
    metadata: {
      workflowKind: run.workflowKind,
      profileId: run.profileId,
      harnessKind: run.harnessKind,
      scopeLabel: run.consentSummary.scopeLabel,
    },
  });
  services.agentEvents.create({
    reviewDisplayId: run.reviewDisplayId,
    eventType: "status_update",
    source: {
      kind: "system",
      displayName: "Stage Manager",
      metadata: {
        workflowType: "teaching",
        workflowRunId: run.id,
      },
    },
    threadRefs: [],
    summary: "Teaching run started",
    metadata: {
      workflowRunId: run.id,
      profileId: run.profileId,
      harnessKind: run.harnessKind,
    },
  });
}

function workflowChangedFilesForTeachingContext(
  context: TeachingContextPack,
): WorkflowChangedFileSummary {
  const files = context.files;

  return {
    fileCount: files.length + context.omittedFiles.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    binaryFileCount: files.filter((file) => file.isBinary).length,
    renameCount: files.filter((file) => file.status === "renamed").length,
    files: files.slice(0, 250).map((file) => ({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      isBinary: file.isBinary,
    })),
    omittedFileCount: Math.max(0, context.omittedFiles.length + Math.max(0, files.length - 250)),
  };
}

function teachingWorkflowMcpCapabilities(context: TeachingContextPack): WorkflowMcpCapability[] {
  const capabilities: WorkflowMcpCapability[] = [
    "review:read",
    "revision:read",
    "diff:read",
    "threads:read",
    "teaching:read",
    "draft:submit",
    "validation:read",
  ];

  if (context.scope.kind === "spotlight_view") {
    capabilities.push("spotlight:read");
  }

  return capabilities;
}

function teachingWorkflowExpectedMcpResources(context: TeachingContextPack): string[] {
  const review = context.review.displayId;
  const resources = [
    "greenroom://concepts/review-model",
    "greenroom://concepts/anchors",
    "greenroom://concepts/teaching",
    `greenroom://reviews/${review}/manifest`,
    `greenroom://reviews/${review}/diff-summary`,
    `greenroom://reviews/${review}/files`,
    `greenroom://reviews/${review}/files/{path}`,
    `greenroom://reviews/${review}/anchors/{path}`,
    `greenroom://reviews/${review}/threads`,
    "greenroom://runs/{runId}/instructions",
    "greenroom://runs/{runId}/output-schema",
    "greenroom://runs/{runId}/consent-scope",
    "greenroom://runs/{runId}/validation-errors",
  ];

  if (context.scope.kind === "spotlight_view") {
    resources.push(`greenroom://reviews/${review}/spotlight/views`);
  }

  return resources;
}

function teachingScopeLabel(context: TeachingContextPack): string {
  if (context.scope.kind === "spotlight_view") {
    return `Spotlight View: ${context.scope.title}`;
  }

  if (context.files.length === 0) {
    return "Full PR";
  }

  if (context.omittedFiles.length === 0) {
    return `Full PR: ${context.files.length} changed file${context.files.length === 1 ? "" : "s"}`;
  }

  return `Full PR: ${context.files.length} selected file${context.files.length === 1 ? "" : "s"}, ${context.omittedFiles.length} omitted`;
}

function teachingScopeMetadataForFollowUp(run: WorkflowRun): WorkflowRedactedMetadata {
  return {
    teachingScopeKind: stringMetadata(run.metadata, "teachingScopeKind") ?? "full_pr",
    teachingMaxApproximateContext:
      numberMetadata(run.metadata, "teachingMaxApproximateContext") ?? 16_000,
    contextApproximateSize: numberMetadata(run.metadata, "contextApproximateSize") ?? null,
    omittedFiles: stringArrayMetadata(run.metadata.omittedFiles),
    omittedRegionCount: numberMetadata(run.metadata, "omittedRegionCount") ?? 0,
    spotlightRegionCount: numberMetadata(run.metadata, "spotlightRegionCount") ?? 0,
    ...(stringMetadata(run.metadata, "spotlightViewRef") === null
      ? {}
      : {
          spotlightViewRef: stringMetadata(run.metadata, "spotlightViewRef"),
          spotlightViewTitle: stringMetadata(run.metadata, "spotlightViewTitle"),
          spotlightViewHealth: stringMetadata(run.metadata, "spotlightViewHealth"),
        }),
  };
}

function harnessKindForTeachingProfile(profile: Profile): string {
  if (profile.provider === "harness") {
    const harnessSettings = profile.modelSettings.harness;

    if (
      typeof harnessSettings === "object" &&
      harnessSettings !== null &&
      "kind" in harnessSettings &&
      typeof harnessSettings.kind === "string" &&
      harnessSettings.kind.trim().length > 0
    ) {
      return harnessSettings.kind;
    }
  }

  return profile.model;
}

function requireTeachingProfile(services: GreenroomApiServices, profileId: Profile["id"]): Profile {
  const profile = services.profiles.get(profileId);

  if (profile === null) {
    throw new ApiHttpError(404, "not_found", `Profile ${profileId} was not found`);
  }

  if (profile.workflowType !== "teaching") {
    throw new ApiHttpError(400, "bad_request", "Teaching runs require a teaching profile");
  }

  return profile;
}

function requireTeachingReview(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
): StoredReviewPr {
  const review = services.reviews.getByDisplayId(reviewDisplayId);

  if (review === null) {
    throw new ApiHttpError(404, "not_found", `Review ${reviewDisplayId} was not found`);
  }

  return review;
}

function requireTeachingRepository(
  services: GreenroomApiServices,
  repositoryId: RepositoryId,
): Repository {
  const repository = services.repositories.get(repositoryId);

  if (repository === null) {
    throw new ApiHttpError(404, "not_found", `Repository ${repositoryId} was not found`);
  }

  return repository;
}

function assertTeachingAnchorTargetsChangedLine(
  services: GreenroomApiServices,
  anchor: ThreadAnchor,
): void {
  const review = requireTeachingReview(services, anchor.reviewDisplayId);
  const revision = services.reviews.getRevision(anchor.revisionId);

  if (revision === null || revision.reviewDisplayId !== review.displayId) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor revision does not belong to review");
  }

  if (review.currentRevisionId !== revision.id) {
    throw new ApiHttpError(409, "conflict", "Thread anchors must target the current revision");
  }

  const file = services.reviews
    .listDiffFiles(revision.id)
    .find(
      (candidate) =>
        candidate.path === anchor.filePath && (candidate.oldPath ?? null) === anchor.oldFilePath,
    );

  if (file === undefined) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor file was not found in the diff");
  }

  const hunk =
    anchor.hunkId === null
      ? file.hunks.find((candidate) =>
          candidate.lines.some((line) => teachingLineTargetsAnchor(line, anchor)),
        )
      : file.hunks.find((candidate) => candidate.id === anchor.hunkId);

  if (hunk === undefined) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor hunk was not found in the diff");
  }

  const line = hunk.lines.find((candidate) => teachingLineTargetsAnchor(candidate, anchor));

  if (line === undefined) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor must target a changed diff line");
  }
}

function assertTeachingAnchorWithinRunScope(run: TeachingRunResult, anchor: ThreadAnchor): void {
  if (run.context.scope.kind !== "spotlight_view") {
    return;
  }

  const allowed = new Set(
    run.context.spotlightRegions.flatMap((region) =>
      region.anchors.map((candidate) => teachingAnchorLineKey(candidate)),
    ),
  );

  if (!allowed.has(teachingAnchorLineKey(anchor))) {
    throw new ApiHttpError(
      400,
      "bad_request",
      "Teaching point anchor is outside the approved Spotlight View scope",
    );
  }
}

function teachingLineTargetsAnchor(
  line: DiffFile["hunks"][number]["lines"][number],
  anchor: ThreadAnchor,
): boolean {
  if (line.type !== anchor.lineType) {
    return false;
  }

  if (anchor.side === "head") {
    return line.type === "addition" && line.newLineNumber === anchor.lineNumber;
  }

  return line.type === "deletion" && line.oldLineNumber === anchor.lineNumber;
}

function requireProvider(services: GreenroomApiServices, provider: ProviderKind): TeachingProvider {
  const teachingProvider = services.providers[provider];

  if (teachingProvider === undefined) {
    throw new ApiHttpError(400, "bad_request", `Provider ${provider} is not configured`);
  }

  return teachingProvider;
}

function teachingThreadSourceMetadata(
  parsed: TeachingPromotionInput,
  sourceRun: TeachingRunResult | null,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (parsed.title !== undefined && parsed.title !== null) {
    metadata.title = parsed.title;
  }

  if (sourceRun !== null) {
    metadata.teachingRunId = sourceRun.id;
    metadata.workflowRunId = sourceRun.id;

    if (sourceRun.context.scope.kind === "spotlight_view") {
      metadata.spotlightViewRef = sourceRun.context.scope.viewRef;
      metadata.spotlightViewTitle = sourceRun.context.scope.title;
      metadata.spotlightViewHealth = sourceRun.context.scope.health;
    }
  }

  return metadata;
}

function contextFileFromDiff(
  file: DiffFile,
  hunks: readonly DiffFile["hunks"][number][] = file.hunks,
): TeachingContextFile {
  const contextFile = {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    isBinary: file.isBinary,
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.isBinary
      ? []
      : hunks.map((hunk) => ({
          header: hunk.header,
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          lines: hunk.lines,
        })),
    approximateTokenCount: 0,
  };

  return {
    ...contextFile,
    approximateTokenCount: approximateTokens(JSON.stringify(contextFile)),
  };
}

function firstAnchorForFile(context: TeachingContextPack, file: TeachingContextFile) {
  for (const hunk of file.hunks) {
    for (let index = 0; index < hunk.lines.length; index += 1) {
      const line = hunk.lines[index];

      if (line === undefined) {
        continue;
      }

      if (line.type === "addition" && line.newLineNumber !== null) {
        return {
          reviewDisplayId: context.review.displayId,
          revisionId: context.revision.id,
          filePath: file.path,
          oldFilePath: file.oldPath,
          side: "head" as const,
          lineNumber: line.newLineNumber,
          lineType: line.type,
          hunkId: null,
          hunkHeader: hunk.header,
          contextBefore: hunk.lines
            .slice(Math.max(0, index - 3), index)
            .map((candidate) => candidate.content),
          contextAfter: hunk.lines
            .slice(index + 1, index + 4)
            .map((candidate) => candidate.content),
          originalLineText: line.content,
        };
      }

      if (line.type === "deletion" && line.oldLineNumber !== null) {
        return {
          reviewDisplayId: context.review.displayId,
          revisionId: context.revision.id,
          filePath: file.path,
          oldFilePath: file.oldPath,
          side: "base" as const,
          lineNumber: line.oldLineNumber,
          lineType: line.type,
          hunkId: null,
          hunkHeader: hunk.header,
          contextBefore: hunk.lines
            .slice(Math.max(0, index - 3), index)
            .map((candidate) => candidate.content),
          contextAfter: hunk.lines
            .slice(index + 1, index + 4)
            .map((candidate) => candidate.content),
          originalLineText: line.content,
        };
      }
    }
  }

  return null;
}

function teachingFileKey(filePath: string, oldPath: string | null): string {
  return `${filePath}\0${oldPath ?? ""}`;
}

function uniqueTeachingAnchors(anchors: readonly ThreadAnchor[]): ThreadAnchor[] {
  const seen = new Set<string>();
  const unique: ThreadAnchor[] = [];

  for (const anchor of anchors) {
    const key = teachingAnchorKey(anchor);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(anchor);
  }

  return unique;
}

function teachingAnchorKey(anchor: ThreadAnchor): string {
  return [
    anchor.reviewDisplayId,
    anchor.revisionId,
    anchor.filePath,
    anchor.oldFilePath ?? "",
    anchor.side,
    anchor.lineType,
    anchor.lineNumber,
    anchor.hunkId ?? "",
  ].join("\0");
}

function teachingHunkContainsAnchor(
  hunk: DiffFile["hunks"][number],
  anchor: ThreadAnchor,
): boolean {
  return hunk.lines.some((line) => teachingLineTargetsAnchor(line, anchor));
}

function approximateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function stringMetadata(metadata: WorkflowRedactedMetadata, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberMetadata(metadata: WorkflowRedactedMetadata, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayMetadata(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === "string")
    : [];
}

function teachingAnchorLineKey(anchor: ThreadAnchor): string {
  return threadAnchorLineKey(anchor);
}

const threadAnchorJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "reviewDisplayId",
    "revisionId",
    "filePath",
    "oldFilePath",
    "side",
    "lineNumber",
    "lineType",
    "hunkId",
    "hunkHeader",
    "contextBefore",
    "contextAfter",
    "originalLineText",
  ],
  properties: {
    reviewDisplayId: { type: "string" },
    revisionId: { type: "string" },
    filePath: { type: "string" },
    oldFilePath: { type: ["string", "null"] },
    side: { type: "string", enum: ["base", "head"] },
    lineNumber: { type: "integer" },
    lineType: { type: "string", enum: ["addition", "deletion"] },
    hunkId: { type: ["string", "null"] },
    hunkHeader: { type: ["string", "null"] },
    contextBefore: { type: "array", items: { type: "string" } },
    contextAfter: { type: "array", items: { type: "string" } },
    originalLineText: { type: ["string", "null"] },
  },
};

const teachingExcerptRefJsonSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "anchor"],
      properties: {
        kind: { type: "string", enum: ["anchor"] },
        anchor: threadAnchorJsonSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "filePath", "side", "startLine", "endLine"],
      properties: {
        kind: { type: "string", enum: ["lines"] },
        filePath: { type: "string" },
        side: { type: "string", enum: ["base", "head"] },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
    },
  ],
};

const teachingDiagramJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "mermaidSource"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    mermaidSource: { type: "string" },
  },
};

export const structuredTeachingOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "changeSummary",
    "architectureExplanation",
    "walkthrough",
    "quiz",
    "missedConcepts",
    "diagrams",
  ],
  properties: {
    changeSummary: { type: "string" },
    architectureExplanation: { type: "string" },
    walkthrough: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "body",
          "filePath",
          "lineNumber",
          "anchor",
          "excerpts",
          "diagramId",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          filePath: { type: ["string", "null"] },
          lineNumber: { type: ["integer", "null"] },
          anchor: { anyOf: [{ type: "null" }, threadAnchorJsonSchema] },
          excerpts: { type: "array", items: teachingExcerptRefJsonSchema },
          diagramId: { type: ["string", "null"] },
        },
      },
    },
    quiz: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "prompt",
          "choices",
          "correctChoiceId",
          "explanation",
          "missedConcept",
          "anchor",
          "excerpts",
        ],
        properties: {
          id: { type: "string" },
          prompt: { type: "string" },
          choices: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
              },
            },
          },
          correctChoiceId: { type: "string" },
          explanation: { type: "string" },
          missedConcept: { type: "string" },
          anchor: { anyOf: [{ type: "null" }, threadAnchorJsonSchema] },
          excerpts: { type: "array", items: teachingExcerptRefJsonSchema },
        },
      },
    },
    missedConcepts: {
      type: "array",
      items: { type: "string" },
    },
    diagrams: {
      type: "array",
      items: teachingDiagramJsonSchema,
    },
  },
};

export const teachingFollowUpJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string" },
  },
};
