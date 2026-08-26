import * as z from "zod";

import {
  profileIdSchema,
  spotlightApprovedOutlineSchema,
  spotlightRunCreateInputSchema,
  spotlightRunIdSchema,
  spotlightRunSchema,
  spotlightViewRefSchema,
  workflowSpotlightMembershipDraftOutputSchema,
  workflowSpotlightOutlineDraftOutputSchema,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type Profile,
  type ProviderKind,
  type Repository,
  type ReviewDisplayId,
  type ReviewPr,
  type RevisionId,
  type RevisionSnapshot,
  type SpotlightApprovedOutline,
  type SpotlightRun,
  type SpotlightRunId,
  type SpotlightView,
  type SpotlightViewRef,
  type SpotlightViewReference,
  type SpotlightViewRegion,
  type SpotlightViewWithRegions,
  type ThreadAnchor,
  type WorkflowChangedFileSummary,
  type WorkflowExpectedOutputMode,
  type WorkflowKind,
  type WorkflowMcpCapability,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
  type WorkflowRunId,
  type WorkflowSpotlightMembershipDraftOutput,
  type WorkflowSpotlightOutlineDraftOutput,
} from "@greenroom/schemas";
import { threadAnchorLineKey as anchorLineKey, type StoredReviewPr } from "@greenroom/core";

import type { CreateSpotlightRegionForViewInput } from "../storage/spotlight";
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

export interface SpotlightProviderRequest {
  runId: SpotlightRunId;
  operation: SpotlightRun["type"];
  profile: Profile;
  repository: Repository;
  review: StoredReviewPr;
  revision: RevisionSnapshot;
  files: DiffFile[];
  approvedOutline: SpotlightApprovedOutline | null;
  existingViews: SpotlightViewWithRegions[];
  targetView: SpotlightViewWithRegions | null;
}

export interface SpotlightRefinePlanProviderRequest extends SpotlightProviderRequest {
  currentOutline: SpotlightApprovedOutline;
  instruction: string;
  conversation: SpotlightPlanConversationTurn[];
}

export interface SpotlightGeneratedView {
  title: string;
  description: string;
  intent: string;
  orderIndex: number;
  regions: CreateSpotlightRegionForViewInput[];
}

export interface SpotlightProvider {
  readonly kind: ProviderKind;
  planViews: (request: SpotlightProviderRequest) => Promise<SpotlightApprovedOutline>;
  refinePlan: (request: SpotlightRefinePlanProviderRequest) => Promise<SpotlightApprovedOutline>;
  generateViews: (request: SpotlightProviderRequest) => Promise<SpotlightGeneratedView[]>;
}

export type SpotlightProviderRegistry = Partial<Record<ProviderKind, SpotlightProvider>>;

export interface SpotlightPlanConversationTurn {
  instruction: string;
  outline: SpotlightApprovedOutline;
  createdAt: string;
}

export interface SpotlightPlanState {
  outline: SpotlightApprovedOutline;
  workflowOutline?: WorkflowSpotlightOutlineDraftOutput["views"];
  conversation: SpotlightPlanConversationTurn[];
  targetViewId?: SpotlightViewRef | null;
  planWorkflowRunId?: WorkflowRunId | null;
  latestWorkflowRunId?: WorkflowRunId | null;
}

export interface SpotlightRunContextSummary {
  review: {
    displayId: ReviewPr["displayId"];
    title: string;
  };
  revision: {
    id: RevisionId;
    baseSha: string;
    headSha: string | null;
  };
  profile: {
    id: Profile["id"];
    name: string;
    provider: ProviderKind;
    model: string;
  };
  files: Array<{
    path: string;
    oldPath: string | null;
    status: DiffFile["status"];
    additions: number;
    deletions: number;
    hunkCount: number;
    changedLineCount: number;
  }>;
  fileCount: number;
  hunkCount: number;
  changedLineCount: number;
  approximateTokenCount: number;
}

export type SpotlightRunResource = SpotlightRun & {
  pendingOutline: SpotlightApprovedOutline | null;
  contextSummary: SpotlightRunContextSummary;
  refinementCount: number;
};

export const spotlightRunRequestSchema = spotlightRunCreateInputSchema
  .omit({
    reviewDisplayId: true,
    status: true,
    approvedOutline: true,
    errorMessage: true,
  })
  .extend({
    targetViewId: spotlightViewRefSchema.optional(),
    confirmed: z.boolean().optional(),
    start: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.trigger !== "manual") {
      context.addIssue({
        code: "custom",
        message: "Spotlight v1 currently supports manual runs",
        path: ["trigger"],
      });
    }

    if (value.type === "refine_view" && value.targetViewId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Refine-this-View runs require targetViewId",
        path: ["targetViewId"],
      });
    }

    if (value.type !== "refine_view" && value.targetViewId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "targetViewId is only valid for refine-this-View runs",
        path: ["targetViewId"],
      });
    }

    if (value.type === "regenerate" && value.confirmed !== true) {
      context.addIssue({
        code: "custom",
        message: "Regenerate fresh requires explicit confirmation",
        path: ["confirmed"],
      });
    }
  });

export type SpotlightRunRequest = z.infer<typeof spotlightRunRequestSchema>;

export interface AssociatedSpotlightFile {
  path: string;
  oldPath: string | null;
}

export type SpotlightViewResource = SpotlightView & {
  associatedFiles: AssociatedSpotlightFile[];
};

export type SpotlightViewWithRegionsResource = SpotlightViewResource & {
  regions: SpotlightViewRegion[];
};

export interface SpotlightViewDiffResource {
  view: SpotlightViewResource;
  revision: RevisionSnapshot;
  files: DiffFile[];
  regions: SpotlightViewRegion[];
}

export interface SpotlightCoverageResource {
  reviewDisplayId: ReviewDisplayId;
  revisionId: RevisionId;
  unlitAnchors: ThreadAnchor[];
}

export interface SpotlightLineMembershipResource {
  reviewDisplayId: ReviewDisplayId;
  revisionId: RevisionId;
  memberships: Array<{
    anchor: ThreadAnchor;
    views: SpotlightViewResource[];
  }>;
}

export function createDefaultSpotlightProviders(): SpotlightProviderRegistry {
  return {
    mock: createMockSpotlightProvider("mock"),
  };
}

export function createMockSpotlightProvider(kind: ProviderKind = "mock"): SpotlightProvider {
  return {
    kind,
    async planViews(request) {
      return mockPlanOutline(request);
    },
    async refinePlan(request) {
      if (request.currentOutline.length === 0) {
        return request.currentOutline;
      }

      return request.currentOutline.map((item, index) =>
        index === 0
          ? {
              ...item,
              description: truncateDescription(
                `${item.description} Refined with: ${request.instruction}`,
                1000,
              ),
            }
          : item,
      );
    },
    async generateViews(request) {
      const views = mockBucketViews(request);

      if (request.approvedOutline === null) {
        return views;
      }

      return request.approvedOutline.map((outline, index) => {
        const generated = findGeneratedViewForOutline(views, outline, index);

        return {
          title: outline.title,
          description: outline.description,
          intent: outline.intent,
          orderIndex: index,
          regions: generated?.regions ?? [],
        };
      });
    },
  };
}

function mockPlanOutline(request: SpotlightProviderRequest): SpotlightApprovedOutline {
  if (request.operation === "refine_view" && request.targetView !== null) {
    return [outlineItemForView(request.targetView)];
  }

  const generated = mockBucketViews(request).map((view) => ({
    title: view.title,
    intent: view.intent,
    description: view.description,
  }));

  if (request.operation !== "update" || request.existingViews.length === 0) {
    return generated;
  }

  const existing = request.existingViews.map(outlineItemForView);
  const existingKeys = new Set(existing.map(outlineMatchKey));
  const additions = generated.filter((outline) => !existingKeys.has(outlineMatchKey(outline)));

  return [...existing, ...additions];
}

function findGeneratedViewForOutline(
  generatedViews: readonly SpotlightGeneratedView[],
  outline: SpotlightApprovedOutline[number],
  index: number,
): SpotlightGeneratedView | undefined {
  const title = normalizeViewMatchText(outline.title);
  const intent = normalizeViewMatchText(outline.intent);

  return (
    generatedViews.find(
      (view) =>
        normalizeViewMatchText(view.title) === title &&
        normalizeViewMatchText(view.intent) === intent,
    ) ??
    generatedViews.find((view) => normalizeViewMatchText(view.title) === title) ??
    generatedViews.find((view) => normalizeViewMatchText(view.intent) === intent) ??
    generatedViews[index]
  );
}

