import type {
  ApiError,
  BuiltinReviewConsentCreateInput,
  BuiltinReviewRun,
  BuiltinReviewRunId,
  CapabilityScope,
  CapabilityTokenCreatedResponse,
  CapabilityTokenPublic,
  Comment,
  CommentCreateInput,
  DiffFile,
  DiffHunk,
  DiffSummary,
  HarnessSetupSmokeResponse,
  HarnessModelCatalog,
  HarnessSkillCheckResponse,
  HarnessSkillInstallResponse,
  HarnessStatusResponse,
  HarnessStreamEvent,
  Profile,
  ProfileConsentMode,
  ProfileCreateInput,
  ProfileId,
  ProfileUpdateInput,
  Repository,
  RepositoryId,
  ReviewPr,
  ReviewReference,
  ReviewRange,
  ReviewRangeKind,
  ReviewStateFilter,
  ReviewStatus,
  RevisionSnapshot,
  SpotlightApprovedOutline,
  SpotlightRun,
  SpotlightRunId,
  SpotlightView,
  SpotlightViewReference,
  SpotlightViewRegion,
  TeachingConsentCreateInput,
  TeachingFollowUpRequest,
  TeachingFollowUpResponse,
  TeachingPromotionInput,
  TeachingRunId,
  TeachingRunResult,
  ThreadAnchor,
  ThreadCreateInput,
  ThreadReference,
  ThreadStatus,
  ThreadWithComments,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunId,
} from "@greenroom/schemas";

const configuredApiBaseUrl = (import.meta.env.VITE_GREENROOM_API_BASE_URL ?? "").trim();
const requestApiBaseUrl =
  configuredApiBaseUrl.length > 0 ? normalizeBaseUrl(configuredApiBaseUrl) : null;
const configuredApiToken = (import.meta.env.VITE_GREENROOM_API_TOKEN ?? "").trim();
const browserApiTokenStorageKey = "greenroom.apiToken";

export const greenroomApiBaseUrl = requestApiBaseUrl ?? "same-origin /api";

/**
 * The explicitly configured API origin (`VITE_GREENROOM_API_BASE_URL`), or
 * null when requests go same-origin. External-client snippets need
 * a real URL, so they fall back to `window.location.origin` when this is
 * null.
 */
export const greenroomApiConfiguredBaseUrl = requestApiBaseUrl;

export type GreenroomApiTokenSource = "environment" | "browser" | "missing";

export interface GreenroomApiTokenStatus {
  source: GreenroomApiTokenSource;
  token: string | null;
}

export interface GreenroomHealthResponse {
  status: "ok";
  databasePath: string;
}

/**
 * Supervised-service status from `GET /api/runtime/status`: the
 * `greenroom up` supervisor writes a state file the API reads back, so the
 * web Settings page can show service health without any privileged shell.
 */
export interface GreenroomRuntimeServiceStatus {
  name: string;
  state: string;
  port: number | null;
  pid: number | null;
  url: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastExit: { exitCode: number | null; signal: string | null } | null;
  message: string | null;
}

export interface GreenroomRuntimeStatus {
  supervised: boolean;
  reason: "ok" | "no-state-file" | "supervisor-not-running";
  updatedAt: string | null;
  supervisor: { pid: number; startedAt: string } | null;
  dataDir: string;
  services: GreenroomRuntimeServiceStatus[];
}

export interface ApiErrorResponse {
  error: ApiError;
}

export interface GitRefListing {
  kind: "branch" | "tag" | "remote" | "ref";
  name: string;
  fullName: string;
  sha: string;
  objectType: string;
  lastCommitAt: string | null;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
}

export interface GitBaseCandidate {
  ref: string;
  sha: string;
  reason:
    | "tracked_upstream"
    | "remote_head"
    | "remote_default_name"
    | "local_default_name"
    | "explicit_base";
  displayName: string;
}

export type PreviewDiffHunk = Omit<DiffHunk, "id" | "fileId">;

export type PreviewDiffFile = Omit<DiffFile, "id" | "revisionId" | "hunks"> & {
  hunks: PreviewDiffHunk[];
};

