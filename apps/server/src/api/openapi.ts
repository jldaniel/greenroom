import type { CapabilityScope } from "@greenroom/schemas";

type OpenApiHttpMethod = "get" | "post" | "put";
type OpenApiRouteScope = CapabilityScope | "public" | "setup";

interface OpenApiRoute {
  method: OpenApiHttpMethod;
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  scope: OpenApiRouteScope;
  queryParameters?: Record<string, unknown>[];
  requestBodySchema?: string;
  responseSchema?: string;
  successStatus?: "200" | "201";
}

const routes: OpenApiRoute[] = [
  {
    method: "get",
    path: "/health",
    operationId: "getHealth",
    summary: "Read local API health",
    tags: ["System"],
    scope: "public",
    responseSchema: "HealthResponse",
  },
  {
    method: "post",
    path: "/api/setup/tokens",
    operationId: "createSetupToken",
    summary: "Create a local admin token (loopback setup)",
    tags: ["Tokens"],
    scope: "setup",
    requestBodySchema: "SetupTokenCreateRequest",
    responseSchema: "CapabilityTokenCreatedResponse",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/openapi.json",
    operationId: "getOpenApiDocument",
    summary: "Read the OpenAPI document",
    tags: ["System"],
    scope: "read",
  },
  {
    method: "get",
    path: "/api/config/file",
    operationId: "readConfigFile",
    summary: "Read the greenroom.toml config file with effective-value context",
    tags: ["Config"],
    scope: "admin",
    responseSchema: "ConfigFileResource",
  },
  {
    method: "put",
    path: "/api/config/file",
    operationId: "updateConfigFile",
    summary: "Validate and persist the greenroom.toml config file",
    tags: ["Config"],
    scope: "admin",
    requestBodySchema: "ConfigFileUpdateRequest",
    responseSchema: "ConfigFileResource",
  },
  {
    method: "get",
    path: "/api/harness/status",
    operationId: "readHarnessStatus",
    summary: "Read coding harness bridge readiness",
    tags: ["Harness"],
    scope: "read",
    responseSchema: "HarnessStatusResponse",
  },
  {
    method: "get",
    path: "/api/harness/models/{kind}",
    operationId: "readHarnessModels",
    summary: "List models and reasoning levels for a harness",
    tags: ["Harness"],
    scope: "read",
    queryParameters: [
      {
        name: "refresh",
        in: "query",
        required: false,
        schema: { type: "boolean" },
      },
    ],
    responseSchema: "HarnessModelCatalog",
  },
  {
    method: "get",
    path: "/api/harness/skills/{kind}",
    operationId: "readHarnessSkillStatus",
    summary: "Read Greenroom skill package status for a harness",
    tags: ["Harness"],
    scope: "read",
    responseSchema: "HarnessSkillCheckResponse",
  },
  {
    method: "post",
    path: "/api/harness/skills/{kind}/install",
    operationId: "installHarnessSkill",
    summary: "Install or update the Greenroom skill package for a harness",
    tags: ["Harness"],
    scope: "admin",
    responseSchema: "HarnessSkillInstallResponse",
  },
  {
    method: "post",
    path: "/api/harness/setup-smoke",
    operationId: "runHarnessSetupSmoke",
    summary: "Create a pending setup smoke workflow stub",
    tags: ["Harness"],
    scope: "read",
    requestBodySchema: "HarnessSetupSmokeRequest",
    responseSchema: "HarnessSetupSmokeResponse",
  },
  {
    method: "get",
    path: "/api/tokens",
    operationId: "listTokens",
    summary: "List local capability tokens",
    tags: ["Tokens"],
    scope: "admin",
    responseSchema: "TokenListResponse",
  },
  {
    method: "post",
    path: "/api/tokens",
    operationId: "createToken",
    summary: "Create a local capability token",
    tags: ["Tokens"],
    scope: "admin",
    requestBodySchema: "CapabilityTokenCreateRequest",
    responseSchema: "CapabilityTokenCreatedResponse",
    successStatus: "201",
  },
  {
    method: "post",
    path: "/api/tokens/{tokenId}/revoke",
    operationId: "revokeToken",
    summary: "Revoke a local capability token",
    tags: ["Tokens"],
    scope: "admin",
    responseSchema: "TokenResponse",
  },
  {
    method: "get",
    path: "/api/profiles",
    operationId: "listProfiles",
    summary: "List teaching and model profiles",
    tags: ["Profiles"],
    scope: "read",
    responseSchema: "ProfileListResponse",
  },
  {
    method: "post",
    path: "/api/profiles",
    operationId: "createProfile",
    summary: "Create a local profile",
    tags: ["Profiles"],
    scope: "admin",
    requestBodySchema: "ProfileCreateRequest",
    responseSchema: "ProfileResponse",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/profiles/{profileId}",
    operationId: "readProfile",
    summary: "Read a local profile",
    tags: ["Profiles"],
    scope: "read",
    responseSchema: "ProfileResponse",
  },
  {
    method: "post",
    path: "/api/profiles/{profileId}",
    operationId: "updateProfile",
    summary: "Update a local profile",
    tags: ["Profiles"],
    scope: "admin",
    requestBodySchema: "ProfileUpdateRequest",
    responseSchema: "ProfileResponse",
  },
  {
    method: "post",
    path: "/api/profiles/{profileId}/delete",
    operationId: "deleteProfile",
    summary: "Delete a local profile",
    tags: ["Profiles"],
    scope: "admin",
    responseSchema: "ProfileResponse",
  },
  {
    method: "get",
    path: "/api/repositories",
    operationId: "listRepositories",
    summary: "List registered repositories",
    tags: ["Repositories"],
    scope: "read",
    responseSchema: "RepositoryListResponse",
  },
  {
    method: "post",
    path: "/api/repositories",
    operationId: "registerRepository",
    summary: "Register a local Git repository",
    tags: ["Repositories"],
    scope: "review:write",
    requestBodySchema: "RepositoryRegistrationRequest",
    responseSchema: "RepositoryResponse",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/repositories/{repositoryId}/refs",
    operationId: "listRepositoryRefs",
    summary: "List local repository refs",
    tags: ["Repositories"],
    scope: "read",
  },
  {
    method: "get",
    path: "/api/repositories/{repositoryId}/commits",
    operationId: "listRepositoryCommits",
    summary: "List or search local commits",
    tags: ["Repositories"],
    scope: "read",
  },
  {
    method: "get",
    path: "/api/repositories/{repositoryId}/base-candidates",
    operationId: "listRepositoryBaseCandidates",
    summary: "List default base candidates",
    tags: ["Repositories"],
    scope: "read",
  },
  {
    method: "get",
    path: "/api/reviews",
    operationId: "listReviews",
    summary: "List review PRs",
    tags: ["Reviews"],
    scope: "read",
    queryParameters: [
      {
        name: "state",
        in: "query",
        required: false,
        description: "Filter by review state. Defaults to open.",
        schema: { $ref: "#/components/schemas/ReviewStateFilter", default: "open" },
      },
    ],
    responseSchema: "ReviewListResponse",
  },
  {
    method: "post",
    path: "/api/reviews/preview",
    operationId: "previewReview",
    summary: "Preview a review diff without persisting it",
    tags: ["Reviews"],
    scope: "read",
    requestBodySchema: "ReviewCreateRequest",
  },
  {
    method: "post",
    path: "/api/reviews",
    operationId: "createReview",
    summary: "Create a review PR",
    tags: ["Reviews"],
    scope: "review:write",
    requestBodySchema: "ReviewCreateRequest",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}",
    operationId: "readReview",
    summary: "Read review metadata",
    tags: ["Reviews"],
    scope: "read",
    responseSchema: "ReviewResponse",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/diff",
    operationId: "readReviewDiff",
    summary: "Read the current structured review diff",
    tags: ["Reviews"],
    scope: "read",
    queryParameters: [
      {
        name: "path",
        in: "query",
        required: false,
        description: "When provided, return only the changed file matching this path or old path.",
        schema: { type: "string" },
      },
    ],
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/revisions",
    operationId: "listReviewRevisions",
    summary: "List review revisions",
    tags: ["Reviews"],
    scope: "read",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/revisions/{revisionId}",
    operationId: "readReviewRevision",
    summary: "Read one review revision diff",
    tags: ["Reviews"],
    scope: "read",
    queryParameters: [
      {
        name: "path",
        in: "query",
        required: false,
        description: "When provided, return only the changed file matching this path or old path.",
        schema: { type: "string" },
      },
    ],
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/workflow-runs",
    operationId: "listWorkflowRunsForReview",
    summary: "List workflow runs for a review",
    tags: ["Workflows"],
    scope: "read",
    responseSchema: "WorkflowRunListResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/workflow-runs",
    operationId: "createWorkflowRunForReview",
    summary: "Create a pending workflow run for review consent",
    tags: ["Workflows"],
    scope: "review:write",
    requestBodySchema: "WorkflowRunCreateRequest",
    responseSchema: "WorkflowRunResponse",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/workflow-runs",
    operationId: "listActiveWorkflowRuns",
    summary: "List active (queued/running/repairing) workflow runs across all reviews",
    tags: ["Workflows"],
    scope: "read",
    responseSchema: "WorkflowRunListResponse",
  },
  {
    method: "get",
    path: "/api/workflow-runs/{runId}",
    operationId: "readWorkflowRun",
    summary: "Read a workflow run",
    tags: ["Workflows"],
    scope: "read",
    responseSchema: "WorkflowRunResponse",
  },
  {
    method: "get",
    path: "/api/workflow-runs/{runId}/events",
    operationId: "listWorkflowRunEvents",
    summary: "List workflow events or persisted harness stream events for a run",
    tags: ["Workflows"],
    scope: "read",
    queryParameters: [
      {
        name: "since",
        in: "query",
        required: false,
        description:
          "When present, returns normalized harness stream events with sequence greater than this cursor instead of workflow events.",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
      {
        name: "stream",
        in: "query",
        required: false,
        description:
          "Set to 1 to receive normalized harness stream events as text/event-stream; requires the same bearer auth.",
        schema: { type: "string", enum: ["1"] },
      },
    ],
    responseSchema: "WorkflowRunEventListResponse",
  },
  {
    method: "get",
    path: "/api/workflow-runs/{runId}/transcripts",
    operationId: "listWorkflowRunTranscripts",
    summary: "List redacted harness transcripts for a workflow run",
    tags: ["Workflows"],
    scope: "read",
    responseSchema: "WorkflowRunTranscriptListResponse",
  },
  {
    method: "get",
    path: "/api/workflow-runs/{runId}/diagnostics",
    operationId: "readWorkflowRunDiagnostics",
    summary: "Read derived failure diagnostics for a workflow run",
    tags: ["Workflows"],
    scope: "read",
    responseSchema: "WorkflowRunDiagnosticsResponse",
  },
  {
    method: "post",
    path: "/api/workflow-transcripts/purge",
    operationId: "purgeWorkflowTranscripts",
    summary: "Delete all persisted workflow transcripts",
    tags: ["Workflows"],
    scope: "admin",
    responseSchema: "WorkflowTranscriptPurgeResponse",
  },
  {
    method: "post",
    path: "/api/workflow-runs/{runId}/approve",
    operationId: "approveWorkflowRun",
    summary: "Approve workflow consent and queue execution",
    tags: ["Workflows"],
    scope: "review:write",
    responseSchema: "WorkflowRunResponse",
  },
  {
    method: "post",
    path: "/api/workflow-runs/{runId}/cancel",
    operationId: "cancelWorkflowRun",
    summary: "Cancel a workflow run",
    tags: ["Workflows"],
    scope: "review:write",
    requestBodySchema: "WorkflowRunCancelRequest",
    responseSchema: "WorkflowRunResponse",
  },
  {
    method: "post",
    path: "/api/workflow-runs/{runId}/retry",
    operationId: "retryWorkflowRun",
    summary: "Create a retry run from a failed or cancelled workflow",
    tags: ["Workflows"],
    scope: "review:write",
    responseSchema: "WorkflowRunResponse",
    successStatus: "201",
  },
  {
    method: "post",
    path: "/api/workflow-runs/{runId}/recover-fingerprint",
    operationId: "recoverWorkflowRunFingerprint",
    summary:
      "Recover a fingerprint-failed run: refresh the review and start a consented run against the new revision",
    tags: ["Workflows"],
    scope: "review:write",
    responseSchema: "WorkflowRunFingerprintRecoveryResponse",
    successStatus: "201",
  },
  {
    method: "post",
    path: "/api/workflow-runs/{runId}/draft",
    operationId: "submitWorkflowDraft",
    summary: "Submit a run-scoped workflow draft for validation",
    tags: ["Workflows"],
    scope: "read",
    requestBodySchema: "WorkflowDraftSubmissionRequest",
    responseSchema: "WorkflowDraftSubmissionResponse",
  },
  {
    method: "post",
    path: "/api/workflow-runs/{runId}/progress",
    operationId: "reportWorkflowRunProgress",
    summary: "Report run-scoped workflow progress from a harness actor",
    tags: ["Workflows"],
    scope: "read",
    requestBodySchema: "WorkflowProgressReportRequest",
    responseSchema: "WorkflowProgressReportResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/refresh",
    operationId: "refreshReview",
    summary: "Refresh a review revision",
    tags: ["Reviews"],
    scope: "review:write",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/worktree-status",
    operationId: "readReviewWorktreeStatus",
    summary: "Check whether the worktree changed since the review's latest revision snapshot",
    tags: ["Reviews"],
    scope: "read",
    responseSchema: "ReviewWorktreeStatusResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/close",
    operationId: "closeReview",
    summary: "Close a review",
    tags: ["Reviews"],
    scope: "review:write",
    responseSchema: "ReviewResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/reopen",
    operationId: "reopenReview",
    summary: "Reopen a closed review",
    tags: ["Reviews"],
    scope: "review:write",
    responseSchema: "ReviewResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/handoff",
    operationId: "createHandoff",
    summary: "Create a selected-thread handoff bundle",
    tags: ["Handoffs"],
    scope: "read",
    requestBodySchema: "HandoffRequest",
    responseSchema: "HandoffResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/teaching/consent",
    operationId: "createTeachingConsent",
    summary: "Preview teaching context and create a teaching run (optionally one-click started)",
    tags: ["Teaching"],
    scope: "review:write",
    requestBodySchema: "TeachingConsentCreateRequest",
    responseSchema: "TeachingRunResponse",
    successStatus: "201",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/teaching/promote",
    operationId: "promoteTeachingPoint",
    summary: "Promote a teaching point into an anchored review thread",
    tags: ["Teaching"],
    scope: "comment:write",
    requestBodySchema: "TeachingPromotionRequest",
    responseSchema: "ThreadResponse",
    successStatus: "201",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/builtin-review/consent",
    operationId: "createBuiltinReviewConsent",
    summary: "Preview built-in AI review context and create a run (optionally one-click started)",
    tags: ["Built-in Review"],
    scope: "review:write",
    requestBodySchema: "BuiltinReviewConsentCreateRequest",
    responseSchema: "BuiltinReviewRunResponse",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/builtin-review/runs/{runId}",
    operationId: "readBuiltinReviewRun",
    summary: "Read a built-in AI review run",
    tags: ["Built-in Review"],
    scope: "read",
    responseSchema: "BuiltinReviewRunResponse",
  },
  {
    method: "post",
    path: "/api/builtin-review/runs/{runId}/approve",
    operationId: "approveBuiltinReviewRun",
    summary: "Approve context and execute a built-in AI review run",
    tags: ["Built-in Review"],
    scope: "comment:write",
    responseSchema: "BuiltinReviewRunResponse",
  },
  {
    method: "post",
    path: "/api/builtin-review/runs/{runId}/approve-draft",
    operationId: "approveBuiltinReviewDraft",
    summary: "Approve validated built-in AI review draft findings and create threads",
    tags: ["Built-in Review"],
    scope: "comment:write",
    responseSchema: "BuiltinReviewRunResponse",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/spotlight/views",
    operationId: "listSpotlightViews",
    summary: "List Spotlight views for a review",
    tags: ["Spotlight"],
    scope: "read",
    responseSchema: "SpotlightViewListResponse",
  },
  {
    method: "get",
    path: "/api/spotlight/views/{viewRef}",
    operationId: "readSpotlightView",
    summary: "Read one Spotlight view by global ref such as SV-3",
    tags: ["Spotlight"],
    scope: "read",
    responseSchema: "SpotlightViewResponse",
  },
  {
    method: "get",
    path: "/api/spotlight/views/{viewRef}/diff",
    operationId: "readSpotlightViewDiff",
    summary: "Read the current diff scoped to a Spotlight view",
    tags: ["Spotlight"],
    scope: "read",
    responseSchema: "SpotlightViewDiffResponse",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/spotlight/coverage",
    operationId: "readSpotlightCoverage",
    summary: "Read changed lines that are not covered by any Spotlight view",
    tags: ["Spotlight"],
    scope: "read",
    responseSchema: "SpotlightCoverageResponse",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/spotlight/line-membership",
    operationId: "readSpotlightLineMembership",
    summary: "Read Spotlight view membership for review diff lines",
    tags: ["Spotlight"],
    scope: "read",
    responseSchema: "SpotlightLineMembershipResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/spotlight/runs",
    operationId: "createSpotlightRun",
    summary: "Create a Spotlight generation or update run",
    tags: ["Spotlight"],
    scope: "review:write",
    requestBodySchema: "SpotlightRunCreateRequest",
    responseSchema: "SpotlightRunResponse",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/spotlight/runs/{runId}",
    operationId: "readSpotlightRun",
    summary: "Read a Spotlight run",
    tags: ["Spotlight"],
    scope: "read",
    responseSchema: "SpotlightRunResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/spotlight/runs/{runId}/approve-context",
    operationId: "approveSpotlightRunContext",
    summary: "Approve Spotlight run context",
    tags: ["Spotlight"],
    scope: "review:write",
    responseSchema: "SpotlightRunResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/spotlight/runs/{runId}/refine",
    operationId: "refineSpotlightRunPlan",
    summary: "Refine a gated Spotlight run plan",
    tags: ["Spotlight"],
    scope: "review:write",
    requestBodySchema: "SpotlightRunRefineRequest",
    responseSchema: "SpotlightRunResponse",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/spotlight/runs/{runId}/approve-plan",
    operationId: "approveSpotlightRunPlan",
    summary: "Approve a Spotlight run plan",
    tags: ["Spotlight"],
    scope: "review:write",
    requestBodySchema: "SpotlightRunApprovePlanRequest",
    responseSchema: "SpotlightRunResponse",
  },
  {
    method: "get",
    path: "/api/teaching/runs/{runId}",
    operationId: "readTeachingRun",
    summary: "Read a teaching run",
    tags: ["Teaching"],
    scope: "read",
    responseSchema: "TeachingRunResponse",
  },
  {
    method: "post",
    path: "/api/teaching/runs/{runId}/approve",
    operationId: "approveTeachingRun",
    summary: "Approve context and execute a teaching run",
    tags: ["Teaching"],
    scope: "review:write",
    responseSchema: "TeachingRunResponse",
  },
  {
    method: "post",
    path: "/api/teaching/runs/{runId}/follow-up",
    operationId: "answerTeachingFollowUp",
    summary: "Ask a follow-up within an approved teaching run scope",
    tags: ["Teaching"],
    scope: "review:write",
    requestBodySchema: "TeachingFollowUpRequest",
    responseSchema: "TeachingFollowUpResponse",
  },
  {
    method: "post",
    path: "/api/agent-events",
    operationId: "createAgentEvent",
    summary: "Record an external agent event",
    tags: ["Agent Events"],
    scope: "comment:write",
    requestBodySchema: "AgentEventCreateRequest",
    responseSchema: "AgentEventResponse",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/reviews/{reviewId}/threads",
    operationId: "listThreads",
    summary: "List review threads",
    tags: ["Threads"],
    scope: "read",
  },
  {
    method: "post",
    path: "/api/reviews/{reviewId}/threads",
    operationId: "createThread",
    summary: "Create an anchored review thread",
    tags: ["Threads"],
    scope: "comment:write",
    requestBodySchema: "ThreadCreateRequest",
    successStatus: "201",
  },
  {
    method: "get",
    path: "/api/threads/{threadRef}",
    operationId: "readThread",
    summary: "Read a thread by global ref such as GT-12",
    tags: ["Threads"],
    scope: "read",
  },
  {
    method: "post",
    path: "/api/threads/{threadRef}/comments",
    operationId: "replyToThread",
    summary: "Reply to a thread",
    tags: ["Threads"],
    scope: "comment:write",
    requestBodySchema: "ThreadReplyRequest",
    successStatus: "201",
  },
  {
    method: "post",
    path: "/api/threads/{threadRef}/resolve",
    operationId: "resolveThread",
    summary: "Resolve a thread",
    tags: ["Threads"],
    scope: "thread:resolve",
  },
  {
    method: "post",
    path: "/api/threads/{threadRef}/dismiss",
    operationId: "dismissThread",
    summary: "Dismiss a thread",
    tags: ["Threads"],
    scope: "thread:resolve",
  },
  {
    method: "post",
    path: "/api/threads/{threadRef}/reopen",
    operationId: "reopenThread",
    summary: "Reopen a thread",
    tags: ["Threads"],
    scope: "thread:resolve",
  },
];