function outlineMatchKey(outline: SpotlightApprovedOutline[number]): string {
  return `${normalizeViewMatchText(outline.title)}\0${normalizeViewMatchText(outline.intent)}`;
}

function mockBucketViews(request: SpotlightProviderRequest): SpotlightGeneratedView[] {
  const buckets = new Map<SpotlightBucketKey, BucketedAnchor[]>();

  for (const file of request.files) {
    const bucket = bucketForFile(file);
    const anchors = changedLineAnchors(request.review.displayId, request.revision.id, file);

    if (anchors.length === 0) {
      continue;
    }

    const bucketed = buckets.get(bucket.key) ?? [];
    bucketed.push({ file, anchors });
    buckets.set(bucket.key, bucketed);
  }

  const views: SpotlightGeneratedView[] = [];

  for (const bucket of spotlightBuckets) {
    const files = buckets.get(bucket.key) ?? [];

    if (files.length === 0) {
      continue;
    }

    views.push({
      title: bucket.title,
      description: `${bucket.description} Covers ${files.length} ${pluralize("file", files.length)} in ${request.review.title}.`,
      intent: bucket.intent,
      orderIndex: views.length,
      regions: files.flatMap((entry) => regionsForFile(entry.file, entry.anchors)),
    });
  }

  return views;
}

export async function createSpotlightRun(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  input: SpotlightRunRequest,
): Promise<SpotlightRunResource> {
  const parsed = spotlightRunRequestSchema.parse(input);
  const review = requireSpotlightReview(services, reviewDisplayId);
  const revision = requireSpotlightRevision(services, review, parsed.revisionId);

  if (review.currentRevisionId !== revision.id) {
    throw new ApiHttpError(409, "conflict", "Spotlight runs must target the current revision");
  }

  if (parsed.type === "update" && services.spotlight.listViewsByReview(review.id).length === 0) {
    throw new ApiHttpError(409, "conflict", "Update Views requires existing Spotlight views");
  }

  if (parsed.type === "refine_view") {
    requireSpotlightView(services, review.displayId, parsed.targetViewId!);
  }

  const profile = requireSpotlightProfile(services, parsed.profileId);
  const start = parsed.start === true;

  if (start) {
    assertProfileAllowsOneClickConsent(profile);
  }

  const run = services.spotlight.createRun({
    reviewDisplayId: review.displayId,
    type: parsed.type,
    trigger: parsed.trigger,
    gated: parsed.gated,
    status: "pending_consent",
    revisionId: revision.id,
    profileId: profile.id,
  });

  const planWorkflow = createSpotlightWorkflowRun(services, run, "spotlight_plan", {
    consentMode: consentModeForRequest(start, profile),
    ...(parsed.targetViewId === undefined ? {} : { targetViewId: parsed.targetViewId }),
  });
  services.spotlightPlanStates.set(run.id, {
    outline: [],
    workflowOutline: [],
    conversation: [],
    ...(parsed.targetViewId !== undefined ? { targetViewId: parsed.targetViewId } : {}),
    planWorkflowRunId: planWorkflow.id,
    latestWorkflowRunId: planWorkflow.id,
  });

  recordSpotlightRunEvent(services, run, "Spotlight run awaiting context consent", {
    status: run.status,
    workflowRunId: planWorkflow.id,
  });

  // Trusted profiles start immediately even without start: true.
  if (start || isTrustedProfile(profile)) {
    return startSpotlightRunAfterConsent(services, run);
  }

  return spotlightRunResource(services, run);
}

export function readSpotlightRun(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  runId: SpotlightRunId,
): SpotlightRunResource {
  const run = requireSpotlightRun(services, runId);

  if (run.reviewDisplayId !== reviewDisplayId) {
    throw new ApiHttpError(404, "not_found", `Spotlight run ${runId} was not found`);
  }

  return spotlightRunResource(services, run);
}

export async function approveSpotlightRunContext(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  runId: SpotlightRunId,
): Promise<SpotlightRunResource> {
  const run = requireSpotlightRunForReview(services, reviewDisplayId, runId);

  if (run.status === "completed") {
    return spotlightRunResource(services, run);
  }

  if (run.status === "failed") {
    throw new ApiHttpError(409, "conflict", "Failed Spotlight runs cannot be approved again");
  }

  const planWorkflow = ensureSpotlightPlanWorkflow(services, run);

  if (run.status !== "pending_consent" && planWorkflow.status !== "pending_consent") {
    throw new ApiHttpError(409, "conflict", "Spotlight context has already been approved");
  }

  return startSpotlightRunAfterConsent(services, run);
}

export async function refineSpotlightRunPlan(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  runId: SpotlightRunId,
  instruction: string,
): Promise<SpotlightRunResource> {
  const run = requireSpotlightRunForReview(services, reviewDisplayId, runId);

  if (!run.gated || run.status !== "awaiting_plan_approval") {
    throw new ApiHttpError(409, "conflict", "Spotlight plan refinement requires a gated run plan");
  }

  const state = spotlightPlanStateForRun(services, run);

  if (state === null) {
    throw new ApiHttpError(409, "conflict", "Spotlight plan state is no longer available");
  }

  const workflowOutline = workflowOutlineForApproval(services, run, state.outline);

  try {
    const planning = requireUpdatedSpotlightRun(
      services,
      run.id,
      services.spotlight.updateRun(run.id, { status: "planning", errorMessage: null }),
    );
    recordSpotlightRunEvent(services, planning, "Spotlight plan refinement started", {
      status: planning.status,
    });
    const workflow = createSpotlightWorkflowRun(services, run, "spotlight_refine", {
      currentOutlineItems: workflowOutline,
      spotlightRefineInstruction: instruction,
      refinementCount: state.conversation.length + 1,
      ...(state.targetViewId === undefined ? {} : { targetViewId: state.targetViewId }),
    });
    services.workflowRunner.approveRun(workflow.id);
    updateSpotlightPlanState(services, planning, {
      latestWorkflowRunId: workflow.id,
      conversation: [
        ...state.conversation,
        {
          instruction,
          outline: state.outline,
          createdAt: services.clock(),
        },
      ],
    });

    return spotlightRunResource(services, planning);
  } catch (error) {
    throw failSpotlightRun(services, run, error);
  }
}

export async function approveSpotlightRunPlan(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  runId: SpotlightRunId,
  approvedOutline: SpotlightApprovedOutline,
): Promise<SpotlightRunResource> {
  const run = requireSpotlightRunForReview(services, reviewDisplayId, runId);

  if (!run.gated || run.status !== "awaiting_plan_approval") {
    throw new ApiHttpError(409, "conflict", "Spotlight plan approval requires a gated run plan");
  }

  const parsedOutline = spotlightApprovedOutlineSchema.parse(approvedOutline);

  return startSpotlightMembershipWorkflow(services, run, parsedOutline);
}