export interface ReviewResource {
  review: ReviewPr;
  repository: Repository;
  currentRevision: RevisionSnapshot | null;
}

export interface CreateReviewRequest {
  repositoryId: RepositoryId;
  title?: string;
  baseRef?: string;
  headRef?: string;
  kind?: Exclude<ReviewRangeKind, "worktree">;
  comparisonMode?: "worktree" | "refs" | "whole_repository";
}

export interface ReviewPreviewResponse {
  title: string;
  range: ReviewRange;
  baseSha: string;
  headSha: string;
  worktreeFingerprint: RevisionSnapshot["worktreeFingerprint"];
  baseRefDisplay: string;
  headRefDisplay: string;
  diffSummary: DiffSummary;
  files: PreviewDiffFile[];
}

export interface CreatedReviewResponse {
  review: ReviewPr;
  revision: RevisionSnapshot;
}

export interface ReviewDiffResponse {
  review: ReviewPr;
  revision: RevisionSnapshot;
  files: DiffFile[];
}

export interface RefreshReviewResponse extends CreatedReviewResponse {
  reused: boolean;
  remap: {
    remapped: number;
    outdated: number;
  };
  spotlightRemap: {
    remapped: number;
    stale: number;
    driftedViews: number;
  };
}

/**
 * Result of the cheap worktree dirtiness check. `dirty: true` means the
 * current worktree fingerprint no longer matches the review's latest
 * revision snapshot, so a run consented against that snapshot may fail with
 * `fingerprint_changed`. `applicable` is false for committed-range reviews.
 */
export interface ReviewWorktreeStatus {
  reviewDisplayId: ReviewReference;
  revisionId: RevisionSnapshot["id"] | null;
  applicable: boolean;
  dirty: boolean;
  snapshotFingerprint: RevisionSnapshot["worktreeFingerprint"];
  currentFingerprint: RevisionSnapshot["worktreeFingerprint"];
  checkedAt: string;
}

/**
 * Response of the atomic fingerprint-change recovery action: the review was
 * refreshed to `revision` and `run` is a new run of the same workflow kind
 * and profile consented against that revision. `started` is true for
 * one-click/trusted profiles; two-step profiles land in `pending_consent`.
 */
export interface WorkflowRunFingerprintRecoveryResponse {
  run: WorkflowRun;
  started: boolean;
  consentMode: ProfileConsentMode;
  recoveredFromRunId: WorkflowRunId;
  review: ReviewPr;
  revision: RevisionSnapshot;
  reusedRevision: boolean;
}

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

export interface SpotlightViewDiffResponse {
  view: SpotlightViewResource;
  revision: RevisionSnapshot;
  files: DiffFile[];
  regions: SpotlightViewRegion[];
}

export interface SpotlightCoverageResponse {
  reviewDisplayId: ReviewReference;
  revisionId: RevisionSnapshot["id"];
  unlitAnchors: ThreadAnchor[];
}

export interface SpotlightLineMembershipResponse {
  reviewDisplayId: ReviewReference;
  revisionId: RevisionSnapshot["id"];
  memberships: Array<{
    anchor: ThreadAnchor;
    views: SpotlightViewResource[];
  }>;
}