export function createOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Greenroom Local API",
      version: "1.0.0",
    },
    servers: [{ url: "http://127.0.0.1:49331" }],
    tags: [
      { name: "System" },
      { name: "Config" },
      { name: "Tokens" },
      { name: "Profiles" },
      { name: "Repositories" },
      { name: "Reviews" },
      { name: "Workflows" },
      { name: "Threads" },
      { name: "Handoffs" },
      { name: "Agent Events" },
      { name: "Teaching" },
      { name: "Built-in Review" },
      { name: "Spotlight" },
      { name: "Harness" },
    ],
    paths: buildPaths(),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
      schemas,
    },
  };
}

function buildPaths(): Record<string, Record<OpenApiHttpMethod, Record<string, unknown>>> {
  const paths: Record<string, Record<OpenApiHttpMethod, Record<string, unknown>>> = {};

  for (const route of routes) {
    paths[route.path] ??= {} as Record<OpenApiHttpMethod, Record<string, unknown>>;
    const pathItem = paths[route.path]!;
    pathItem[route.method] = buildOperation(route);
  }

  return paths;
}

function buildOperation(route: OpenApiRoute): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    operationId: route.operationId,
    summary: route.summary,
    tags: route.tags,
    responses: buildResponses(route),
  };

  const parameters = [...pathParameters(route.path), ...(route.queryParameters ?? [])];

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  if (route.scope !== "public" && route.scope !== "setup") {
    operation.security = [{ bearerAuth: [] }];
    operation["x-greenroom-required-scope"] = route.scope;
  } else {
    operation.security = [];
    operation["x-greenroom-required-scope"] = route.scope;
  }

  if (route.requestBodySchema !== undefined) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${route.requestBodySchema}` },
        },
      },
    };
  }

  return operation;
}

function buildResponses(route: OpenApiRoute): Record<string, unknown> {
  const successStatus = route.successStatus ?? "200";
  const responses: Record<string, unknown> = {
    [successStatus]: {
      description: "Successful response",
      content: {
        "application/json": {
          schema:
            route.responseSchema === undefined
              ? { type: "object", additionalProperties: true }
              : { $ref: `#/components/schemas/${route.responseSchema}` },
        },
      },
    },
  };

  if (route.scope !== "public" && route.scope !== "setup") {
    responses["401"] = errorResponse("Missing, invalid, or revoked bearer token");
    responses["403"] = errorResponse("Token does not include the required scope");
  }

  responses["400"] = errorResponse("Request validation failed");
  responses["404"] = errorResponse("Resource was not found");
  responses["500"] = errorResponse("Internal server error");

  return responses;
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
      },
    },
  };
}