function startSpotlightRunAfterConsent(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightRunResource {
  try {
    const planning = requireUpdatedSpotlightRun(
      services,
      run.id,
      services.spotlight.updateRun(run.id, { status: "planning", errorMessage: null }),
    );
    recordSpotlightRunEvent(services, planning, "Spotlight planning started", {
      status: planning.status,
    });
    const workflow = ensureSpotlightPlanWorkflow(services, run);

    if (workflow.status === "pending_consent") {
      services.workflowRunner.approveRun(workflow.id);
    } else if (
      workflow.status === "awaiting_user" ||
      (workflow.status === "completed" && workflow.draftOutput?.kind === "spotlight_outline")
    ) {
      return markSpotlightOutlineWorkflowReady(services, workflow);
    }

    updateSpotlightPlanState(services, planning, {
      planWorkflowRunId: workflow.id,
      latestWorkflowRunId: workflow.id,
    });

    return spotlightRunResource(services, planning);
  } catch (error) {
    throw failSpotlightRun(services, run, error);
  }
}

export function markSpotlightOutlineWorkflowReady(
  services: GreenroomApiServices,
  workflowRun: WorkflowRun,
): SpotlightRunResource {
  const draft = requireSpotlightOutlineDraft(workflowRun);
  const run = requireSpotlightRunFromWorkflow(services, workflowRun);
  const outline = approvedOutlineFromWorkflowDraft(draft);
  const currentState = services.spotlightPlanStates.get(run.id);
  const targetViewId =
    targetViewIdFromSpotlightWorkflowMetadata(services, run) ?? currentState?.targetViewId;
  const refinementInstruction = stringMetadata(workflowRun.metadata, "spotlightRefineInstruction");
  const previousConversation = currentState?.conversation ?? [];
  const conversation =
    workflowRun.workflowKind === "spotlight_refine" && refinementInstruction !== null
      ? [
          ...previousConversation.slice(0, Math.max(0, previousConversation.length - 1)),
          {
            instruction: refinementInstruction,
            outline,
            createdAt: services.clock(),
          },
        ]
      : previousConversation;

  services.spotlightPlanStates.set(run.id, {
    outline,
    workflowOutline: draft.views,
    conversation,
    ...(targetViewId !== undefined ? { targetViewId } : {}),
    planWorkflowRunId: latestSpotlightWorkflowRun(services, run, "spotlight_plan")?.id ?? null,
    latestWorkflowRunId: workflowRun.id,
  });

  if (run.gated) {
    const awaiting = requireUpdatedSpotlightRun(
      services,
      run.id,
      services.spotlight.updateRun(run.id, { status: "awaiting_plan_approval" }),
    );
    recordSpotlightRunEvent(services, awaiting, "Spotlight plan awaiting approval", {
      status: awaiting.status,
      outlineCount: outline.length,
      workflowRunId: workflowRun.id,
    });

    return spotlightRunResource(services, awaiting);
  }

  return startSpotlightMembershipWorkflow(services, run, outline);
}

export function markSpotlightWorkflowFailed(
  services: GreenroomApiServices,
  workflowRun: WorkflowRun,
  errorMessage: string,
): SpotlightRunResource {
  const run = requireSpotlightRunFromWorkflow(services, workflowRun);
  failSpotlightRun(services, run, new Error(errorMessage));
  return spotlightRunResource(services, requireSpotlightRun(services, run.id));
}

function startSpotlightMembershipWorkflow(
  services: GreenroomApiServices,
  run: SpotlightRun,
  approvedOutline: SpotlightApprovedOutline | null,
): SpotlightRunResource {
  try {
    const outline = spotlightApprovedOutlineSchema.parse(
      approvedOutline ?? pendingOutlineForRun(services, run) ?? [],
    );
    const workflowOutline = workflowOutlineForApproval(services, run, outline);
    const generating = requireUpdatedSpotlightRun(
      services,
      run.id,
      services.spotlight.updateRun(run.id, {
        status: run.type === "generate" || run.type === "regenerate" ? "generating" : "updating",
        approvedOutline: outline,
        errorMessage: null,
      }),
    );
    recordSpotlightRunEvent(services, generating, spotlightRunStartedSummary(run), {
      status: generating.status,
      outlineCount: outline.length,
    });
    const workflow = createSpotlightWorkflowRun(services, generating, "spotlight_membership", {
      approvedOutlineItems: workflowOutline,
      ...(targetViewIdForRun(services, run) === null
        ? {}
        : { targetViewId: targetViewIdForRun(services, run) }),
    });
    updateSpotlightPlanState(services, generating, {
      outline,
      workflowOutline,
      latestWorkflowRunId: workflow.id,
    });
    services.workflowRunner.approveRun(workflow.id);
    return spotlightRunResource(services, generating);
  } catch (error) {
    throw failSpotlightRun(services, run, error);
  }
}

function applyGeneratedSpotlightViews(
  services: GreenroomApiServices,
  run: SpotlightRun,
  request: SpotlightProviderRequest,
  generatedViews: readonly SpotlightGeneratedView[],
): SpotlightViewWithRegions[] {
  if (run.type === "update") {
    return applySpotlightUpdate(services, run, request, generatedViews);
  }

  if (run.type === "refine_view") {
    return applySpotlightViewRefine(services, request, generatedViews);
  }

  return services.spotlight.replaceViewsForReview(
    request.review.id,
    generatedViews.map((view) => ({
      title: view.title,
      description: view.description,
      intent: view.intent,
      orderIndex: view.orderIndex,
      originRunId: run.id,
      lastReconciledRevisionId: request.revision.id,
      regions: view.regions,
    })),
  );
}

function applySpotlightUpdate(
  services: GreenroomApiServices,
  run: SpotlightRun,
  request: SpotlightProviderRequest,
  generatedViews: readonly SpotlightGeneratedView[],
): SpotlightViewWithRegions[] {
  const existingViews = request.existingViews;
  const matchedViewRefs = new Set<SpotlightViewRef>();

  generatedViews.forEach((generatedView, index) => {
    const match = findMatchingExistingView(generatedView, index, existingViews, matchedViewRefs);

    if (match === null) {
      const created = services.spotlight.createView({
        reviewDisplayId: request.review.displayId,
        title: generatedView.title,
        description: generatedView.description,
        intent: generatedView.intent,
        orderIndex: generatedView.orderIndex,
        originRunId: run.id,
        lastReconciledRevisionId: request.revision.id,
        health: "current",
      });
      services.spotlight.replaceRegions(created.displayRef, generatedView.regions);
      return;
    }

    matchedViewRefs.add(match.displayRef);
    services.spotlight.updateView(match.displayRef, {
      title: generatedView.title,
      description: generatedView.description,
      intent: generatedView.intent,
      orderIndex: generatedView.orderIndex,
      health: "current",
      lastReconciledRevisionId: request.revision.id,
    });
    services.spotlight.replaceRegions(match.displayRef, generatedView.regions);
  });

  for (const existingView of existingViews) {
    if (!matchedViewRefs.has(existingView.displayRef)) {
      services.spotlight.updateViewHealth(existingView.displayRef, {
        health: "outdated",
        lastReconciledRevisionId: request.revision.id,
      });
    }
  }

  return services.spotlight.listViewsWithRegionsByReview(request.review.id);
}

function applySpotlightViewRefine(
  services: GreenroomApiServices,
  request: SpotlightProviderRequest,
  generatedViews: readonly SpotlightGeneratedView[],
): SpotlightViewWithRegions[] {
  if (request.targetView === null) {
    throw new ApiHttpError(409, "conflict", "Refine-this-View run lost its target View state");
  }

  const generatedView = generatedViews[0];

  if (generatedView === undefined) {
    services.spotlight.updateViewHealth(request.targetView.displayRef, {
      health: "outdated",
      lastReconciledRevisionId: request.revision.id,
    });
    return services.spotlight.listViewsWithRegionsByReview(request.review.id);
  }

  services.spotlight.updateView(request.targetView.displayRef, {
    title: generatedView.title,
    description: generatedView.description,
    intent: generatedView.intent,
    orderIndex: request.targetView.orderIndex,
    health: "current",
    lastReconciledRevisionId: request.revision.id,
  });
  services.spotlight.replaceRegions(request.targetView.displayRef, generatedView.regions);

  return services.spotlight.listViewsWithRegionsByReview(request.review.id);
}

function findMatchingExistingView(
  generatedView: SpotlightGeneratedView,
  generatedIndex: number,
  existingViews: readonly SpotlightViewWithRegions[],
  matchedViewRefs: ReadonlySet<SpotlightViewRef>,
): SpotlightViewWithRegions | null {
  const unmatched = existingViews.filter((view) => !matchedViewRefs.has(view.displayRef));
  const title = normalizeViewMatchText(generatedView.title);
  const intent = normalizeViewMatchText(generatedView.intent);

  return (
    unmatched.find(
      (view) =>
        normalizeViewMatchText(view.title) === title &&
        normalizeViewMatchText(view.intent) === intent,
    ) ??
    unmatched.find((view) => normalizeViewMatchText(view.title) === title) ??
    unmatched.find((view) => normalizeViewMatchText(view.intent) === intent) ??
    unmatched.find((view) => view.orderIndex === generatedIndex) ??
    null
  );
}

function normalizeViewMatchText(value: string): string {
  return value.trim().toLowerCase();
}

function outlineItemForView(view: SpotlightView): SpotlightApprovedOutline[number] {
  return {
    title: view.title,
    intent: view.intent,
    description: view.description,
  };
}

function spotlightRunStartedSummary(run: SpotlightRun): string {
  switch (run.type) {
    case "update":
      return "Spotlight view update started";
    case "refine_view":
      return "Spotlight View refinement started";
    case "regenerate":
      return "Spotlight regeneration started";
    default:
      return "Spotlight membership generation started";
  }
}

function spotlightRunCompletedSummary(run: SpotlightRun): string {
  switch (run.type) {
    case "update":
      return "Spotlight views updated";
    case "refine_view":
      return "Spotlight View refined";
    case "regenerate":
      return "Spotlight views regenerated";
    default:
      return "Spotlight views generated";
  }
}

export function listSpotlightViews(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
): SpotlightViewResource[] {
  const review = requireSpotlightReview(services, reviewDisplayId);

  return services.spotlight
    .listViewsWithRegionsByReview(review.id)
    .map((view) => viewResource(view));
}

export function readSpotlightView(
  services: GreenroomApiServices,
  ref: SpotlightViewReference,
): SpotlightViewWithRegionsResource {
  const view = requireSpotlightViewByRef(services, ref);
  return viewWithRegionsResource(view);
}

export function readSpotlightViewDiff(
  services: GreenroomApiServices,
  ref: SpotlightViewReference,
): SpotlightViewDiffResource {
  const view = requireSpotlightViewByRef(services, ref);
  const review = requireSpotlightReview(services, view.reviewDisplayId);
  const revision = requireCurrentSpotlightRevision(services, review);
  const associatedFiles = associatedFilesForRegions(view.regions);
  const associatedKeys = new Set(associatedFiles.map((file) => fileKey(file.path, file.oldPath)));
  const files = services.reviews
    .listDiffFiles(revision.id)
    .filter((file) => associatedKeys.has(fileKey(file.path, file.oldPath)));

  return {
    view: viewResource(view),
    revision,
    files,
    regions: view.regions,
  };
}

export function readSpotlightCoverage(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
): SpotlightCoverageResource {
  const review = requireSpotlightReview(services, reviewDisplayId);
  const revision = requireCurrentSpotlightRevision(services, review);
  const files = services.reviews.listDiffFiles(revision.id);
  const covered = coveredLineKeys(services.spotlight.listViewsWithRegionsByReview(review.id));
  const unlitAnchors = allChangedLineAnchors(review.displayId, revision.id, files).filter(
    (anchor) => !covered.has(anchorLineKey(anchor)),
  );

  return {
    reviewDisplayId: review.displayId,
    revisionId: revision.id,
    unlitAnchors,
  };
}

export function readSpotlightLineMembership(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
): SpotlightLineMembershipResource {
  const review = requireSpotlightReview(services, reviewDisplayId);
  const revision = requireCurrentSpotlightRevision(services, review);
  const files = services.reviews.listDiffFiles(revision.id);
  const views = services.spotlight.listViewsWithRegionsByReview(review.id);
  const viewsByLine = new Map<string, SpotlightViewWithRegions[]>();

  for (const view of views) {
    const viewLineKeys = new Set<string>();

    for (const region of view.regions) {
      for (const anchor of region.anchors) {
        if (anchor.revisionId === revision.id) {
          viewLineKeys.add(anchorLineKey(anchor));
        }
      }
    }

    for (const key of viewLineKeys) {
      const lineViews = viewsByLine.get(key) ?? [];
      lineViews.push(view);
      viewsByLine.set(key, lineViews);
    }
  }

  return {
    reviewDisplayId: review.displayId,
    revisionId: revision.id,
    memberships: allChangedLineAnchors(review.displayId, revision.id, files).map((anchor) => ({
      anchor,
      views: (viewsByLine.get(anchorLineKey(anchor)) ?? []).map((view) => viewResource(view)),
    })),
  };
}

export const spotlightPlanRefineRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(4000),
  })
  .strict();