export interface SpotlightRunContextSummary {
  review: {
    displayId: ReviewPr["displayId"];
    title: string;
  };
  revision: {
    id: RevisionSnapshot["id"];
    baseSha: string;
    headSha: string | null;
  };
  profile: {
    id: ProfileId;
    name: string;
    provider: Profile["provider"];
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

export interface CreateSpotlightRunRequest {
  type: SpotlightRun["type"];
  trigger: SpotlightRun["trigger"];
  gated: boolean;
  revisionId: RevisionSnapshot["id"];
  profileId: ProfileId;
  targetViewId?: SpotlightViewReference;
  confirmed?: boolean;
  start?: boolean;
}

export interface RefineSpotlightRunRequest {
  instruction: string;
}

export interface ApproveSpotlightPlanRequest {
  approvedOutline: SpotlightApprovedOutline;
}

export interface CancelWorkflowRunRequest {
  reason?: string;
}

export interface WorkflowTranscriptPurgeResponse {
  deletedCount: number;
}

export interface WorkflowRunHarnessEventsResponse {
  events: HarnessStreamEvent[];
  nextCursor: number;
  terminal: boolean;
}

export type WorkflowRunFailureCategory =
  | "bridge_down"
  | "process_lost"
  | "workspace_setup_failed"
  | "workspace_cleanup_failed"
  | "invalid_output"
  | "unknown_anchor"
  | "timeout"
  | "fingerprint_changed"
  | "unknown";

export interface WorkflowRunDiagnostics {
  runId: WorkflowRunId;
  status: WorkflowRun["status"];
  failureCategory: WorkflowRunFailureCategory | null;
  summary: string;
  errorMessage: string | null;
  failingStep: { stepId: string | null; phase: string | null } | null;
  exitCode: number | null;
  stderrTail: string | null;
  repairAttempts: Array<{
    attemptNumber: number;
    issueCodes: string[];
    timestamp: string | null;
  }>;
  maxRepairAttempts: number | null;
  fingerprint: {
    changed: boolean;
    consentedRevisionId: string;
    currentRevisionId: string | null;
  };
  repositoryAccess: {
    mode: string | null;
    readScopeLabel: string | null;
    revisionId: string | null;
    baseSha: string | null;
    headSha: string | null;
    workspaceStrategy: string | null;
    workspaceSetupStatus: string | null;
    workspaceCleanupStatus: string | null;
    workspaceErrorMessage: string | null;
  };
  timeoutMs: number | null;
  timeoutBudgetMs: number | null;
  transcripts: Array<Record<string, unknown>>;
  transcriptsUrl: string;
}

export type ReplyThreadRequest = Omit<CommentCreateInput, "threadRef">;

export interface RegisterRepositoryRequest {
  rootPath: string;
  displayName?: string;
  defaultBranchCandidate?: string | null;
}

export interface CapabilityTokenCreateRequest {
  name: string;
  scopes: CapabilityScope[];
}

export interface CommitQuery {
  baseRef?: string;
  headRef?: string;
  search?: string;
  limit?: number;
}

/**
 * Non-secret `greenroom.toml` contents. The bridge token is referenced with
 * `tokenEnv`/`tokenFile`; the server rejects an inline token value.
 */
export interface GreenroomConfigFileData {
  server?: {
    host?: string;
    port?: number;
    logLevel?: "debug" | "info" | "warn" | "error";
    allowedOrigins?: string[];
    setupTokenEndpoint?: "auto" | "enabled" | "disabled";
    databasePath?: string;
    webDist?: string;
  };
  mcp?: {
    host?: string;
    port?: number;
  };
  bridge?: {
    baseUrl?: string;
    tokenEnv?: string;
    tokenFile?: string;
    timeoutMs?: number;
  };
  pathMaps?: Array<{ from: string; to: string }>;
  workflows?: {
    maxConcurrentRuns?: number;
    idleTimeoutMs?: number;
    absoluteTimeoutMs?: number;
    maxMcpResourceReads?: number;
    maxRepairAttempts?: number;
  };
  observability?: {
    tracingEnabled?: boolean;
    otlpEndpoint?: string;
    serviceName?: string;
    langchainTracingEnabled?: boolean;
    workflowLogsEnabled?: boolean;
    workflowLogPath?: string;
  };
}

export type ConfigValueSource = "env" | "file" | "default";

export interface ConfigFileKeyStatus {
  key: string;
  envVar: string;
  source: ConfigValueSource;
  secret: boolean;
  fileValue: string | number | boolean | string[] | null;
  envValue: string | null;
}

export interface ConfigFileValidationIssue {
  path: string;
  message: string;
}

export interface ConfigFileResource {
  path: string;
  exists: boolean;
  config: GreenroomConfigFileData;
  fileError: { issues: ConfigFileValidationIssue[] } | null;
  keys: ConfigFileKeyStatus[];
}

export class GreenroomApiError extends Error {
  readonly status: number;
  readonly apiError: ApiError | null;

  constructor(status: number, message: string, apiError: ApiError | null) {
    super(message);
    this.name = "GreenroomApiError";
    this.status = status;
    this.apiError = apiError;
  }
}

export const greenroomApi = {
  async readHealth(): Promise<GreenroomHealthResponse> {
    return request<GreenroomHealthResponse>("/health");
  },

  async readHarnessStatus(): Promise<HarnessStatusResponse> {
    return request<HarnessStatusResponse>("/api/harness/status");
  },

  async readHarnessModels(kind: string): Promise<HarnessModelCatalog> {
    return request<HarnessModelCatalog>(`/api/harness/models/${encodeURIComponent(kind)}`);
  },

  async readRuntimeStatus(): Promise<GreenroomRuntimeStatus> {
    return request<GreenroomRuntimeStatus>("/api/runtime/status");
  },

  async readHarnessSkill(kind: string): Promise<HarnessSkillCheckResponse> {
    return request<HarnessSkillCheckResponse>(`/api/harness/skills/${encodeURIComponent(kind)}`);
  },

  async installHarnessSkill(kind: string): Promise<HarnessSkillInstallResponse> {
    return request<HarnessSkillInstallResponse>(
      `/api/harness/skills/${encodeURIComponent(kind)}/install`,
      { method: "POST" },
    );
  },

  async runHarnessSetupSmoke(kind: string): Promise<HarnessSetupSmokeResponse> {
    return request<HarnessSetupSmokeResponse>("/api/harness/setup-smoke", {
      method: "POST",
      body: { kind },
    });
  },

  async readConfigFile(): Promise<ConfigFileResource> {
    return request<ConfigFileResource>("/api/config/file");
  },

  async updateConfigFile(config: GreenroomConfigFileData): Promise<ConfigFileResource> {
    return request<ConfigFileResource>("/api/config/file", {
      method: "PUT",
      body: { config },
    });
  },

  async listProfiles(): Promise<Profile[]> {
    const payload = await request<{ profiles: Profile[] }>("/api/profiles");
    return payload.profiles;
  },

  async createProfile(input: ProfileCreateInput): Promise<Profile> {
    const payload = await request<{ profile: Profile }>("/api/profiles", {
      method: "POST",
      body: input,
    });
    return payload.profile;
  },

  async readProfile(profileId: ProfileId): Promise<Profile> {
    const payload = await request<{ profile: Profile }>(`/api/profiles/${profileId}`);
    return payload.profile;
  },

  async updateProfile(profileId: ProfileId, input: ProfileUpdateInput): Promise<Profile> {
    const payload = await request<{ profile: Profile }>(`/api/profiles/${profileId}`, {
      method: "POST",
      body: input,
    });
    return payload.profile;
  },

  async deleteProfile(profileId: ProfileId): Promise<Profile> {
    const payload = await request<{ profile: Profile }>(`/api/profiles/${profileId}/delete`, {
      method: "POST",
    });
    return payload.profile;
  },

  async listTokens(): Promise<CapabilityTokenPublic[]> {
    const payload = await request<{ tokens: CapabilityTokenPublic[] }>("/api/tokens");
    return payload.tokens;
  },

  async createToken(input: CapabilityTokenCreateRequest): Promise<CapabilityTokenCreatedResponse> {
    return request<CapabilityTokenCreatedResponse>("/api/tokens", {
      method: "POST",
      body: input,
    });
  },

  async createSetupToken(
    input: Partial<CapabilityTokenCreateRequest> = {},
  ): Promise<CapabilityTokenCreatedResponse> {
    return request<CapabilityTokenCreatedResponse>("/api/setup/tokens", {
      method: "POST",
      body: input,
    });
  },

  async revokeToken(tokenId: CapabilityTokenPublic["id"]): Promise<CapabilityTokenPublic> {
    const payload = await request<{ token: CapabilityTokenPublic }>(
      `/api/tokens/${tokenId}/revoke`,
      { method: "POST" },
    );
    return payload.token;
  },

  async listRepositories(): Promise<Repository[]> {
    const payload = await request<{ repositories: Repository[] }>("/api/repositories");
    return payload.repositories;
  },

  async registerRepository(input: RegisterRepositoryRequest): Promise<Repository> {
    const payload = await request<{ repository: Repository }>("/api/repositories", {
      method: "POST",
      body: input,
    });
    return payload.repository;
  },

  async listRefs(
    repositoryId: RepositoryId,
    kind: "all" | "branches" | "tags" = "all",
  ): Promise<GitRefListing[]> {
    const payload = await request<{ refs: GitRefListing[] }>(
      `/api/repositories/${repositoryId}/refs`,
      {
        search: { kind },
      },
    );
    return payload.refs;
  },

  async listCommits(repositoryId: RepositoryId, query: CommitQuery = {}): Promise<GitCommit[]> {
    const search: Record<string, string> = {};

    if (query.baseRef !== undefined) {
      search.baseRef = query.baseRef;
    }

    if (query.headRef !== undefined) {
      search.headRef = query.headRef;
    }

    if (query.search !== undefined && query.search.trim().length > 0) {
      search.search = query.search.trim();
    }

    if (query.limit !== undefined) {
      search.limit = String(query.limit);
    }

    const payload = await request<{ commits: GitCommit[] }>(
      `/api/repositories/${repositoryId}/commits`,
      { search },
    );
    return payload.commits;
  },

  async listBaseCandidates(repositoryId: RepositoryId): Promise<GitBaseCandidate[]> {
    const payload = await request<{ candidates: GitBaseCandidate[] }>(
      `/api/repositories/${repositoryId}/base-candidates`,
    );
    return payload.candidates;
  },

  async listReviews(state: ReviewStateFilter = "open"): Promise<ReviewResource[]> {
    const payload = await request<{ reviews: ReviewResource[] }>("/api/reviews", {
      search: { state },
    });
    return payload.reviews;
  },

  async readReview(reviewId: ReviewReference): Promise<ReviewResource> {
    return request<ReviewResource>(`/api/reviews/${encodeURIComponent(reviewId)}`);
  },

  async previewReview(input: CreateReviewRequest): Promise<ReviewPreviewResponse> {
    return request<ReviewPreviewResponse>("/api/reviews/preview", {
      method: "POST",
      body: input,
    });
  },

  async createReview(input: CreateReviewRequest): Promise<CreatedReviewResponse> {
    return request<CreatedReviewResponse>("/api/reviews", {
      method: "POST",
      body: input,
    });
  },

  async readReviewDiff(reviewId: ReviewReference): Promise<ReviewDiffResponse> {
    return request<ReviewDiffResponse>(`/api/reviews/${encodeURIComponent(reviewId)}/diff`);
  },

  async listReviewRevisions(reviewId: ReviewReference): Promise<RevisionSnapshot[]> {
    const payload = await request<{ revisions: RevisionSnapshot[] }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/revisions`,
    );
    return payload.revisions;
  },

  async readReviewRevision(
    reviewId: ReviewReference,
    revisionId: RevisionSnapshot["id"],
  ): Promise<ReviewDiffResponse> {
    return request<ReviewDiffResponse>(
      `/api/reviews/${encodeURIComponent(reviewId)}/revisions/${revisionId}`,
    );
  },

  async refreshReview(reviewId: ReviewReference): Promise<RefreshReviewResponse> {
    return request<RefreshReviewResponse>(`/api/reviews/${encodeURIComponent(reviewId)}/refresh`, {
      method: "POST",
    });
  },

  async readReviewWorktreeStatus(reviewId: ReviewReference): Promise<ReviewWorktreeStatus> {
    return request<ReviewWorktreeStatus>(
      `/api/reviews/${encodeURIComponent(reviewId)}/worktree-status`,
    );
  },

  async transitionReviewStatus(
    reviewId: ReviewReference,
    status: ReviewStatus,
  ): Promise<ReviewResource> {
    const action = status === "open" ? "reopen" : "close";
    return request<ReviewResource>(`/api/reviews/${encodeURIComponent(reviewId)}/${action}`, {
      method: "POST",
    });
  },

  async listWorkflowRuns(reviewId: ReviewReference): Promise<WorkflowRun[]> {
    const payload = await request<{ runs: WorkflowRun[] }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/workflow-runs`,
    );
    return payload.runs;
  },

  async listActiveWorkflowRuns(): Promise<WorkflowRun[]> {
    const payload = await request<{ runs: WorkflowRun[] }>("/api/workflow-runs?status=active");
    return payload.runs;
  },

  async readWorkflowRun(runId: WorkflowRunId): Promise<WorkflowRun> {
    const payload = await request<{ run: WorkflowRun }>(
      `/api/workflow-runs/${encodeURIComponent(runId)}`,
    );
    return payload.run;
  },

  async readWorkflowRunDiagnostics(runId: WorkflowRunId): Promise<WorkflowRunDiagnostics> {
    const payload = await request<{ diagnostics: WorkflowRunDiagnostics }>(
      `/api/workflow-runs/${encodeURIComponent(runId)}/diagnostics`,
    );
    return payload.diagnostics;
  },

  async listWorkflowRunEvents(runId: WorkflowRunId): Promise<WorkflowRunEvent[]> {
    const payload = await request<{ events: WorkflowRunEvent[] }>(
      `/api/workflow-runs/${encodeURIComponent(runId)}/events`,
    );
    return payload.events;
  },

  async listWorkflowRunHarnessEvents(
    runId: WorkflowRunId,
    since = 0,
  ): Promise<WorkflowRunHarnessEventsResponse> {
    return request<WorkflowRunHarnessEventsResponse>(
      `/api/workflow-runs/${encodeURIComponent(runId)}/events?since=${since}`,
    );
  },

  async approveWorkflowRun(runId: WorkflowRunId): Promise<WorkflowRun> {
    const payload = await request<{ run: WorkflowRun }>(
      `/api/workflow-runs/${encodeURIComponent(runId)}/approve`,
      { method: "POST" },
    );
    return payload.run;
  },

  async cancelWorkflowRun(
    runId: WorkflowRunId,
    input: CancelWorkflowRunRequest = {},
  ): Promise<WorkflowRun> {
    const payload = await request<{ run: WorkflowRun }>(
      `/api/workflow-runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST", body: input },
    );
    return payload.run;
  },

  async retryWorkflowRun(runId: WorkflowRunId): Promise<WorkflowRun> {
    const payload = await request<{ run: WorkflowRun }>(
      `/api/workflow-runs/${encodeURIComponent(runId)}/retry`,
      { method: "POST" },
    );
    return payload.run;
  },

  async recoverWorkflowRunFingerprint(
    runId: WorkflowRunId,
  ): Promise<WorkflowRunFingerprintRecoveryResponse> {
    return request<WorkflowRunFingerprintRecoveryResponse>(
      `/api/workflow-runs/${encodeURIComponent(runId)}/recover-fingerprint`,
      { method: "POST" },
    );
  },

  async purgeWorkflowTranscripts(): Promise<WorkflowTranscriptPurgeResponse> {
    return request<WorkflowTranscriptPurgeResponse>("/api/workflow-transcripts/purge", {
      method: "POST",
    });
  },

  async listSpotlightViews(reviewId: ReviewReference): Promise<SpotlightViewResource[]> {
    const payload = await request<{ views: SpotlightViewResource[] }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/views`,
    );
    return payload.views;
  },

  async readSpotlightView(
    viewRef: SpotlightViewReference,
  ): Promise<SpotlightViewWithRegionsResource> {
    const payload = await request<{ view: SpotlightViewWithRegionsResource }>(
      `/api/spotlight/views/${encodeURIComponent(viewRef)}`,
    );
    return payload.view;
  },

  async readSpotlightViewDiff(viewRef: SpotlightViewReference): Promise<SpotlightViewDiffResponse> {
    return request<SpotlightViewDiffResponse>(
      `/api/spotlight/views/${encodeURIComponent(viewRef)}/diff`,
    );
  },

  async readSpotlightCoverage(reviewId: ReviewReference): Promise<SpotlightCoverageResponse> {
    return request<SpotlightCoverageResponse>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/coverage`,
    );
  },

  async readSpotlightLineMembership(
    reviewId: ReviewReference,
  ): Promise<SpotlightLineMembershipResponse> {
    return request<SpotlightLineMembershipResponse>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/line-membership`,
    );
  },