function pathParameters(path: string): Record<string, unknown>[] {
  return Array.from(path.matchAll(/\{([^}]+)\}/gu)).map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
    ...(match[1] === "reviewId"
      ? {
          description:
            "Review display ref in the exact format GR-<n>, such as GR-1. The only accepted form; opaque review_<uuid> ids return 404.",
        }
      : {}),
    ...(match[1] === "threadRef"
      ? {
          description:
            "Global thread ref in the exact format GT-<n>, such as GT-12. The only accepted form; opaque thread_<uuid> ids return 404.",
        }
      : {}),
    ...(match[1] === "viewRef"
      ? {
          description:
            "Global Spotlight view ref in the exact format SV-<n>, such as SV-3. The only accepted form; opaque spotlight_view_<uuid> ids return 404.",
        }
      : {}),
  }));
}

const schemas = {
  ErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: { $ref: "#/components/schemas/ApiError" },
    },
  },
  ApiError: {
    type: "object",
    required: ["code", "message"],
    properties: {
      code: {
        type: "string",
        enum: [
          "bad_request",
          "unauthorized",
          "forbidden",
          "not_found",
          "conflict",
          "validation_error",
          "internal_error",
        ],
      },
      message: { type: "string" },
      details: { type: "object", additionalProperties: true },
    },
  },
  HealthResponse: {
    type: "object",
    required: ["status", "databasePath"],
    properties: {
      status: { type: "string", enum: ["ok"] },
      databasePath: { type: "string" },
    },
  },
  GreenroomConfigFile: {
    type: "object",
    description:
      "Non-secret greenroom.toml contents. The bridge token is referenced with tokenEnv or tokenFile; an inline token value is rejected.",
    properties: {
      server: {
        type: "object",
        properties: {
          host: { type: "string", minLength: 1 },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          logLevel: { type: "string", enum: ["debug", "info", "warn", "error"] },
          allowedOrigins: { type: "array", items: { type: "string", minLength: 1 } },
          setupTokenEndpoint: { type: "string", enum: ["auto", "enabled", "disabled"] },
          databasePath: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      mcp: {
        type: "object",
        properties: {
          host: { type: "string", minLength: 1 },
          port: { type: "integer", minimum: 1, maximum: 65535 },
        },
        additionalProperties: false,
      },
      bridge: {
        type: "object",
        properties: {
          baseUrl: { type: "string" },
          tokenEnv: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
          tokenFile: { type: "string", minLength: 1 },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 86400000 },
        },
        additionalProperties: false,
      },
      pathMaps: {
        type: "array",
        items: {
          type: "object",
          required: ["from", "to"],
          properties: {
            from: { type: "string", minLength: 1 },
            to: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
      },
      workflows: {
        type: "object",
        properties: {
          maxConcurrentRuns: { type: "integer", minimum: 1, maximum: 16 },
          idleTimeoutMs: { type: "integer", minimum: 1000, maximum: 86400000 },
          absoluteTimeoutMs: { type: "integer", minimum: 1000, maximum: 86400000 },
          maxMcpResourceReads: { type: "integer", minimum: 1, maximum: 10000 },
          maxRepairAttempts: { type: "integer", minimum: 0, maximum: 20 },
        },
        additionalProperties: false,
      },
      observability: {
        type: "object",
        properties: {
          tracingEnabled: { type: "boolean" },
          otlpEndpoint: { type: "string", minLength: 1 },
          serviceName: { type: "string", minLength: 1 },
          langchainTracingEnabled: { type: "boolean" },
          workflowLogsEnabled: { type: "boolean" },
          workflowLogPath: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  ConfigFileKeyStatus: {
    type: "object",
    required: ["key", "envVar", "source", "secret", "fileValue", "envValue"],
    properties: {
      key: { type: "string" },
      envVar: { type: "string" },
      source: { type: "string", enum: ["env", "file", "default"] },
      secret: { type: "boolean" },
      fileValue: {
        oneOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "array", items: { type: "string" } },
          { type: "null" },
        ],
      },
      envValue: {
        type: ["string", "null"],
        description: "Raw env var value when it overrides the file; always null for secret keys.",
      },
    },
  },
  ConfigFileResource: {
    type: "object",
    required: ["path", "exists", "config", "fileError", "keys"],
    properties: {
      path: { type: "string" },
      exists: { type: "boolean" },
      config: { $ref: "#/components/schemas/GreenroomConfigFile" },
      fileError: {
        type: ["object", "null"],
        required: ["issues"],
        properties: {
          issues: {
            type: "array",
            items: {
              type: "object",
              required: ["path", "message"],
              properties: {
                path: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      keys: {
        type: "array",
        items: { $ref: "#/components/schemas/ConfigFileKeyStatus" },
      },
    },
  },
  ConfigFileUpdateRequest: {
    type: "object",
    required: ["config"],
    properties: {
      config: { $ref: "#/components/schemas/GreenroomConfigFile" },
    },
    additionalProperties: false,
  },
  HarnessStatusResponse: {
    type: "object",
    required: [
      "configured",
      "baseUrl",
      "healthy",
      "runtimeMode",
      "availableKinds",
      "harnesses",
      "detectedHarnesses",
      "bridgeCapabilities",
      "errorMessage",
    ],
    properties: {
      configured: { type: "boolean" },
      baseUrl: { type: ["string", "null"] },
      healthy: { type: "boolean" },
      runtimeMode: {
        type: "string",
        enum: ["disabled", "bridge", "sidecar", "in_process"],
      },
      availableKinds: {
        type: "array",
        items: { $ref: "#/components/schemas/HarnessStatusAvailableKind" },
      },
      harnesses: {
        type: "array",
        items: { $ref: "#/components/schemas/HarnessKindSetupStatus" },
      },
      detectedHarnesses: {
        type: "array",
        description:
          "Harness CLIs detected by the bridge at startup or on demand (V2-024). Empty when the bridge is unconfigured, unreachable, or does not support detection.",
        items: { $ref: "#/components/schemas/HarnessDetectedCli" },
      },
      bridgeCapabilities: {
        type: "array",
        description: "Bridge-advertised optional features. Older bridges report an empty array.",
        items: {
          type: "string",
          enum: [
            "run_jobs",
            "heartbeat",
            "repository_snapshot_git_archive",
            "repository_snapshot_git_worktree",
          ],
        },
      },
      errorMessage: { type: ["string", "null"] },
    },
  },
  HarnessModelCatalog: {
    type: "object",
    required: ["kind", "source", "refreshedAt", "diagnostics", "models"],
    properties: {
      kind: { type: "string" },
      source: { type: "string", enum: ["live", "built_in", "fallback"] },
      refreshedAt: { type: "string", format: "date-time" },
      diagnostics: { type: "array", items: { type: "string" } },
      models: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "label", "isDefault", "reasoningLevels"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            isDefault: { type: "boolean" },
            reasoningLevels: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "label"],
                properties: { id: { type: "string" }, label: { type: "string" } },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  HarnessDetectedCli: {
    type: "object",
    required: [
      "kind",
      "label",
      "command",
      "found",
      "path",
      "version",
      "lastVerifiedVersion",
      "recommendSmoke",
      "probedAt",
      "message",
    ],
    properties: {
      kind: { type: "string" },
      label: { type: "string" },
      command: { type: "string", description: "Binary name the harness kind preset invokes." },
      found: { type: "boolean" },
      path: { type: ["string", "null"], description: "Resolved executable path when found." },
      version: { type: ["string", "null"], description: "Detected version command output." },
      lastVerifiedVersion: {
        type: ["string", "null"],
        description:
          "Last version that passed a recorded smoke run (or the first-seen baseline version).",
      },
      recommendSmoke: {
        type: "boolean",
        description:
          "True when the detected version differs from lastVerifiedVersion, so a setup smoke run is recommended.",
      },
      probedAt: { type: "string" },
      message: {
        type: ["string", "null"],
        description: "Probe diagnostic when the CLI was not found or its version probe failed.",
      },
    },
  },
  HarnessStatusAvailableKind: {
    type: "object",
    required: [
      "kind",
      "label",
      "defaultModel",
      "defaultModelDisplay",
      "supportedWorkflows",
      "skillSupport",
      "mcp",
      "smokeTest",
    ],
    properties: {
      kind: { type: "string" },
      label: { type: "string" },
      defaultModel: { type: "string" },
      defaultModelDisplay: { type: "string" },
      supportedWorkflows: { type: "array", items: { type: "string" } },
      skillSupport: { type: "object", additionalProperties: true },
      mcp: { type: "object", additionalProperties: true },
      smokeTest: { type: "object", additionalProperties: true },
    },
  },
  HarnessLocalCliStatus: {
    type: "object",
    required: ["status", "path", "version", "message"],
    properties: {
      status: { type: "string", enum: ["installed", "missing", "unsupported", "unknown"] },
      path: { type: ["string", "null"] },
      version: { type: ["string", "null"] },
      message: { type: ["string", "null"] },
    },
  },
  HarnessSkillStatusDetail: {
    type: "object",
    required: [
      "skillMode",
      "status",
      "packageName",
      "expectedVersion",
      "installedVersion",
      "path",
      "diagnostics",
    ],
    properties: {
      skillMode: { type: "string", enum: ["managed_package", "inline_prompt"] },
      status: {
        type: "string",
        enum: ["current", "missing", "outdated", "unsupported", "unknown"],
      },
      packageName: { type: ["string", "null"] },
      expectedVersion: { type: ["string", "null"] },
      installedVersion: { type: ["string", "null"] },
      path: { type: ["string", "null"] },
      diagnostics: { type: "array", items: { type: "string" } },
    },
  },
  HarnessKindSetupStatus: {
    allOf: [
      { $ref: "#/components/schemas/HarnessStatusAvailableKind" },
      {
        type: "object",
        required: ["cli", "bridge", "skill", "mcpSetup"],
        properties: {
          cli: { $ref: "#/components/schemas/HarnessLocalCliStatus" },
          bridge: {
            type: "object",
            required: ["configured", "commandConfigured"],
            properties: {
              configured: { type: "boolean" },
              commandConfigured: { type: "boolean" },
            },
          },
          skill: { $ref: "#/components/schemas/HarnessSkillStatusDetail" },
          mcpSetup: {
            type: "object",
            required: ["status", "smokeResource", "diagnostics"],
            properties: {
              status: {
                type: "string",
                enum: ["configured", "not_configured", "unknown", "unsupported"],
              },
              smokeResource: { type: ["string", "null"] },
              diagnostics: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    ],
  },
  HarnessSkillCheckResponse: {
    type: "object",
    required: ["kind", "skill"],
    properties: {
      kind: { type: "string" },
      skill: { $ref: "#/components/schemas/HarnessSkillStatusDetail" },
    },
  },
  HarnessSkillInstallResponse: {
    type: "object",
    required: ["kind", "installed", "skill"],
    properties: {
      kind: { type: "string" },
      installed: { type: "boolean" },
      skill: { $ref: "#/components/schemas/HarnessSkillStatusDetail" },
    },
  },
  HarnessSetupSmokeRequest: {
    type: "object",
    properties: {
      kind: { type: "string", default: "claude-code" },
    },
    additionalProperties: false,
  },
  HarnessSetupSmokeResponse: {
    type: "object",
    required: ["workflowKind", "harnessKind", "status", "message", "checks", "diagnostics"],
    properties: {
      workflowKind: { type: "string", enum: ["setup_smoke"] },
      harnessKind: { type: "string" },
      status: { type: "string", enum: ["passed", "failed"] },
      message: { type: "string" },
      checks: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "status", "summary"],
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["passed", "failed", "skipped"] },
            summary: { type: "string" },
          },
        },
      },
      diagnostics: { type: "array", items: { type: "string" } },
    },
  },
  CapabilityScope: {
    type: "string",
    enum: ["read", "comment:write", "thread:resolve", "review:write", "admin"],
  },
  CapabilityToken: {
    type: "object",
    required: ["id", "name", "scopes", "createdAt", "lastUsedAt", "revokedAt"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      scopes: {
        type: "array",
        items: { $ref: "#/components/schemas/CapabilityScope" },
        minItems: 1,
        uniqueItems: true,
      },
      createdAt: { type: "string", format: "date-time" },
      lastUsedAt: { type: ["string", "null"], format: "date-time" },
      revokedAt: { type: ["string", "null"], format: "date-time" },
    },
  },
  CapabilityTokenCreateRequest: {
    type: "object",
    required: ["name", "scopes"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 160 },
      scopes: {
        type: "array",
        items: { $ref: "#/components/schemas/CapabilityScope" },
        minItems: 1,
        uniqueItems: true,
      },
    },
    additionalProperties: false,
  },
  SetupTokenCreateRequest: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 160, default: "Local setup admin" },
      scopes: {
        type: "array",
        items: { $ref: "#/components/schemas/CapabilityScope" },
        default: ["admin"],
        minItems: 1,
        uniqueItems: true,
      },
    },
    additionalProperties: false,
  },
  CapabilityTokenCreatedResponse: {
    type: "object",
    required: ["token", "plaintextToken"],
    properties: {
      token: { $ref: "#/components/schemas/CapabilityToken" },
      plaintextToken: { type: "string" },
    },
  },
  TokenListResponse: {
    type: "object",
    required: ["tokens"],
    properties: {
      tokens: {
        type: "array",
        items: { $ref: "#/components/schemas/CapabilityToken" },
      },
    },
  },
  TokenResponse: {
    type: "object",
    required: ["token"],
    properties: {
      token: { $ref: "#/components/schemas/CapabilityToken" },
    },
  },
  Profile: {
    type: "object",
    required: [
      "id",
      "name",
      "workflowType",
      "provider",
      "model",
      "description",
      "systemPrompt",
      "modelSettings",
      "allowedTools",
      "contextPreferences",
      "privacy",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string", minLength: 1, maxLength: 160 },
      workflowType: {
        type: "string",
        enum: ["teaching", "spotlight", "review", "handoff", "builtin_review"],
      },
      provider: { type: "string", enum: ["custom", "mock", "harness"] },
      model: { type: "string", minLength: 1, maxLength: 160 },
      description: {
        type: ["string", "null"],
        maxLength: 2000,
        description:
          "Human-readable note shown wherever profiles are listed; seeding uses it to " +
          "explain why a profile exists (e.g. mock fallback when no harness CLI was detected).",
      },
      systemPrompt: { type: ["string", "null"], maxLength: 65000 },
      modelSettings: { type: "object", additionalProperties: true },
      allowedTools: { type: "array", items: { type: "string" } },
      contextPreferences: { type: "object", additionalProperties: true },
      privacy: {
        type: "object",
        required: ["persistTranscript", "consentMode"],
        properties: {
          persistTranscript: { type: "boolean" },
          consentMode: {
            type: "string",
            enum: ["one_click", "two_step", "trusted"],
            default: "one_click",
            description:
              "One-click consent (default) lets run-creation requests pass start=true to " +
              "combine context consent and run approval into one action. Two-step keeps " +
              "the strict create-then-approve flow. Trusted starts runs immediately " +
              "without confirmation and auto-creates threads from validated built-in " +
              "review findings; the consented scope is still recorded as in one-click.",
          },
        },
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  ProfileCreateRequest: {
    type: "object",
    required: ["name", "workflowType", "provider", "model"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 160 },
      workflowType: {
        type: "string",
        enum: ["teaching", "spotlight", "review", "handoff", "builtin_review"],
      },
      provider: { type: "string", enum: ["custom", "mock", "harness"] },
      model: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: ["string", "null"], maxLength: 2000 },
      systemPrompt: { type: ["string", "null"], maxLength: 65000 },
      modelSettings: { type: "object", additionalProperties: true, default: {} },
      allowedTools: { type: "array", items: { type: "string" }, default: [] },
      contextPreferences: { type: "object", additionalProperties: true, default: {} },
      privacy: { type: "object", additionalProperties: true },
    },
    additionalProperties: false,
  },
  ProfileUpdateRequest: {
    type: "object",
    additionalProperties: true,
  },
  ProfileResponse: {
    type: "object",
    required: ["profile"],
    properties: {
      profile: { $ref: "#/components/schemas/Profile" },
    },
  },
  ProfileListResponse: {
    type: "object",
    required: ["profiles"],
    properties: {
      profiles: {
        type: "array",
        items: { $ref: "#/components/schemas/Profile" },
      },
    },
  },
  RepositoryRegistrationRequest: {
    type: "object",
    required: ["rootPath"],
    properties: {
      rootPath: { type: "string" },
      displayName: { type: "string", maxLength: 200 },
      defaultBranchCandidate: { type: ["string", "null"], maxLength: 255 },
    },
    additionalProperties: false,
  },
  RepositoryResponse: {
    type: "object",
    required: ["repository"],
    properties: {
      repository: { type: "object", additionalProperties: true },
    },
  },
  RepositoryListResponse: {
    type: "object",
    required: ["repositories"],
    properties: {
      repositories: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
    },
  },
  ReviewStatus: {
    type: "string",
    enum: ["open", "closed"],
  },
  ReviewStateFilter: {
    type: "string",
    enum: ["open", "closed", "all"],
  },
  ReviewResource: {
    type: "object",
    required: ["review", "repository", "currentRevision"],
    properties: {
      review: { type: "object", additionalProperties: true },
      repository: { type: "object", additionalProperties: true },
      currentRevision: { type: ["object", "null"], additionalProperties: true },
    },
  },
  ReviewResponse: {
    type: "object",
    required: ["review", "repository", "currentRevision"],
    properties: {
      review: { type: "object", additionalProperties: true },
      repository: { type: "object", additionalProperties: true },
      currentRevision: { type: ["object", "null"], additionalProperties: true },
    },
  },
  ReviewListResponse: {
    type: "object",
    required: ["reviews"],
    properties: {
      reviews: {
        type: "array",
        items: { $ref: "#/components/schemas/ReviewResource" },
      },
    },
  },
  ReviewCreateRequest: {
    type: "object",
    required: ["repositoryId"],
    properties: {
      repositoryId: { type: "string" },
      title: { type: "string", maxLength: 240 },
      baseRef: { type: "string" },
      headRef: { type: "string" },
      kind: {
        type: "string",
        enum: [
          "default_branch",
          "branch_to_branch",
          "commit_to_commit",
          "tag_or_ref",
          "same_branch_slice",
          "worktree",
          "whole_repository",
          "custom",
        ],
      },
      comparisonMode: {
        type: "string",
        enum: ["worktree", "refs", "whole_repository"],
      },
    },
    additionalProperties: false,
  },
  WorkflowKind: {
    type: "string",
    enum: [
      "builtin_review",
      "spotlight_plan",
      "spotlight_membership",
      "spotlight_refine",
      "teaching_generate",
      "teaching_follow_up",
      "setup_smoke",
    ],
  },
  WorkflowRunStatus: {
    type: "string",
    enum: [
      "pending_consent",
      "queued",
      "running",
      "awaiting_user",
      "repairing",
      "completed",
      "failed",
      "cancelled",
    ],
  },
  WorkflowRunCreateRequest: {
    type: "object",
    required: ["workflowKind", "profileId"],
    properties: {
      workflowKind: { $ref: "#/components/schemas/WorkflowKind" },
      profileId: { type: "string" },
      revisionId: { type: ["string", "null"] },
      harnessKind: { type: "string", minLength: 1, maxLength: 120 },
      scopeLabel: { type: "string", minLength: 1, maxLength: 240 },
      allowedMcpCapabilities: { type: "array", items: { type: "string" } },
      expectedOutputMode: {
        type: "string",
        enum: [
          "builtin_review_findings",
          "spotlight_outline",
          "spotlight_membership",
          "teaching_draft",
          "teaching_follow_up_answer",
          "setup_smoke_report",
        ],
      },
      idleTimeoutMs: { type: "integer", minimum: 1000, maximum: 86400000 },
      absoluteTimeoutMs: { type: "integer", minimum: 1000, maximum: 86400000 },
      metadata: {
        type: "object",
        description:
          "Optional client diagnostic metadata. Orchestrator-reserved lifecycle, grant, repair, activity, retry, and timeout keys are ignored.",
        additionalProperties: true,
      },
    },
    additionalProperties: false,
  },
  WorkflowRunCancelRequest: {
    type: "object",
    properties: {
      reason: { type: "string", minLength: 1, maxLength: 4000 },
    },
    additionalProperties: false,
  },
  WorkflowDraftSubmissionRequest: {
    type: "object",
    required: ["draft"],
    properties: {
      draft: { type: "object", additionalProperties: true },
    },
    additionalProperties: false,
  },
  WorkflowProgressReportRequest: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string", minLength: 1, maxLength: 2000 },
      completedUnits: { type: "integer", minimum: 0 },
      totalUnits: { type: "integer", minimum: 1 },
      phase: { type: "string", minLength: 1, maxLength: 120 },
    },
    additionalProperties: false,
  },
  WorkflowProgressReportResponse: {
    type: "object",
    required: ["event"],
    properties: {
      event: {
        oneOf: [{ $ref: "#/components/schemas/WorkflowRunEvent" }, { type: "null" }],
      },
    },
  },
  WorkflowRun: {
    type: "object",
    required: [
      "id",
      "workflowKind",
      "reviewDisplayId",
      "revisionId",
      "profileId",
      "harnessKind",
      "status",
      "phase",
      "consentSummary",
      "approvedScope",
      "draftOutput",
      "finalOutput",
      "validationIssues",
      "errorMessage",
      "createdAt",
      "updatedAt",
      "queuedAt",
      "startedAt",
      "finishedAt",
      "completedAt",
      "cancelledAt",
      "metadata",
    ],
    properties: {
      id: { type: "string" },
      workflowKind: { $ref: "#/components/schemas/WorkflowKind" },
      reviewDisplayId: { type: "string" },
      revisionId: { type: "string" },
      profileId: { type: "string" },
      harnessKind: { type: "string" },
      status: { $ref: "#/components/schemas/WorkflowRunStatus" },
      phase: { type: "string" },
      consentSummary: { type: "object", additionalProperties: true },
      approvedScope: { type: ["object", "null"], additionalProperties: true },
      draftOutput: { type: ["object", "null"], additionalProperties: true },
      finalOutput: { type: ["object", "null"], additionalProperties: true },
      validationIssues: { type: "array", items: { type: "object", additionalProperties: true } },
      errorMessage: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      queuedAt: { type: ["string", "null"], format: "date-time" },
      startedAt: { type: ["string", "null"], format: "date-time" },
      finishedAt: { type: ["string", "null"], format: "date-time" },
      completedAt: { type: ["string", "null"], format: "date-time" },
      cancelledAt: { type: ["string", "null"], format: "date-time" },
      metadata: { type: "object", additionalProperties: true },
    },
  },
  WorkflowRunEvent: {
    type: "object",
    required: [
      "id",
      "runId",
      "reviewDisplayId",
      "sequenceNumber",
      "eventType",
      "summary",
      "severity",
      "timestamp",
      "metadata",
    ],
    properties: {
      id: { type: "string" },
      runId: { type: "string" },
      reviewDisplayId: { type: "string" },
      sequenceNumber: { type: "integer", minimum: 1 },
      eventType: { type: "string" },
      summary: { type: "string" },
      severity: { type: "string", enum: ["debug", "info", "warning", "error"] },
      timestamp: { type: "string", format: "date-time" },
      metadata: { type: "object", additionalProperties: true },
    },
  },
  HarnessStreamEvent: {
    type: "object",
    required: ["sequence", "timestamp", "kind", "summary", "text", "name", "data"],
    properties: {
      sequence: { type: "integer", minimum: 1 },
      timestamp: { type: "string", format: "date-time" },
      kind: {
        type: "string",
        enum: [
          "run_started",
          "assistant_text",
          "tool_call",
          "tool_result",
          "stderr_line",
          "result",
          "exit",
        ],
      },
      summary: { type: "string", minLength: 1, maxLength: 2000 },
      text: { type: ["string", "null"], maxLength: 65000 },
      name: { type: ["string", "null"], maxLength: 240 },
      data: { type: "object", additionalProperties: true },
    },
  },
  WorkflowRunTranscriptMetadata: {
    type: "object",
    required: [
      "id",
      "runId",
      "profileId",
      "workflowKind",
      "attempt",
      "status",
      "exitCode",
      "redacted",
      "truncated",
      "promptBytes",
      "outputBytes",
      "stderrBytes",
      "totalBytes",
      "createdAt",
    ],
    properties: {
      id: { type: "string" },
      runId: { type: "string" },
      profileId: { type: ["string", "null"] },
      workflowKind: { type: "string" },
      attempt: { type: "integer", minimum: 0 },
      status: { type: "string", enum: ["completed", "failed"] },
      exitCode: { type: ["integer", "null"] },
      redacted: { type: "boolean" },
      truncated: { type: "boolean" },
      promptBytes: { type: "integer", minimum: 0 },
      outputBytes: { type: "integer", minimum: 0 },
      stderrBytes: { type: "integer", minimum: 0 },
      totalBytes: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  WorkflowRunTranscript: {
    allOf: [
      { $ref: "#/components/schemas/WorkflowRunTranscriptMetadata" },
      {
        type: "object",
        required: ["prompt", "output", "stderr"],
        properties: {
          prompt: { type: "string" },
          output: { type: ["string", "null"] },
          stderr: { type: "string" },
        },
      },
    ],
  },
  WorkflowRunTranscriptListResponse: {
    type: "object",
    required: ["transcripts"],
    properties: {
      transcripts: {
        type: "array",
        items: { $ref: "#/components/schemas/WorkflowRunTranscript" },
      },
    },
  },
  WorkflowTranscriptPurgeResponse: {
    type: "object",
    required: ["deletedCount"],
    properties: {
      deletedCount: { type: "integer", minimum: 0 },
    },
  },
  WorkflowRunFailureCategory: {
    type: "string",
    enum: [
      "bridge_down",
      "process_lost",
      "workspace_setup_failed",
      "workspace_cleanup_failed",
      "invalid_output",
      "unknown_anchor",
      "timeout",
      "fingerprint_changed",
      "unknown",
    ],
    description:
      "Machine-readable failure classification derived from run events, the run error record, and transcript metadata. Null for runs that did not fail.",
  },
  WorkflowRunDiagnostics: {
    type: "object",
    required: [
      "runId",
      "workflowKind",
      "status",
      "phase",
      "failureCategory",
      "summary",
      "errorMessage",
      "failingStep",
      "exitCode",
      "stderrTail",
      "validationIssues",
      "repairAttempts",
      "fingerprint",
      "repositoryAccess",
      "timeoutMs",
      "timeoutBudgetMs",
      "transcripts",
      "transcriptsUrl",
    ],
    properties: {
      runId: { type: "string" },
      workflowKind: { $ref: "#/components/schemas/WorkflowKind" },
      status: { $ref: "#/components/schemas/WorkflowRunStatus" },
      phase: { type: "string" },
      failureCategory: {
        oneOf: [{ $ref: "#/components/schemas/WorkflowRunFailureCategory" }, { type: "null" }],
      },
      summary: { type: "string" },
      errorMessage: { type: ["string", "null"] },
      failingStep: {
        type: ["object", "null"],
        properties: {
          stepId: { type: ["string", "null"] },
          phase: { type: ["string", "null"] },
        },
      },
      exitCode: { type: ["integer", "null"] },
      stderrTail: {
        type: ["string", "null"],
        description: "Last lines of the redacted harness stderr from the persisted transcript.",
      },
      validationIssues: { type: "array", items: { type: "object", additionalProperties: true } },
      repairAttempts: {
        type: "array",
        items: {
          type: "object",
          required: ["attemptNumber", "issueCodes", "timestamp"],
          properties: {
            attemptNumber: { type: "integer", minimum: 1 },
            issueCodes: { type: "array", items: { type: "string" } },
            timestamp: { type: ["string", "null"], format: "date-time" },
          },
        },
      },
      fingerprint: {
        type: "object",
        required: ["changed", "consentedRevisionId", "currentRevisionId"],
        properties: {
          changed: { type: "boolean" },
          consentedRevisionId: { type: "string" },
          currentRevisionId: { type: ["string", "null"] },
        },
      },
      repositoryAccess: {
        type: "object",
        required: [
          "mode",
          "readScopeLabel",
          "revisionId",
          "baseSha",
          "headSha",
          "workspaceStrategy",
          "workspaceSetupStatus",
          "workspaceCleanupStatus",
          "workspaceErrorMessage",
        ],
        properties: {
          mode: { type: ["string", "null"] },
          readScopeLabel: { type: ["string", "null"] },
          revisionId: { type: ["string", "null"] },
          baseSha: { type: ["string", "null"] },
          headSha: { type: ["string", "null"] },
          workspaceStrategy: { type: ["string", "null"] },
          workspaceSetupStatus: { type: ["string", "null"] },
          workspaceCleanupStatus: { type: ["string", "null"] },
          workspaceErrorMessage: {
            type: ["string", "null"],
            description: "Bridge workspace error detail with secret-like values redacted.",
          },
        },
      },
      timeoutMs: { type: ["integer", "null"] },
      timeoutBudgetMs: { type: ["integer", "null"] },
      transcripts: {
        type: "array",
        items: { $ref: "#/components/schemas/WorkflowRunTranscriptMetadata" },
      },
      transcriptsUrl: { type: "string" },
    },
  },
  WorkflowRunDiagnosticsResponse: {
    type: "object",
    required: ["diagnostics"],
    properties: {
      diagnostics: { $ref: "#/components/schemas/WorkflowRunDiagnostics" },
    },
  },
  WorktreeFingerprint: {
    type: "object",
    required: ["headSha", "stagedDiffHash", "unstagedDiffHash"],
    properties: {
      headSha: { type: "string" },
      stagedDiffHash: { type: ["string", "null"] },
      unstagedDiffHash: { type: ["string", "null"] },
    },
  },
  ReviewWorktreeStatusResponse: {
    type: "object",
    required: [
      "reviewDisplayId",
      "revisionId",
      "applicable",
      "dirty",
      "snapshotFingerprint",
      "currentFingerprint",
      "checkedAt",
    ],
    properties: {
      reviewDisplayId: { type: "string" },
      revisionId: { type: ["string", "null"] },
      applicable: {
        type: "boolean",
        description:
          "False when the review's latest revision carries no worktree fingerprint (committed-range reviews).",
      },
      dirty: {
        type: "boolean",
        description:
          "True when the current worktree fingerprint differs from the review's latest revision snapshot, so a run consented against that snapshot may fail with fingerprint_changed.",
      },
      snapshotFingerprint: {
        oneOf: [{ $ref: "#/components/schemas/WorktreeFingerprint" }, { type: "null" }],
      },
      currentFingerprint: {
        oneOf: [{ $ref: "#/components/schemas/WorktreeFingerprint" }, { type: "null" }],
      },
      checkedAt: { type: "string", format: "date-time" },
    },
  },
  WorkflowRunFingerprintRecoveryResponse: {
    type: "object",
    required: [
      "run",
      "started",
      "consentMode",
      "recoveredFromRunId",
      "review",
      "revision",
      "reusedRevision",
    ],
    properties: {
      run: { $ref: "#/components/schemas/WorkflowRun" },
      started: {
        type: "boolean",
        description:
          "True when the run was approved and queued as part of recovery (one_click/trusted profiles). Two-step profiles leave the run in pending_consent.",
      },
      consentMode: { type: "string", enum: ["one_click", "two_step", "trusted"] },
      recoveredFromRunId: { type: "string" },
      review: { type: "object", additionalProperties: true },
      revision: {
        type: "object",
        additionalProperties: true,
        description:
          "The review's revision after the refresh. The new run's consent summary and approved scope reference this revision, never the failed run's scope.",
      },
      reusedRevision: {
        type: "boolean",
        description:
          "True when the worktree already matched the latest snapshot and no new revision row was created.",
      },
    },
  },
  WorkflowRunResponse: {
    type: "object",
    required: ["run"],
    properties: {
      run: { $ref: "#/components/schemas/WorkflowRun" },
      transcripts: {
        type: "array",
        items: { $ref: "#/components/schemas/WorkflowRunTranscriptMetadata" },
      },
    },
  },
  WorkflowRunListResponse: {
    type: "object",
    required: ["runs"],
    properties: {
      runs: {
        type: "array",
        items: { $ref: "#/components/schemas/WorkflowRun" },
      },
    },
  },
  WorkflowRunEventListResponse: {
    type: "object",
    required: ["events"],
    properties: {
      events: {
        type: "array",
        items: { $ref: "#/components/schemas/WorkflowRunEvent" },
      },
    },
  },
  WorkflowRunHarnessEventListResponse: {
    type: "object",
    required: ["events", "nextCursor", "terminal"],
    properties: {
      events: {
        type: "array",
        items: { $ref: "#/components/schemas/HarnessStreamEvent" },
      },
      nextCursor: { type: "integer", minimum: 0 },
      terminal: { type: "boolean" },
    },
  },
  WorkflowDraftSubmissionResponse: {
    type: "object",
    required: ["run", "valid", "issues", "repairContext"],
    properties: {
      run: { $ref: "#/components/schemas/WorkflowRun" },
      valid: { type: "boolean" },
      issues: { type: "array", items: { type: "object", additionalProperties: true } },
      repairContext: { type: ["object", "null"], additionalProperties: true },
    },
  },
  ThreadCreateRequest: {
    type: "object",
    required: ["reviewDisplayId", "type", "source", "anchor", "firstComment"],
    properties: {
      reviewDisplayId: { type: "string" },
      type: { type: "string", enum: ["question", "issue", "suggestion", "note"] },
      severity: { type: ["string", "null"], enum: ["blocking", "major", "minor", "nit", null] },
      source: { type: "object", additionalProperties: true },
      anchor: { type: "object", additionalProperties: true },
      anchors: {
        type: "array",
        items: { type: "object", additionalProperties: true },
        minItems: 1,
        maxItems: 200,
      },
      firstComment: { type: "object", additionalProperties: true },
    },
    additionalProperties: false,
  },
  ThreadReplyRequest: {
    type: "object",
    required: ["authorKind", "authorDisplayName", "body"],
    properties: {
      parentCommentId: { type: ["string", "null"] },
      authorKind: { type: "string" },
      authorDisplayName: { type: "string" },
      body: { type: "string" },
    },
    additionalProperties: false,
  },
  HandoffRequest: {
    type: "object",
    required: ["reviewDisplayId", "threadRefs"],
    properties: {
      reviewDisplayId: { type: "string" },
      threadRefs: {
        type: "array",
        items: { type: "string", pattern: "^GT-[1-9]\\d*$" },
        minItems: 1,
      },
      desiredOutcome: { type: ["string", "null"], maxLength: 4000 },
    },
    additionalProperties: false,
  },
  HandoffResponse: {
    type: "object",
    required: ["handoff"],
    properties: {
      handoff: { type: "object", additionalProperties: true },
    },
  },
  TeachingConsentCreateRequest: {
    type: "object",
    required: ["profileId"],
    properties: {
      profileId: { type: "string" },
      revisionId: { type: ["string", "null"] },
      scope: {
        oneOf: [
          {
            type: "object",
            required: ["kind"],
            properties: { kind: { type: "string", enum: ["full_pr"] } },
            additionalProperties: false,
          },
          {
            type: "object",
            required: ["kind", "viewRef"],
            properties: {
              kind: { type: "string", enum: ["spotlight_view"] },
              viewRef: {
                type: "string",
                pattern: "^SV-[1-9]\\d*$",
                description: "Spotlight view display ref such as SV-3.",
              },
            },
            additionalProperties: false,
          },
        ],
        default: { kind: "full_pr" },
      },
      maxApproximateTokens: { type: "integer", minimum: 1000, maximum: 80000, default: 16000 },
      start: {
        type: "boolean",
        default: false,
        description:
          "One-click consent: create the run and immediately approve and execute it in one " +
          "atomic request. Rejected with 409 when the profile requires two-step consent.",
      },
    },
    additionalProperties: false,
  },
  TeachingRunResponse: {
    type: "object",
    required: ["run"],
    properties: {
      run: { type: "object", additionalProperties: true },
    },
  },
  BuiltinReviewConsentCreateRequest: {
    type: "object",
    required: ["profileId"],
    properties: {
      profileId: { type: "string" },
      revisionId: { type: ["string", "null"] },
      maxApproximateTokens: { type: "integer", minimum: 1000, maximum: 80000, default: 24000 },
      start: {
        type: "boolean",
        default: false,
        description:
          "One-click consent: create the run and immediately approve and execute it in one " +
          "atomic request. Rejected with 409 when the profile requires two-step consent.",
      },
    },
    additionalProperties: false,
  },
  BuiltinReviewRunResponse: {
    type: "object",
    required: ["run"],
    properties: {
      run: {
        type: "object",
        required: [
          "id",
          "reviewDisplayId",
          "profileId",
          "status",
          "context",
          "createdAt",
          "approvedAt",
          "completedAt",
          "errorMessage",
          "output",
          "createdThreadRefs",
        ],
        properties: {
          id: { type: "string" },
          reviewDisplayId: { type: "string" },
          profileId: { type: "string" },
          status: {
            type: "string",
            enum: [
              "pending_consent",
              "approved",
              "awaiting_user",
              "completed",
              "failed",
              "cancelled",
            ],
          },
          context: { type: "object", additionalProperties: true },
          createdAt: { type: "string", format: "date-time" },
          approvedAt: { type: ["string", "null"], format: "date-time" },
          completedAt: { type: ["string", "null"], format: "date-time" },
          errorMessage: { type: ["string", "null"] },
          output: { type: ["object", "null"], additionalProperties: true },
          createdThreadRefs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  TeachingPromotionRequest: {
    type: "object",
    required: ["anchor", "body"],
    properties: {
      profileId: { type: ["string", "null"] },
      anchor: { type: "object", additionalProperties: true },
      body: { type: "string", minLength: 1, maxLength: 65000 },
      title: { type: ["string", "null"], maxLength: 240 },
    },
    additionalProperties: false,
  },
  TeachingFollowUpRequest: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string", minLength: 1, maxLength: 4000 },
    },
    additionalProperties: false,
  },
  TeachingFollowUpResponse: {
    type: "object",
    required: ["followUp"],
    properties: {
      followUp: { type: "object", additionalProperties: true },
    },
  },
  SpotlightViewHealth: {
    type: "string",
    enum: ["current", "drifted", "outdated"],
  },
  SpotlightRunType: {
    type: "string",
    enum: ["generate", "update", "regenerate", "refine_view"],
  },
  SpotlightRunTrigger: {
    type: "string",
    enum: ["manual", "auto"],
  },
  SpotlightRunStatus: {
    type: "string",
    enum: [
      "pending_consent",
      "queued",
      "planning",
      "awaiting_plan_approval",
      "generating",
      "updating",
      "completed",
      "failed",
    ],
  },
  SpotlightViewOutlineItem: {
    type: "object",
    required: ["title", "intent", "description"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 160 },
      intent: { type: "string", minLength: 1, maxLength: 80 },
      description: { type: "string", minLength: 1, maxLength: 1000 },
    },
    additionalProperties: false,
  },
  SpotlightView: {
    type: "object",
    required: [
      "reviewDisplayId",
      "displayRef",
      "title",
      "description",
      "intent",
      "orderIndex",
      "health",
      "originRunId",
      "lastReconciledRevisionId",
      "createdAt",
      "updatedAt",
      "associatedFiles",
    ],
    properties: {
      reviewDisplayId: { type: "string" },
      displayRef: { type: "string", pattern: "^SV-[1-9]\\d*$" },
      title: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", minLength: 1, maxLength: 8000 },
      intent: { type: "string", minLength: 1, maxLength: 80 },
      orderIndex: { type: "integer", minimum: 0 },
      health: { $ref: "#/components/schemas/SpotlightViewHealth" },
      originRunId: { type: "string" },
      lastReconciledRevisionId: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      associatedFiles: {
        type: "array",
        items: { $ref: "#/components/schemas/SpotlightAssociatedFile" },
      },
    },
  },
  SpotlightAssociatedFile: {
    type: "object",
    required: ["path", "oldPath"],
    properties: {
      path: { type: "string" },
      oldPath: { type: ["string", "null"] },
    },
  },
  SpotlightViewRegion: {
    type: "object",
    required: ["id", "viewRef", "filePath", "oldPath", "anchors", "remapConfidence", "stale"],
    properties: {
      id: { type: "string" },
      viewRef: { type: "string", pattern: "^SV-[1-9]\\d*$" },
      filePath: { type: "string" },
      oldPath: { type: ["string", "null"] },
      anchors: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: { type: "object", additionalProperties: true },
      },
      remapConfidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
      stale: { type: "boolean" },
    },
  },
  SpotlightViewWithRegions: {
    allOf: [
      { $ref: "#/components/schemas/SpotlightView" },
      {
        type: "object",
        required: ["regions"],
        properties: {
          regions: {
            type: "array",
            items: { $ref: "#/components/schemas/SpotlightViewRegion" },
          },
        },
      },
    ],
  },
  SpotlightRun: {
    type: "object",
    required: [
      "id",
      "reviewDisplayId",
      "type",
      "trigger",
      "gated",
      "status",
      "revisionId",
      "profileId",
      "approvedOutline",
      "errorMessage",
      "createdAt",
      "updatedAt",
      "completedAt",
    ],
    properties: {
      id: { type: "string" },
      reviewDisplayId: { type: "string" },
      type: { $ref: "#/components/schemas/SpotlightRunType" },
      trigger: { $ref: "#/components/schemas/SpotlightRunTrigger" },
      gated: { type: "boolean" },
      status: { $ref: "#/components/schemas/SpotlightRunStatus" },
      revisionId: { type: "string" },
      profileId: { type: "string" },
      approvedOutline: {
        type: ["array", "null"],
        items: { $ref: "#/components/schemas/SpotlightViewOutlineItem" },
      },
      errorMessage: { type: ["string", "null"], minLength: 1, maxLength: 4000 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      completedAt: { type: ["string", "null"], format: "date-time" },
    },
  },
  SpotlightRunContextSummary: {
    type: "object",
    required: [
      "review",
      "revision",
      "profile",
      "files",
      "fileCount",
      "hunkCount",
      "changedLineCount",
      "approximateTokenCount",
    ],
    properties: {
      review: {
        type: "object",
        required: ["displayId", "title"],
        properties: {
          displayId: { type: "string" },
          title: { type: "string" },
        },
      },
      revision: {
        type: "object",
        required: ["id", "baseSha", "headSha"],
        properties: {
          id: { type: "string" },
          baseSha: { type: "string" },
          headSha: { type: ["string", "null"] },
        },
      },
      profile: {
        type: "object",
        required: ["id", "name", "provider", "model"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          provider: { type: "string", enum: ["custom", "mock", "harness"] },
          model: { type: "string" },
        },
      },
      files: {
        type: "array",
        items: {
          type: "object",
          required: [
            "path",
            "oldPath",
            "status",
            "additions",
            "deletions",
            "hunkCount",
            "changedLineCount",
          ],
          properties: {
            path: { type: "string" },
            oldPath: { type: ["string", "null"] },
            status: { type: "string" },
            additions: { type: "integer" },
            deletions: { type: "integer" },
            hunkCount: { type: "integer" },
            changedLineCount: { type: "integer" },
          },
        },
      },
      fileCount: { type: "integer" },
      hunkCount: { type: "integer" },
      changedLineCount: { type: "integer" },
      approximateTokenCount: { type: "integer" },
    },
  },
  SpotlightRunResource: {
    allOf: [
      { $ref: "#/components/schemas/SpotlightRun" },
      {
        type: "object",
        required: ["pendingOutline", "contextSummary", "refinementCount"],
        properties: {
          pendingOutline: {
            type: ["array", "null"],
            items: { $ref: "#/components/schemas/SpotlightViewOutlineItem" },
          },
          contextSummary: { $ref: "#/components/schemas/SpotlightRunContextSummary" },
          refinementCount: { type: "integer", minimum: 0 },
        },
      },
    ],
  },
  SpotlightRunCreateRequest: {
    type: "object",
    required: ["type", "trigger", "gated", "revisionId", "profileId"],
    properties: {
      type: { $ref: "#/components/schemas/SpotlightRunType" },
      trigger: { $ref: "#/components/schemas/SpotlightRunTrigger" },
      gated: { type: "boolean" },
      revisionId: { type: "string" },
      profileId: { type: "string" },
      targetViewId: {
        type: "string",
        pattern: "^SV-[1-9]\\d*$",
        description: "Spotlight view display ref such as SV-3 (required for refine_view runs).",
      },
      confirmed: { type: "boolean" },
      start: {
        type: "boolean",
        default: false,
        description:
          "One-click consent: create the Spotlight run and immediately approve its context " +
          "in one atomic request. Rejected with 409 when the profile requires two-step consent.",
      },
    },
    additionalProperties: false,
  },
  SpotlightRunRefineRequest: {
    type: "object",
    required: ["instruction"],
    properties: {
      instruction: { type: "string", minLength: 1, maxLength: 4000 },
    },
    additionalProperties: false,
  },
  SpotlightRunApprovePlanRequest: {
    type: "object",
    required: ["approvedOutline"],
    properties: {
      approvedOutline: {
        type: "array",
        maxItems: 40,
        items: { $ref: "#/components/schemas/SpotlightViewOutlineItem" },
      },
    },
    additionalProperties: false,
  },
  SpotlightViewListResponse: {
    type: "object",
    required: ["views"],
    properties: {
      views: {
        type: "array",
        items: { $ref: "#/components/schemas/SpotlightView" },
      },
    },
  },
  SpotlightViewResponse: {
    type: "object",
    required: ["view"],
    properties: {
      view: { $ref: "#/components/schemas/SpotlightViewWithRegions" },
    },
  },
  SpotlightViewDiffResponse: {
    type: "object",
    required: ["view", "revision", "files", "regions"],
    properties: {
      view: { $ref: "#/components/schemas/SpotlightView" },
      revision: { type: "object", additionalProperties: true },
      files: { type: "array", items: { type: "object", additionalProperties: true } },
      regions: {
        type: "array",
        items: { $ref: "#/components/schemas/SpotlightViewRegion" },
      },
    },
  },
  SpotlightCoverageResponse: {
    type: "object",
    required: ["reviewDisplayId", "revisionId", "unlitAnchors"],
    properties: {
      reviewDisplayId: { type: "string" },
      revisionId: { type: "string" },
      unlitAnchors: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
    },
  },
  SpotlightLineMembershipResponse: {
    type: "object",
    required: ["reviewDisplayId", "revisionId", "memberships"],
    properties: {
      reviewDisplayId: { type: "string" },
      revisionId: { type: "string" },
      memberships: {
        type: "array",
        items: {
          type: "object",
          required: ["anchor", "views"],
          properties: {
            anchor: { type: "object", additionalProperties: true },
            views: {
              type: "array",
              items: { $ref: "#/components/schemas/SpotlightView" },
            },
          },
        },
      },
    },
  },
  SpotlightRunResponse: {
    type: "object",
    required: ["run"],
    properties: {
      run: { $ref: "#/components/schemas/SpotlightRunResource" },
    },
  },
  ThreadResponse: {
    type: "object",
    required: ["thread"],
    properties: {
      thread: { type: "object", additionalProperties: true },
    },
  },
  AgentEventCreateRequest: {
    type: "object",
    required: ["eventType", "source", "summary"],
    properties: {
      reviewDisplayId: { type: ["string", "null"] },
      eventType: { type: "string", enum: ["attempted_fix", "status_update", "note"] },
      source: { type: "object", additionalProperties: true },
      threadRefs: {
        type: "array",
        items: { type: "string", pattern: "^GT-[1-9]\\d*$" },
        default: [],
      },
      summary: { type: "string", minLength: 1, maxLength: 65000 },
      metadata: { type: "object", additionalProperties: true, default: {} },
    },
    additionalProperties: false,
  },
  AgentEventResponse: {
    type: "object",
    required: ["event"],
    properties: {
      event: { type: "object", additionalProperties: true },
    },
  },
} as const;