export const spotlightPlanApprovalRequestSchema = z
  .object({
    approvedOutline: spotlightApprovedOutlineSchema,
  })
  .strict();

function createSpotlightWorkflowRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
  workflowKind: "spotlight_plan" | "spotlight_refine" | "spotlight_membership",
  metadata: WorkflowRedactedMetadata = {},
): WorkflowRun {
  const review = requireSpotlightReview(services, run.reviewDisplayId);
  const revision = requireSpotlightRevision(services, review, run.revisionId);
  const repository = requireSpotlightRepository(services, review.repositoryId);
  const profile = requireSpotlightProfile(services, run.profileId);
  const harnessKind = harnessKindForSpotlightProfile(profile);
  const allowedMcpCapabilities = spotlightWorkflowMcpCapabilities();
  const expectedMcpResources = spotlightWorkflowExpectedMcpResources(review.displayId);
  const expectedOutputMode = expectedOutputModeForSpotlightWorkflow(workflowKind);
  const changedFiles = spotlightWorkflowChangedFiles(services, revision);
  const repositoryAccess = workflowRepositoryAccessSummaryForProfile({
    profile,
    repository,
    revision,
  });

  return services.workflowRunner.createRun({
    run: {
      workflowKind,
      revisionId: revision.id,
      profileId: profile.id,
      harnessKind,
      consentSummary: {
        workflowKind,
        selectedHarness: harnessKind,
        profile: {
          id: profile.id,
          name: profile.name,
          workflowType: profile.workflowType,
          provider: profile.provider,
          model: profile.model,
        },
        reviewDisplayId: review.displayId,
        revisionId: revision.id,
        scopeLabel: spotlightWorkflowScopeLabel(run),
        changedFiles,
        allowedMcpCapabilities,
        expectedMcpResources,
        expectedOutputMode,
        repositoryAccess,
        threadCreationGate: null,
        tracingStatus: "disabled",
      },
      metadata: {
        workflowFamily: "spotlight",
        ...workflowRepositoryAccessMetadata(repositoryAccess),
        spotlightRunId: run.id,
        spotlightOperation: run.type,
        selectedOperation: run.type,
        spotlightTrigger: run.trigger,
        spotlightGated: run.gated,
        allowedMcpCapabilities,
        expectedMcpResources,
        changedFileManifest: changedFiles.files,
        ...spotlightWorkflowContextMetadata(services, review.id),
        ...metadata,
      },
    },
  });
}

function ensureSpotlightPlanWorkflow(
  services: GreenroomApiServices,
  run: SpotlightRun,
): WorkflowRun {
  const state = services.spotlightPlanStates.get(run.id);

  if (state?.planWorkflowRunId !== undefined && state.planWorkflowRunId !== null) {
    const runFromState = services.workflowRunner.readRun(state.planWorkflowRunId);

    if (runFromState !== null) {
      return runFromState;
    }
  }

  const existing = latestSpotlightWorkflowRun(services, run, "spotlight_plan");

  if (existing !== null) {
    updateSpotlightPlanState(services, run, {
      planWorkflowRunId: existing.id,
      latestWorkflowRunId: existing.id,
    });
    return existing;
  }

  const created = createSpotlightWorkflowRun(services, run, "spotlight_plan", {
    ...(targetViewIdForRun(services, run) === null
      ? {}
      : { targetViewId: targetViewIdForRun(services, run) }),
  });
  updateSpotlightPlanState(services, run, {
    planWorkflowRunId: created.id,
    latestWorkflowRunId: created.id,
  });
  return created;
}

function requireSpotlightOutlineDraft(run: WorkflowRun): WorkflowSpotlightOutlineDraftOutput {
  if (run.draftOutput?.kind !== "spotlight_outline") {
    throw new Error(`Workflow run ${run.id} did not produce a Spotlight outline draft`);
  }

  return workflowSpotlightOutlineDraftOutputSchema.parse(run.draftOutput);
}

function requireSpotlightMembershipDraft(run: WorkflowRun): WorkflowSpotlightMembershipDraftOutput {
  if (run.draftOutput?.kind !== "spotlight_membership") {
    throw new Error(`Workflow run ${run.id} did not produce a Spotlight membership draft`);
  }

  return workflowSpotlightMembershipDraftOutputSchema.parse(run.draftOutput);
}

function approvedOutlineFromWorkflowDraft(
  draft: WorkflowSpotlightOutlineDraftOutput,
): SpotlightApprovedOutline {
  return spotlightApprovedOutlineSchema.parse(
    draft.views.map((view) => ({
      title: view.title,
      intent: view.intent,
      description: view.description,
    })),
  );
}