  async createSpotlightRun(
    reviewId: ReviewReference,
    input: CreateSpotlightRunRequest,
  ): Promise<SpotlightRunResource> {
    const payload = await request<{ run: SpotlightRunResource }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/runs`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.run;
  },

  async readSpotlightRun(
    reviewId: ReviewReference,
    runId: SpotlightRunId,
  ): Promise<SpotlightRunResource> {
    const payload = await request<{ run: SpotlightRunResource }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/runs/${runId}`,
    );
    return payload.run;
  },

  async approveSpotlightRunContext(
    reviewId: ReviewReference,
    runId: SpotlightRunId,
  ): Promise<SpotlightRunResource> {
    const payload = await request<{ run: SpotlightRunResource }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/runs/${runId}/approve-context`,
      { method: "POST" },
    );
    return payload.run;
  },

  async refineSpotlightRunPlan(
    reviewId: ReviewReference,
    runId: SpotlightRunId,
    input: RefineSpotlightRunRequest,
  ): Promise<SpotlightRunResource> {
    const payload = await request<{ run: SpotlightRunResource }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/runs/${runId}/refine`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.run;
  },

  async approveSpotlightRunPlan(
    reviewId: ReviewReference,
    runId: SpotlightRunId,
    input: ApproveSpotlightPlanRequest,
  ): Promise<SpotlightRunResource> {
    const payload = await request<{ run: SpotlightRunResource }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/spotlight/runs/${runId}/approve-plan`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.run;
  },

  async createBuiltinReviewConsent(
    reviewId: ReviewReference,
    input: BuiltinReviewConsentCreateInput,
  ): Promise<BuiltinReviewRun> {
    const payload = await request<{ run: BuiltinReviewRun }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/builtin-review/consent`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.run;
  },

  async readBuiltinReviewRun(runId: BuiltinReviewRunId): Promise<BuiltinReviewRun> {
    const payload = await request<{ run: BuiltinReviewRun }>(
      `/api/builtin-review/runs/${encodeURIComponent(runId)}`,
    );
    return payload.run;
  },

  async approveBuiltinReviewRun(runId: BuiltinReviewRunId): Promise<BuiltinReviewRun> {
    const payload = await request<{ run: BuiltinReviewRun }>(
      `/api/builtin-review/runs/${encodeURIComponent(runId)}/approve`,
      { method: "POST" },
    );
    return payload.run;
  },

  async approveBuiltinReviewDraft(runId: BuiltinReviewRunId): Promise<BuiltinReviewRun> {
    const payload = await request<{ run: BuiltinReviewRun }>(
      `/api/builtin-review/runs/${encodeURIComponent(runId)}/approve-draft`,
      { method: "POST" },
    );
    return payload.run;
  },

  async listThreads(reviewId: ReviewReference): Promise<ThreadWithComments[]> {
    const payload = await request<{ threads: ThreadWithComments[] }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/threads`,
    );
    return payload.threads;
  },

  async createThread(
    reviewId: ReviewReference,
    input: ThreadCreateInput,
  ): Promise<ThreadWithComments> {
    const payload = await request<{ thread: ThreadWithComments }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/threads`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.thread;
  },

  async replyToThread(threadRef: ThreadReference, input: ReplyThreadRequest): Promise<Comment> {
    const payload = await request<{ comment: Comment }>(
      `/api/threads/${encodeURIComponent(threadRef)}/comments`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.comment;
  },

  async transitionThreadStatus(
    threadRef: ThreadReference,
    status: ThreadStatus,
  ): Promise<ThreadWithComments> {
    const action = status === "open" ? "reopen" : status === "resolved" ? "resolve" : "dismiss";
    const payload = await request<{ thread: ThreadWithComments }>(
      `/api/threads/${encodeURIComponent(threadRef)}/${action}`,
      { method: "POST" },
    );
    return payload.thread;
  },

  async createTeachingConsent(
    reviewId: ReviewReference,
    input: TeachingConsentCreateInput,
  ): Promise<TeachingRunResult> {
    const payload = await request<{ run: TeachingRunResult }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/teaching/consent`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.run;
  },

  async readTeachingRun(runId: TeachingRunId): Promise<TeachingRunResult> {
    const payload = await request<{ run: TeachingRunResult }>(`/api/teaching/runs/${runId}`);
    return payload.run;
  },

  async approveTeachingRun(runId: TeachingRunId): Promise<TeachingRunResult> {
    const payload = await request<{ run: TeachingRunResult }>(
      `/api/teaching/runs/${runId}/approve`,
      { method: "POST" },
    );
    return payload.run;
  },

  async answerTeachingFollowUp(
    runId: TeachingRunId,
    input: TeachingFollowUpRequest,
  ): Promise<TeachingFollowUpResponse> {
    const payload = await request<{ followUp: TeachingFollowUpResponse }>(
      `/api/teaching/runs/${runId}/follow-up`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.followUp;
  },

  async promoteTeachingPoint(
    reviewId: ReviewReference,
    input: TeachingPromotionInput,
  ): Promise<ThreadWithComments> {
    const payload = await request<{ thread: ThreadWithComments }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/teaching/promote`,
      {
        method: "POST",
        body: input,
      },
    );
    return payload.thread;
  },
};

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  search?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const connection = resolveGreenroomApiConnection();
  const url = buildRequestUrl(path, options.search ?? {}, connection.apiBaseUrl);

  const headers = new Headers({ accept: "application/json" });
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };

  if (connection.apiToken !== null) {
    headers.set("authorization", `Bearer ${connection.apiToken}`);
  }

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach the Greenroom API";
    throw new GreenroomApiError(0, message, null);
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const apiError = parseApiError(payload);
    throw new GreenroomApiError(
      response.status,
      apiError?.message ?? `Greenroom API request failed with ${response.status}`,
      apiError ?? null,
    );
  }

  return payload as T;
}