function workflowOutlineForApproval(
  services: GreenroomApiServices,
  run: SpotlightRun,
  approvedOutline: SpotlightApprovedOutline,
): WorkflowSpotlightOutlineDraftOutput["views"] {
  const state = services.spotlightPlanStates.get(run.id);
  const latestDraft = latestOutlineDraftForRun(services, run);
  const source = state?.workflowOutline ?? latestDraft?.views ?? [];

  if (source.length === approvedOutline.length) {
    return workflowSpotlightOutlineDraftOutputSchema.shape.views.parse(
      source.map((item, index) => {
        const approved = approvedOutline[index]!;

        return {
          ...item,
          title: approved.title,
          intent: approved.intent,
          description: approved.description,
        };
      }),
    );
  }

  return workflowOutlineFromApprovedOutline(approvedOutline);
}

function workflowOutlineFromApprovedOutline(
  approvedOutline: SpotlightApprovedOutline,
): WorkflowSpotlightOutlineDraftOutput["views"] {
  const used = new Set<string>();

  return workflowSpotlightOutlineDraftOutputSchema.shape.views.parse(
    approvedOutline.map((item, index) => {
      const base =
        stableViewKeyBase(item.intent) || stableViewKeyBase(item.title) || `view-${index + 1}`;
      let key = base;
      let suffix = 2;

      while (used.has(key)) {
        key = `${base}-${suffix}`;
        suffix += 1;
      }

      used.add(key);

      return {
        key,
        title: item.title,
        intent: item.intent,
        description: item.description,
        rationale: null,
        anchorKeyHints: [],
      };
    }),
  );
}

function pendingOutlineForRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightApprovedOutline | null {
  const draft = latestOutlineDraftForRun(services, run);
  return draft === null ? null : approvedOutlineFromWorkflowDraft(draft);
}

function latestOutlineDraftForRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
): WorkflowSpotlightOutlineDraftOutput | null {
  const workflow =
    latestSpotlightWorkflowRun(services, run, "spotlight_refine") ??
    latestSpotlightWorkflowRun(services, run, "spotlight_plan");

  if (workflow?.draftOutput?.kind !== "spotlight_outline") {
    return null;
  }

  return workflowSpotlightOutlineDraftOutputSchema.parse(workflow.draftOutput);
}

function latestSpotlightWorkflowRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
  workflowKind?: WorkflowKind,
): WorkflowRun | null {
  return (
    spotlightWorkflowRunsForRun(services, run)
      .filter((workflow) => workflowKind === undefined || workflow.workflowKind === workflowKind)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

function spotlightWorkflowRunsForRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
): WorkflowRun[] {
  const review = requireSpotlightReview(services, run.reviewDisplayId);

  return services.workflowRunner
    .listRunsByReview(review.id)
    .filter((workflow) => stringMetadata(workflow.metadata, "spotlightRunId") === run.id);
}

function durableRefinementCount(services: GreenroomApiServices, run: SpotlightRun): number {
  return spotlightWorkflowRunsForRun(services, run).filter(
    (workflow) => workflow.workflowKind === "spotlight_refine",
  ).length;
}

function spotlightPlanStateForRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightPlanState | null {
  const state = services.spotlightPlanStates.get(run.id);

  if (state !== undefined) {
    return state;
  }

  const draft = latestOutlineDraftForRun(services, run);

  if (draft === null) {
    return null;
  }

  return {
    outline: approvedOutlineFromWorkflowDraft(draft),
    workflowOutline: draft.views,
    conversation: [],
    targetViewId: targetViewIdFromSpotlightWorkflowMetadata(services, run),
    planWorkflowRunId: latestSpotlightWorkflowRun(services, run, "spotlight_plan")?.id ?? null,
    latestWorkflowRunId:
      latestSpotlightWorkflowRun(services, run, "spotlight_refine")?.id ??
      latestSpotlightWorkflowRun(services, run, "spotlight_plan")?.id ??
      null,
  };
}

function updateSpotlightPlanState(
  services: GreenroomApiServices,
  run: SpotlightRun,
  patch: Partial<SpotlightPlanState>,
): void {
  const current = services.spotlightPlanStates.get(run.id) ?? {
    outline: pendingOutlineForRun(services, run) ?? [],
    workflowOutline: latestOutlineDraftForRun(services, run)?.views ?? [],
    conversation: [],
    targetViewId: targetViewIdFromSpotlightWorkflowMetadata(services, run),
  };

  services.spotlightPlanStates.set(run.id, {
    ...current,
    ...patch,
  });
}

function targetViewIdForRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightViewRef | null {
  return (
    services.spotlightPlanStates.get(run.id)?.targetViewId ??
    targetViewIdFromSpotlightWorkflowMetadata(services, run) ??
    null
  );
}

function targetViewIdFromSpotlightWorkflowMetadata(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightViewRef | null {
  for (const workflow of spotlightWorkflowRunsForRun(services, run)) {
    const targetViewId = stringMetadata(workflow.metadata, "targetViewId");

    if (targetViewId !== null) {
      return spotlightViewRefSchema.parse(targetViewId);
    }
  }

  return null;
}

export async function createProviderSpotlightOutlineWorkflowDraft(
  services: GreenroomApiServices,
  workflowRun: WorkflowRun,
): Promise<WorkflowSpotlightOutlineDraftOutput> {
  const run = requireSpotlightRunFromWorkflow(services, workflowRun);
  const request = spotlightProviderRequest(services, run);
  const provider = requireSpotlightProvider(services, request.profile.provider);
  const outline =
    workflowRun.workflowKind === "spotlight_refine"
      ? await provider.refinePlan({
          ...request,
          currentOutline: approvedOutlineFromWorkflowItems(
            workflowOutlineItemsFromMetadata(workflowRun.metadata, "currentOutlineItems"),
          ),
          instruction: stringMetadata(workflowRun.metadata, "spotlightRefineInstruction") ?? "",
          conversation: services.spotlightPlanStates.get(run.id)?.conversation ?? [],
        })
      : request.operation === "refine_view" && request.targetView !== null
        ? [outlineItemForView(request.targetView)]
        : await provider.planViews(request);

  return workflowSpotlightOutlineDraftOutputSchema.parse({
    kind: "spotlight_outline",
    views: workflowOutlineFromApprovedOutline(spotlightApprovedOutlineSchema.parse(outline)),
  });
}

export async function createProviderSpotlightMembershipWorkflowDraft(
  services: GreenroomApiServices,
  workflowRun: WorkflowRun,
): Promise<WorkflowSpotlightMembershipDraftOutput> {
  const run = requireSpotlightRunFromWorkflow(services, workflowRun);
  const request = spotlightProviderRequest(services, run);
  const provider = requireSpotlightProvider(services, request.profile.provider);
  const approvedOutlineItems = workflowOutlineItemsFromMetadata(
    workflowRun.metadata,
    "approvedOutlineItems",
  );
  const generatedViews = await provider.generateViews({
    ...request,
    approvedOutline: approvedOutlineFromWorkflowItems(approvedOutlineItems),
  });

  return membershipDraftFromGeneratedViews(generatedViews, approvedOutlineItems);
}

export function persistSpotlightMembershipWorkflowDraft(
  services: GreenroomApiServices,
  workflowRun: WorkflowRun,
  draft: WorkflowSpotlightMembershipDraftOutput,
): { spotlightRunId: SpotlightRunId; viewCount: number; regionCount: number } {
  requireSpotlightMembershipDraft({ ...workflowRun, draftOutput: draft });
  const run = requireSpotlightRunFromWorkflow(services, workflowRun);
  const request = spotlightProviderRequest(services, run);
  const approvedOutlineItems = workflowOutlineItemsFromMetadata(
    workflowRun.metadata,
    "approvedOutlineItems",
  );
  const generatedViews = generatedViewsFromMembershipDraft(
    services,
    request,
    approvedOutlineItems,
    draft,
  );
  const views = applyGeneratedSpotlightViews(services, run, request, generatedViews);
  const completedOutline = spotlightApprovedOutlineSchema.parse(
    views.map((view) => ({
      title: view.title,
      intent: view.intent,
      description: view.description,
    })),
  );
  const completed = requireUpdatedSpotlightRun(
    services,
    run.id,
    services.spotlight.updateRun(run.id, {
      status: "completed",
      approvedOutline: completedOutline,
      completedAt: services.clock(),
    }),
  );
  services.spotlightPlanStates.delete(run.id);
  const regionCount = views.reduce((sum, view) => sum + view.regions.length, 0);

  recordSpotlightRunEvent(services, completed, spotlightRunCompletedSummary(run), {
    status: completed.status,
    viewCount: views.length,
    regionCount,
    workflowRunId: workflowRun.id,
  });

  return {
    spotlightRunId: run.id,
    viewCount: views.length,
    regionCount,
  };
}

function requireSpotlightRunFromWorkflow(
  services: GreenroomApiServices,
  workflowRun: WorkflowRun,
): SpotlightRun {
  const runId = stringMetadata(workflowRun.metadata, "spotlightRunId");

  if (runId === null) {
    throw new Error(`Workflow run ${workflowRun.id} is not linked to a Spotlight run`);
  }

  const run = services.spotlight.getRun(spotlightRunIdSchema.parse(runId));

  if (run === null) {
    throw new Error(`Spotlight run ${runId} was not found`);
  }

  return run;
}

function generatedViewsFromMembershipDraft(
  services: GreenroomApiServices,
  request: SpotlightProviderRequest,
  approvedOutlineItems: WorkflowSpotlightOutlineDraftOutput["views"],
  draft: WorkflowSpotlightMembershipDraftOutput,
): SpotlightGeneratedView[] {
  const changedAnchors = allChangedLineAnchors(
    request.review.displayId,
    request.revision.id,
    request.files,
  );
  const anchorsByKey = new Map(changedAnchors.map((anchor) => [anchorLineKey(anchor), anchor]));
  const anchorKeysByPath = anchorKeysByPathFromAnchors(changedAnchors);
  const membershipsByViewKey = new Map(
    draft.memberships.map((membership) => [
      membership.viewKey,
      uniqueStrings([
        ...membership.anchorKeys,
        ...membership.filePaths.flatMap(
          (filePath) => anchorKeysByPath.get(normalizeAnchorPath(filePath)) ?? [],
        ),
      ]),
    ]),
  );

  return approvedOutlineItems.map((outline, index) => {
    const anchorKeys = membershipsByViewKey.get(outline.key) ?? [];
    const anchors = anchorKeys.map((anchorKey) => {
      const anchor = anchorsByKey.get(anchorKey);

      if (anchor === undefined) {
        throw new Error(`Spotlight membership draft referenced unknown anchor key ${anchorKey}`);
      }

      return anchor;
    });

    return {
      title: outline.title,
      description: outline.description,
      intent: outline.intent,
      orderIndex: index,
      regions: groupAnchorsIntoSpotlightRegions(anchors),
    };
  });
}

function groupAnchorsIntoSpotlightRegions(
  anchors: readonly ThreadAnchor[],
): CreateSpotlightRegionForViewInput[] {
  const grouped = new Map<string, ThreadAnchor[]>();

  for (const anchor of anchors) {
    const key = fileKey(anchor.filePath, anchor.oldFilePath);
    const group = grouped.get(key) ?? [];
    group.push(anchor);
    grouped.set(key, group);
  }

  return Array.from(grouped.values()).flatMap((group) => {
    const first = group[0]!;
    const regions: CreateSpotlightRegionForViewInput[] = [];

    for (let index = 0; index < group.length; index += 200) {
      regions.push({
        filePath: first.filePath,
        oldPath: first.oldFilePath,
        anchors: group.slice(index, index + 200),
        remapConfidence: 1,
        stale: false,
      });
    }

    return regions;
  });
}

function membershipDraftFromGeneratedViews(
  generatedViews: readonly SpotlightGeneratedView[],
  approvedOutlineItems: WorkflowSpotlightOutlineDraftOutput["views"],
): WorkflowSpotlightMembershipDraftOutput {
  return workflowSpotlightMembershipDraftOutputSchema.parse({
    kind: "spotlight_membership",
    memberships: generatedViews.flatMap((view, index) => {
      const anchorKeys = uniqueStrings(
        view.regions.flatMap((region) => region.anchors.map(anchorLineKey)),
      );

      if (anchorKeys.length === 0) {
        return [];
      }

      return [
        {
          viewKey: findWorkflowOutlineKeyForGeneratedView(approvedOutlineItems, view, index),
          anchorKeys,
          rationale: null,
        },
      ];
    }),
    uncoveredAnchorKeys: [],
  });
}

function findWorkflowOutlineKeyForGeneratedView(
  outline: WorkflowSpotlightOutlineDraftOutput["views"],
  view: Pick<SpotlightGeneratedView, "title" | "intent">,
  index: number,
): string {
  const title = normalizeViewMatchText(view.title);
  const intent = normalizeViewMatchText(view.intent);

  return (
    outline.find(
      (item) =>
        normalizeViewMatchText(item.title) === title &&
        normalizeViewMatchText(item.intent) === intent,
    )?.key ??
    outline.find((item) => normalizeViewMatchText(item.title) === title)?.key ??
    outline.find((item) => normalizeViewMatchText(item.intent) === intent)?.key ??
    outline[index]?.key ??
    `view-${index + 1}`
  );
}

function workflowOutlineItemsFromMetadata(
  metadata: WorkflowRedactedMetadata,
  key: string,
): WorkflowSpotlightOutlineDraftOutput["views"] {
  const parsed = workflowSpotlightOutlineDraftOutputSchema.shape.views.safeParse(metadata[key]);
  return parsed.success ? parsed.data : [];
}

function approvedOutlineFromWorkflowItems(
  items: WorkflowSpotlightOutlineDraftOutput["views"],
): SpotlightApprovedOutline {
  return spotlightApprovedOutlineSchema.parse(
    items.map((item) => ({
      title: item.title,
      intent: item.intent,
      description: item.description,
    })),
  );
}

function spotlightWorkflowScopeLabel(run: SpotlightRun): string {
  switch (run.type) {
    case "update":
      return "Spotlight update for all changed files";
    case "regenerate":
      return "Spotlight regeneration for all changed files";
    case "refine_view":
      return "Spotlight refine-this-View";
    case "generate":
      return "Spotlight generation for all changed files";
  }
}

function expectedOutputModeForSpotlightWorkflow(
  workflowKind: "spotlight_plan" | "spotlight_refine" | "spotlight_membership",
): WorkflowExpectedOutputMode {
  return workflowKind === "spotlight_membership" ? "spotlight_membership" : "spotlight_outline";
}

function spotlightWorkflowMcpCapabilities(): WorkflowMcpCapability[] {
  return [
    "review:read",
    "revision:read",
    "diff:read",
    "threads:read",
    "spotlight:read",
    "draft:submit",
    "validation:read",
  ];
}

function spotlightWorkflowExpectedMcpResources(reviewDisplayId: ReviewPr["displayId"]): string[] {
  return [
    "greenroom://concepts/review-model",
    "greenroom://concepts/anchors",
    `greenroom://reviews/${reviewDisplayId}/manifest`,
    `greenroom://reviews/${reviewDisplayId}/diff-summary`,
    `greenroom://reviews/${reviewDisplayId}/files`,
    `greenroom://reviews/${reviewDisplayId}/files/{path}`,
    `greenroom://reviews/${reviewDisplayId}/anchors/{path}`,
    `greenroom://reviews/${reviewDisplayId}/threads`,
    `greenroom://reviews/${reviewDisplayId}/spotlight/views`,
    `greenroom://reviews/${reviewDisplayId}/spotlight/coverage`,
    "greenroom://runs/{runId}/instructions",
    "greenroom://runs/{runId}/output-schema",
    "greenroom://runs/{runId}/consent-scope",
    "greenroom://runs/{runId}/validation-errors",
  ];
}

function spotlightWorkflowChangedFiles(
  services: GreenroomApiServices,
  revision: RevisionSnapshot,
): WorkflowChangedFileSummary {
  const files = services.reviews.listDiffFiles(revision.id);
  const visibleFiles = files.slice(0, 250);

  return {
    fileCount: revision.diffSummary.fileCount,
    additions: revision.diffSummary.additions,
    deletions: revision.diffSummary.deletions,
    binaryFileCount: revision.diffSummary.binaryFileCount,
    renameCount: revision.diffSummary.renameCount,
    files: visibleFiles.map((file) => ({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      isBinary: file.isBinary,
    })),
    omittedFileCount: Math.max(0, files.length - visibleFiles.length),
  };
}

function spotlightWorkflowContextMetadata(
  services: GreenroomApiServices,
  reviewId: StoredReviewPr["id"],
): WorkflowRedactedMetadata {
  const threads = services.threads.listByReview(reviewId);
  const views = services.spotlight.listViewsWithRegionsByReview(reviewId);

  return {
    existingThreadCount: threads.length,
    existingThreads: threads.slice(0, 100).map((thread) => ({
      shortRef: thread.shortRef,
      status: thread.status,
      type: thread.type,
      severity: thread.severity,
      filePath: thread.anchor.filePath,
      lineNumber: thread.anchor.lineNumber,
    })),
    existingViewCount: views.length,
    existingViews: views.slice(0, 80).map((view) => ({
      displayRef: view.displayRef,
      title: view.title,
      intent: view.intent,
      health: view.health,
      associatedFiles: associatedFilesForRegions(view.regions),
      staleRegionCount: view.regions.filter((region) => region.stale).length,
    })),
  };
}

function harnessKindForSpotlightProfile(profile: Profile): string {
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

function stableViewKeyBase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72);
}

function stringMetadata(metadata: WorkflowRedactedMetadata, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function spotlightProviderRequest(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightProviderRequest {
  const review = requireSpotlightReview(services, run.reviewDisplayId);
  const repository = requireSpotlightRepository(services, review.repositoryId);
  const revision = requireSpotlightRevision(services, review, run.revisionId);
  const state = services.spotlightPlanStates.get(run.id);
  const existingViews = services.spotlight.listViewsWithRegionsByReview(review.id);
  const targetViewId =
    state?.targetViewId ?? targetViewIdFromSpotlightWorkflowMetadata(services, run) ?? null;
  const targetView =
    targetViewId === null
      ? null
      : (existingViews.find((view) => view.displayRef === targetViewId) ?? null);

  if (review.currentRevisionId !== revision.id) {
    throw new ApiHttpError(409, "conflict", "Spotlight runs must target the current revision");
  }

  if (run.type === "refine_view" && targetView === null) {
    throw new ApiHttpError(409, "conflict", "Refine-this-View run target is unavailable");
  }

  return {
    runId: run.id,
    operation: run.type,
    profile: requireSpotlightProfile(services, run.profileId),
    repository,
    review,
    revision,
    files: services.reviews.listDiffFiles(revision.id),
    approvedOutline: run.approvedOutline,
    existingViews,
    targetView,
  };
}

function spotlightRunResource(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightRunResource {
  const state = services.spotlightPlanStates.get(run.id) ?? null;
  const pendingOutline =
    state?.outline !== undefined && state.outline.length > 0
      ? state.outline
      : pendingOutlineForRun(services, run);

  return {
    ...run,
    pendingOutline,
    contextSummary: buildSpotlightRunContextSummary(services, run),
    refinementCount: state?.conversation.length ?? durableRefinementCount(services, run),
  };
}

function buildSpotlightRunContextSummary(
  services: GreenroomApiServices,
  run: SpotlightRun,
): SpotlightRunContextSummary {
  const review = requireSpotlightReview(services, run.reviewDisplayId);
  const revision = requireSpotlightRevision(services, review, run.revisionId);
  const profile = requireSpotlightProfile(services, run.profileId);
  const files = services.reviews.listDiffFiles(revision.id);
  const fileSummaries = files.map((file) => ({
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    hunkCount: file.isBinary ? 0 : file.hunks.length,
    changedLineCount: file.isBinary ? 0 : changedLineCount(file),
  }));
  const hunkCount = fileSummaries.reduce((sum, file) => sum + file.hunkCount, 0);
  const changedLineTotal = fileSummaries.reduce((sum, file) => sum + file.changedLineCount, 0);
  const approximateTokenCount = approximateTokens(
    JSON.stringify({
      review,
      revision,
      files,
    }),
  );

  return {
    review: {
      displayId: review.displayId,
      title: review.title,
    },
    revision: {
      id: revision.id,
      baseSha: revision.baseSha,
      headSha: revision.headSha,
    },
    profile: {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      model: profile.model,
    },
    files: fileSummaries,
    fileCount: fileSummaries.length,
    hunkCount,
    changedLineCount: changedLineTotal,
    approximateTokenCount,
  };
}

function changedLineCount(file: DiffFile): number {
  return file.hunks.reduce(
    (sum, hunk) =>
      sum +
      hunk.lines.filter((line) => line.type === "addition" || line.type === "deletion").length,
    0,
  );
}

function requireSpotlightRunForReview(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  runId: SpotlightRunId,
): SpotlightRun {
  const run = requireSpotlightRun(services, runId);

  if (run.reviewDisplayId !== reviewDisplayId) {
    throw new ApiHttpError(404, "not_found", `Spotlight run ${runId} was not found`);
  }

  return run;
}

function requireUpdatedSpotlightRun(
  services: GreenroomApiServices,
  runId: SpotlightRunId,
  run: SpotlightRun | null,
): SpotlightRun {
  if (run === null) {
    throw new ApiHttpError(404, "not_found", `Spotlight run ${runId} was not found`);
  }

  return run;
}

function failSpotlightRun(
  services: GreenroomApiServices,
  run: SpotlightRun,
  error: unknown,
): ApiHttpError {
  const message = error instanceof Error ? error.message : "Spotlight provider failed";
  const failed = services.spotlight.updateRun(run.id, {
    status: "failed",
    errorMessage: message,
    completedAt: services.clock(),
  });

  services.spotlightPlanStates.delete(run.id);

  recordSpotlightRunEvent(
    services,
    failed ?? run,
    "Spotlight run failed",
    {
      status: "failed",
      errorMessage: message,
    },
    "note",
  );

  if (error instanceof ApiHttpError) {
    return error;
  }

  return new ApiHttpError(500, "internal_error", message);
}

function recordSpotlightRunEvent(
  services: GreenroomApiServices,
  run: SpotlightRun,
  summary: string,
  metadata: Record<string, unknown> = {},
  eventType: "status_update" | "note" = "status_update",
): void {
  services.agentEvents.create({
    reviewDisplayId: run.reviewDisplayId,
    eventType,
    source: {
      kind: "system",
      displayName: "Stage Manager",
      metadata: {
        workflowType: "spotlight",
        runId: run.id,
      },
    },
    threadRefs: [],
    summary,
    metadata: {
      runId: run.id,
      runType: run.type,
      trigger: run.trigger,
      ...metadata,
    },
  });
}

function requireSpotlightReview(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
): StoredReviewPr {
  const review = services.reviews.getByDisplayId(reviewDisplayId);

  if (review === null) {
    throw new ApiHttpError(404, "not_found", `Review ${reviewDisplayId} was not found`);
  }

  return review;
}

function requireSpotlightRepository(
  services: GreenroomApiServices,
  repositoryId: Repository["id"],
): Repository {
  const repository = services.repositories.get(repositoryId);

  if (repository === null) {
    throw new ApiHttpError(404, "not_found", `Repository ${repositoryId} was not found`);
  }

  return repository;
}

function requireCurrentSpotlightRevision(
  services: GreenroomApiServices,
  review: ReviewPr,
): RevisionSnapshot {
  if (review.currentRevisionId === null) {
    throw new ApiHttpError(404, "not_found", `Review ${review.displayId} has no current revision`);
  }

  return requireSpotlightRevision(services, review, review.currentRevisionId);
}

function requireSpotlightRevision(
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

function requireSpotlightProfile(
  services: GreenroomApiServices,
  profileId: Profile["id"],
): Profile {
  const parsedProfileId = profileIdSchema.parse(profileId);
  const profile = services.profiles.get(parsedProfileId);

  if (profile === null) {
    throw new ApiHttpError(404, "not_found", `Profile ${parsedProfileId} was not found`);
  }

  if (profile.workflowType !== "spotlight") {
    throw new ApiHttpError(400, "bad_request", "Spotlight runs require a spotlight profile");
  }

  return profile;
}

function requireSpotlightProvider(
  services: GreenroomApiServices,
  provider: ProviderKind,
): SpotlightProvider {
  const spotlightProvider = services.spotlightProviders[provider];

  if (spotlightProvider === undefined) {
    throw new ApiHttpError(400, "bad_request", `Provider ${provider} is not configured`);
  }

  return spotlightProvider;
}

function requireSpotlightRun(services: GreenroomApiServices, runId: SpotlightRunId): SpotlightRun {
  const parsedRunId = spotlightRunIdSchema.parse(runId);
  const run = services.spotlight.getRun(parsedRunId);

  if (run === null) {
    throw new ApiHttpError(404, "not_found", `Spotlight run ${parsedRunId} was not found`);
  }

  return spotlightRunSchema.parse(run);
}

function requireSpotlightView(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  viewRef: SpotlightViewRef,
): SpotlightViewWithRegions {
  requireSpotlightReview(services, reviewDisplayId);
  const view = services.spotlight.getViewWithRegionsByRef(viewRef);

  if (view === null || view.reviewDisplayId !== reviewDisplayId) {
    throw new ApiHttpError(404, "not_found", `Spotlight view ${viewRef} was not found`);
  }

  return view;
}

function requireSpotlightViewByRef(
  services: GreenroomApiServices,
  ref: SpotlightViewReference,
): SpotlightViewWithRegions {
  const view = services.spotlight.getViewWithRegionsByRef(ref);

  if (view === null) {
    throw new ApiHttpError(404, "not_found", `Spotlight view ${ref} was not found`);
  }

  return view;
}

function approximateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function truncateDescription(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength - 1).trimEnd();
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

type SpotlightBucketKey = "implementation" | "tests" | "configuration" | "documentation";

interface SpotlightBucket {
  key: SpotlightBucketKey;
  title: string;
  intent: string;
  description: string;
}

interface BucketedAnchor {
  file: DiffFile;
  anchors: ThreadAnchor[];
}

const spotlightBuckets: SpotlightBucket[] = [
  {
    key: "implementation",
    title: "Implementation changes",
    intent: "feature",
    description: "Changed source regions that carry the reviewed behavior.",
  },
  {
    key: "tests",
    title: "Test coverage",
    intent: "tests",
    description: "Changed test regions that exercise or protect the review.",
  },
  {
    key: "configuration",
    title: "Configuration and tooling",
    intent: "plumbing",
    description: "Changed project configuration, dependency, or tooling regions.",
  },
  {
    key: "documentation",
    title: "Documentation",
    intent: "documentation",
    description: "Changed documentation regions that explain the review.",
  },
];

function bucketForFile(file: DiffFile): SpotlightBucket {
  const path = file.path.toLowerCase();

  if (
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/u.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/u.test(path)
  ) {
    return spotlightBuckets[1]!;
  }

  if (
    path.endsWith(".md") ||
    path.startsWith("docs/") ||
    path.startsWith("context/") ||
    path.startsWith("readme")
  ) {
    return spotlightBuckets[3]!;
  }

  if (
    path.endsWith(".json") ||
    path.endsWith(".yml") ||
    path.endsWith(".yaml") ||
    path.endsWith(".toml") ||
    path.endsWith(".lock") ||
    path.includes("config") ||
    path.includes("package")
  ) {
    return spotlightBuckets[2]!;
  }

  return spotlightBuckets[0]!;
}

function regionsForFile(
  file: DiffFile,
  anchors: ThreadAnchor[],
): CreateSpotlightRegionForViewInput[] {
  const regions: CreateSpotlightRegionForViewInput[] = [];

  for (let index = 0; index < anchors.length; index += 200) {
    regions.push({
      filePath: file.path,
      oldPath: file.oldPath,
      anchors: anchors.slice(index, index + 200),
      remapConfidence: 1,
      stale: false,
    });
  }

  return regions;
}

function allChangedLineAnchors(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  files: readonly DiffFile[],
): ThreadAnchor[] {
  return files.flatMap((file) => changedLineAnchors(reviewDisplayId, revisionId, file));
}

function anchorKeysByPathFromAnchors(anchors: readonly ThreadAnchor[]): Map<string, string[]> {
  const mapped = new Map<string, string[]>();

  for (const anchor of anchors) {
    addAnchorKeyPathMapping(mapped, anchor.filePath, anchorLineKey(anchor));

    if (anchor.oldFilePath !== null) {
      addAnchorKeyPathMapping(mapped, anchor.oldFilePath, anchorLineKey(anchor));
    }
  }

  return mapped;
}

function addAnchorKeyPathMapping(
  mapped: Map<string, string[]>,
  filePath: string,
  anchorKey: string,
): void {
  const normalized = normalizeAnchorPath(filePath);
  const keys = mapped.get(normalized) ?? [];

  if (!keys.includes(anchorKey)) {
    keys.push(anchorKey);
  }

  mapped.set(normalized, keys);
}

function normalizeAnchorPath(value: string): string {
  return value.trim().replace(/^\.\/+/u, "");
}

function changedLineAnchors(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  file: DiffFile,
): ThreadAnchor[] {
  if (file.isBinary) {
    return [];
  }

  return file.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line, index) => {
      const anchor = anchorForChangedLine(reviewDisplayId, revisionId, file, hunk, line, index);
      return anchor === null ? [] : [anchor];
    }),
  );
}

function anchorForChangedLine(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  file: DiffFile,
  hunk: DiffHunk,
  line: DiffLine,
  lineIndex: number,
): ThreadAnchor | null {
  if (line.type === "addition" && line.newLineNumber !== null) {
    return {
      reviewDisplayId,
      revisionId,
      filePath: file.path,
      oldFilePath: file.oldPath,
      side: "head",
      lineNumber: line.newLineNumber,
      lineType: line.type,
      hunkId: hunk.id,
      hunkHeader: hunk.header,
      contextBefore: nearbyContext(hunk.lines, lineIndex, "before"),
      contextAfter: nearbyContext(hunk.lines, lineIndex, "after"),
      originalLineText: line.content,
    };
  }

  if (line.type === "deletion" && line.oldLineNumber !== null) {
    return {
      reviewDisplayId,
      revisionId,
      filePath: file.path,
      oldFilePath: file.oldPath,
      side: "base",
      lineNumber: line.oldLineNumber,
      lineType: line.type,
      hunkId: hunk.id,
      hunkHeader: hunk.header,
      contextBefore: nearbyContext(hunk.lines, lineIndex, "before"),
      contextAfter: nearbyContext(hunk.lines, lineIndex, "after"),
      originalLineText: line.content,
    };
  }

  return null;
}

function nearbyContext(
  lines: readonly DiffLine[],
  lineIndex: number,
  direction: "after" | "before",
): string[] {
  const windowSize = 3;

  if (direction === "before") {
    return lines
      .slice(Math.max(0, lineIndex - windowSize), lineIndex)
      .map((candidate) => candidate.content);
  }

  return lines
    .slice(lineIndex + 1, lineIndex + 1 + windowSize)
    .map((candidate) => candidate.content);
}

function viewResource(view: SpotlightViewWithRegions): SpotlightViewResource {
  return {
    reviewDisplayId: view.reviewDisplayId,
    displayRef: view.displayRef,
    title: view.title,
    description: view.description,
    intent: view.intent,
    orderIndex: view.orderIndex,
    health: view.health,
    originRunId: view.originRunId,
    lastReconciledRevisionId: view.lastReconciledRevisionId,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    associatedFiles: associatedFilesForRegions(view.regions),
  };
}

function viewWithRegionsResource(view: SpotlightViewWithRegions): SpotlightViewWithRegionsResource {
  return {
    ...viewResource(view),
    regions: view.regions,
  };
}

function associatedFilesForRegions(
  regions: readonly Pick<SpotlightViewRegion, "filePath" | "oldPath">[],
): AssociatedSpotlightFile[] {
  const files = new Map<string, AssociatedSpotlightFile>();

  for (const region of regions) {
    const key = fileKey(region.filePath, region.oldPath);
    files.set(key, { path: region.filePath, oldPath: region.oldPath });
  }

  return Array.from(files.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function coveredLineKeys(views: readonly SpotlightViewWithRegions[]): Set<string> {
  const covered = new Set<string>();

  for (const view of views) {
    for (const region of view.regions) {
      for (const anchor of region.anchors) {
        covered.add(anchorLineKey(anchor));
      }
    }
  }

  return covered;
}

function fileKey(path: string, oldPath: string | null): string {
  return `${path}\0${oldPath ?? ""}`;
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}