function buildRequestUrl(
  path: string,
  search: Record<string, string>,
  apiBaseUrl: string | null,
): string | URL {
  const url = new URL(path, apiBaseUrl ?? window.location.origin);

  for (const [key, value] of Object.entries(search)) {
    url.searchParams.set(key, value);
  }

  if (apiBaseUrl === null) {
    return `${url.pathname}${url.search}`;
  }

  return url;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

function parseApiError(payload: unknown): ApiError | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "code" in payload.error &&
    "message" in payload.error
  ) {
    return payload.error as ApiError;
  }

  return undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Unauthenticated probe used by first-launch detection: hits an
 * authenticated endpoint without a bearer token and reports the HTTP status
 * (null when the API is unreachable). A 401 means the API is up and
 * genuinely requires a token the browser does not have, which is the only
 * state that auto-launches the setup wizard.
 */
export async function probeGreenroomApiAuthStatus(): Promise<number | null> {
  try {
    const connection = resolveGreenroomApiConnection();
    const url = buildRequestUrl("/api/repositories", {}, connection.apiBaseUrl);
    const response = await fetch(url, { headers: { accept: "application/json" } });
    return response.status;
  } catch {
    return null;
  }
}

export function readGreenroomApiTokenStatus(): GreenroomApiTokenStatus {
  if (configuredApiToken.length > 0) {
    return { source: "environment", token: configuredApiToken };
  }

  const browserToken = readBrowserApiToken();

  if (browserToken !== null) {
    return { source: "browser", token: browserToken };
  }

  return { source: "missing", token: null };
}

export function readGreenroomApiToken(): string | null {
  return readGreenroomApiTokenStatus().token;
}

export function storeGreenroomApiToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const trimmed = token.trim();

  if (trimmed.length === 0) {
    window.localStorage.removeItem(browserApiTokenStorageKey);
    return;
  }

  window.localStorage.setItem(browserApiTokenStorageKey, trimmed);
}

export function clearStoredGreenroomApiToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(browserApiTokenStorageKey);
}

function readBrowserApiToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const token = window.localStorage.getItem(browserApiTokenStorageKey)?.trim() ?? "";
  return token.length > 0 ? token : null;
}

interface GreenroomApiConnection {
  apiBaseUrl: string | null;
  apiToken: string | null;
}

function resolveGreenroomApiConnection(): GreenroomApiConnection {
  if (configuredApiToken.length > 0) {
    return { apiBaseUrl: requestApiBaseUrl, apiToken: configuredApiToken };
  }

  return { apiBaseUrl: requestApiBaseUrl, apiToken: readBrowserApiToken() };
}
