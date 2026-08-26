import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  BuiltinReviewConsentCreateInput,
  BuiltinReviewRunId,
  BuiltinReviewRunStatus,
  CapabilityTokenPublic,
  ProfileCreateInput,
  ProfileId,
  ProfileUpdateInput,
  RepositoryId,
  ReviewReference,
  ReviewStateFilter,
  ReviewStatus,
  RevisionId,
  ThreadReference,
  SpotlightRunId,
  SpotlightViewReference,
  TeachingConsentCreateInput,
  TeachingFollowUpRequest,
  TeachingPromotionInput,
  TeachingRunId,
  ThreadCreateInput,
  ThreadStatus,
  WorkflowRunId,
  WorkflowRunStatus,
} from "@greenroom/schemas";

import {
  greenroomApi,
  storeGreenroomApiToken,
  type ApproveSpotlightPlanRequest,
  type CancelWorkflowRunRequest,
  type GreenroomConfigFileData,
  type CapabilityTokenCreateRequest,
  type CommitQuery,
  type CreateReviewRequest,
  type CreateSpotlightRunRequest,
  type RefineSpotlightRunRequest,
  type RegisterRepositoryRequest,
  type ReplyThreadRequest,
} from "./client";

export const appKeys = {
  health: ["app", "health"] as const,
  runtimeStatus: ["app", "runtime-status"] as const,
};

export const tokenKeys = {
  all: ["tokens"] as const,
};

export const configKeys = {
  file: ["config", "file"] as const,
};

export const harnessKeys = {
  status: ["harness", "status"] as const,
  models: (kind: string | null) => ["harness", "models", kind] as const,
  skill: (kind: string | null) => ["harness", "skills", kind] as const,
};

export const profileKeys = {
  all: ["profiles"] as const,
  detail: (profileId: ProfileId | null) => ["profiles", profileId] as const,
};

export const repositoryKeys = {
  all: ["repositories"] as const,
  refs: (repositoryId: RepositoryId | null, kind: "all" | "branches" | "tags") =>
    ["repositories", repositoryId, "refs", kind] as const,
  commits: (repositoryId: RepositoryId | null, query: CommitQuery) =>
    ["repositories", repositoryId, "commits", query] as const,
  baseCandidates: (repositoryId: RepositoryId | null) =>
    ["repositories", repositoryId, "base-candidates"] as const,
};

export const reviewKeys = {
  all: ["reviews"] as const,
  list: (state: ReviewStateFilter) => [...reviewKeys.all, "list", state] as const,
  detail: (reviewId: ReviewReference | null) => ["reviews", reviewId] as const,
  diffs: (reviewId: ReviewReference | null) => ["reviews", reviewId, "diff"] as const,
  diff: (reviewId: ReviewReference | null, revisionId: RevisionId | null = null) =>
    [...reviewKeys.diffs(reviewId), revisionId] as const,
  revisions: (reviewId: ReviewReference | null) => ["reviews", reviewId, "revisions"] as const,
  threads: (reviewId: ReviewReference | null) => ["reviews", reviewId, "threads"] as const,
  worktreeStatus: (reviewId: ReviewReference | null) =>
    ["reviews", reviewId, "worktree-status"] as const,
};

export const workflowKeys = {
  all: ["workflow-runs"] as const,
  active: ["workflow-runs", "active"] as const,
  review: (reviewId: ReviewReference | null) => [...workflowKeys.all, "review", reviewId] as const,
  run: (runId: WorkflowRunId | null) => [...workflowKeys.all, "run", runId] as const,
  events: (runId: WorkflowRunId | null) => [...workflowKeys.run(runId), "events"] as const,
  harnessEvents: (runId: WorkflowRunId | null) =>
    [...workflowKeys.run(runId), "harness-events"] as const,
  diagnostics: (runId: WorkflowRunId | null) =>
    [...workflowKeys.run(runId), "diagnostics"] as const,
};

export const builtinReviewKeys = {
  run: (runId: BuiltinReviewRunId | null) => ["builtin-review", "runs", runId] as const,
};

export const teachingKeys = {
  run: (runId: TeachingRunId | null) => ["teaching", "runs", runId] as const,
};

export const spotlightKeys = {
  all: (reviewId: ReviewReference | null) => ["reviews", reviewId, "spotlight"] as const,
  views: (reviewId: ReviewReference | null) => [...spotlightKeys.all(reviewId), "views"] as const,
  viewDiff: (reviewId: ReviewReference | null, viewRef: SpotlightViewReference | null) =>
    [...spotlightKeys.views(reviewId), viewRef, "diff"] as const,
  coverage: (reviewId: ReviewReference | null) =>
    [...spotlightKeys.all(reviewId), "coverage"] as const,
  lineMembership: (reviewId: ReviewReference | null) =>
    [...spotlightKeys.all(reviewId), "line-membership"] as const,
  run: (reviewId: ReviewReference | null, runId: SpotlightRunId | null) =>
    [...spotlightKeys.all(reviewId), "runs", runId] as const,
};

export function useHealth(enabled = true) {
  return useQuery({
    queryKey: appKeys.health,
    queryFn: () => greenroomApi.readHealth(),
    enabled,
  });
}

/**
 * Supervised-service status from `GET /api/runtime/status`. Replaces
 * the retired Electron preload status feed as the source for the Settings
 * "App status" panel.
 */
export function useRuntimeStatus(enabled = true) {
  return useQuery({
    queryKey: appKeys.runtimeStatus,
    queryFn: () => greenroomApi.readRuntimeStatus(),
    enabled,
  });
}

export function useConfigFile(enabled = true) {
  return useQuery({
    queryKey: configKeys.file,
    queryFn: () => greenroomApi.readConfigFile(),
    enabled,
  });
}

export function useUpdateConfigFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: GreenroomConfigFileData) => greenroomApi.updateConfigFile(config),
    onSuccess: async (resource) => {
      queryClient.setQueryData(configKeys.file, resource);
      await queryClient.invalidateQueries({ queryKey: configKeys.file });
    },
  });
}

export function useHarnessStatus(enabled = true) {
  return useQuery({
    queryKey: harnessKeys.status,
    queryFn: () => greenroomApi.readHarnessStatus(),
    enabled,
  });
}

export function useHarnessModels(kind: string | null, enabled = true) {
  return useQuery({
    queryKey: harnessKeys.models(kind),
    queryFn: () =>
      kind === null
        ? Promise.reject(new Error("Missing harness kind"))
        : greenroomApi.readHarnessModels(kind),
    enabled: enabled && kind !== null,
  });
}

export function useHarnessSkill(kind: string | null, enabled = true) {
  return useQuery({
    queryKey: harnessKeys.skill(kind),
    queryFn: () =>
      kind === null
        ? Promise.reject(new Error("Missing harness kind"))
        : greenroomApi.readHarnessSkill(kind),
    enabled: enabled && kind !== null,
  });
}

export function useInstallHarnessSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (kind: string) => greenroomApi.installHarnessSkill(kind),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: harnessKeys.status }),
        queryClient.invalidateQueries({ queryKey: harnessKeys.skill(result.kind) }),
      ]);
    },
  });
}

export function useRunHarnessSetupSmoke() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (kind: string) => greenroomApi.runHarnessSetupSmoke(kind),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: harnessKeys.status });
    },
  });
}

export function useProfiles(enabled = true) {
  return useQuery({
    queryKey: profileKeys.all,
    queryFn: () => greenroomApi.listProfiles(),
    enabled,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProfileCreateInput) => greenroomApi.createProfile(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profileId, input }: { profileId: ProfileId; input: ProfileUpdateInput }) =>
      greenroomApi.updateProfile(profileId, input),
    onSuccess: async (profile) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: profileKeys.all }),
        queryClient.invalidateQueries({ queryKey: profileKeys.detail(profile.id) }),
      ]);
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: ProfileId) => greenroomApi.deleteProfile(profileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

export function useTokens(enabled = true) {
  return useQuery({
    queryKey: tokenKeys.all,
    queryFn: () => greenroomApi.listTokens(),
    enabled,
  });
}

/**
 * Mints a browser capability token through the loopback-only setup endpoint
 * and stores it for all subsequent requests. Shared by the setup
 * wizard, Settings, and the central 401 connect prompt so every surface uses
 * the same token name/scopes and post-mint refetch. Admin scope is required
 * by the endpoint; the web app needs it for Settings (token and config
 * management), and the loopback browser is the local operator.
 */
export function useMintBrowserToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => greenroomApi.createSetupToken({ name: "Browser", scopes: ["admin"] }),
    onSuccess: async (created) => {
      storeGreenroomApiToken(created.plaintextToken);
      // Queries across the app may have failed with 401 before the token
      // existed; refetch everything with the new credentials.
      await queryClient.invalidateQueries();
    },
  });
}

export function useCreateToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CapabilityTokenCreateRequest) => greenroomApi.createToken(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tokenKeys.all });
    },
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tokenId: CapabilityTokenPublic["id"]) => greenroomApi.revokeToken(tokenId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tokenKeys.all });
    },
  });
}

export function useRepositories(enabled = true) {
  return useQuery({
    queryKey: repositoryKeys.all,
    queryFn: () => greenroomApi.listRepositories(),
    enabled,
  });
}

export function useRegisterRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RegisterRepositoryRequest) => greenroomApi.registerRepository(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: repositoryKeys.all });
    },
  });
}

export function useRefs(repositoryId: RepositoryId | null, kind: "all" | "branches" | "tags") {
  return useQuery({
    queryKey: repositoryKeys.refs(repositoryId, kind),
    queryFn: () =>
      repositoryId === null ? Promise.resolve([]) : greenroomApi.listRefs(repositoryId, kind),
    enabled: repositoryId !== null,
  });
}

export function useCommits(repositoryId: RepositoryId | null, query: CommitQuery) {
  return useQuery({
    queryKey: repositoryKeys.commits(repositoryId, query),
    queryFn: () =>
      repositoryId === null ? Promise.resolve([]) : greenroomApi.listCommits(repositoryId, query),
    enabled: repositoryId !== null,
  });
}

export function useBaseCandidates(repositoryId: RepositoryId | null) {
  return useQuery({
    queryKey: repositoryKeys.baseCandidates(repositoryId),
    queryFn: () =>
      repositoryId === null ? Promise.resolve([]) : greenroomApi.listBaseCandidates(repositoryId),
    enabled: repositoryId !== null,
  });
}

export function useReviews(state: ReviewStateFilter = "open") {
  return useQuery({
    queryKey: reviewKeys.list(state),
    queryFn: () => greenroomApi.listReviews(state),
  });
}

export function useReview(reviewId: ReviewReference | null) {
  return useQuery({
    queryKey: reviewKeys.detail(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.readReview(reviewId),
    enabled: reviewId !== null,
  });
}

export function useReviewDiff(
  reviewId: ReviewReference | null,
  revisionId: RevisionId | null = null,
) {
  return useQuery({
    queryKey: reviewKeys.diff(reviewId, revisionId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : revisionId === null
          ? greenroomApi.readReviewDiff(reviewId)
          : greenroomApi.readReviewRevision(reviewId, revisionId),
    enabled: reviewId !== null,
  });
}

export function useReviewRevisions(reviewId: ReviewReference | null) {
  return useQuery({
    queryKey: reviewKeys.revisions(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.listReviewRevisions(reviewId),
    enabled: reviewId !== null,
  });
}

export function useReviewThreads(reviewId: ReviewReference | null) {
  return useQuery({
    queryKey: reviewKeys.threads(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.listThreads(reviewId),
    enabled: reviewId !== null,
  });
}

export function usePreviewReview() {
  return useMutation({
    mutationFn: (input: CreateReviewRequest) => greenroomApi.previewReview(input),
  });
}

export function useCreateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateReviewRequest) => greenroomApi.createReview(input),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.detail(created.review.displayId) }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.diffs(created.review.displayId) }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.revisions(created.review.displayId) }),
      ]);
    },
  });
}

export function useRefreshReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reviewId: ReviewReference) => greenroomApi.refreshReview(reviewId),
    onSuccess: async (refreshed) => {
      await invalidateRefreshedReview(queryClient, refreshed.review);
    },
  });
}

async function invalidateRefreshedReview(
  queryClient: ReturnType<typeof useQueryClient>,
  review: { displayId: ReviewReference },
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.detail(review.displayId) }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.diffs(review.displayId) }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.revisions(review.displayId) }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.threads(review.displayId) }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.worktreeStatus(review.displayId) }),
    queryClient.invalidateQueries({ queryKey: spotlightKeys.all(review.displayId) }),
  ]);
}

export function useReviewWorktreeStatus(reviewId: ReviewReference | null, enabled = true) {
  return useQuery({
    queryKey: reviewKeys.worktreeStatus(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.readReviewWorktreeStatus(reviewId),
    enabled: enabled && reviewId !== null,
    // The check is a handful of local git calls; refresh it periodically so
    // pre-run warnings track worktree edits made outside the app.
    refetchInterval: 15_000,
  });
}

export function useTransitionReviewStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ reviewId, status }: { reviewId: ReviewReference; status: ReviewStatus }) =>
      greenroomApi.transitionReviewStatus(reviewId, status),
    onSuccess: async (resource) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.detail(resource.review.displayId) }),
      ]);
    },
  });
}

export function useWorkflowRuns(reviewId: ReviewReference | null, enabled = true, poll = false) {
  return useQuery({
    queryKey: workflowKeys.review(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.listWorkflowRuns(reviewId),
    enabled: enabled && reviewId !== null,
    refetchInterval: (query) =>
      poll && (query.state.data ?? []).some((run) => isActiveWorkflowRunStatus(run.status))
        ? 1_500
        : false,
  });
}

/**
 * Cross-review active runs: backs the app header run indicator and
 * the completion/failure toasts on every page. Polls quickly while runs are
 * active and slowly otherwise (to notice runs started outside this tab, e.g.
 * via MCP); run mutations invalidate the key so UI-started runs appear
 * immediately.
 */
export function useActiveWorkflowRuns() {
  return useQuery({
    queryKey: workflowKeys.active,
    queryFn: () => greenroomApi.listActiveWorkflowRuns(),
    refetchInterval: (query) => ((query.state.data ?? []).length > 0 ? 2_000 : 10_000),
  });
}

export function useWorkflowRun(runId: WorkflowRunId | null, enabled = true, poll = false) {
  return useQuery({
    queryKey: workflowKeys.run(runId),
    queryFn: () =>
      runId === null
        ? Promise.reject(new Error("Missing workflow run ID"))
        : greenroomApi.readWorkflowRun(runId),
    enabled: enabled && runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return poll || (status !== undefined && isActiveWorkflowRunStatus(status)) ? 1_500 : false;
    },
  });
}

export function useWorkflowRunDiagnostics(runId: WorkflowRunId | null, enabled = true) {
  return useQuery({
    queryKey: workflowKeys.diagnostics(runId),
    queryFn: () =>
      runId === null
        ? Promise.reject(new Error("Missing workflow run ID"))
        : greenroomApi.readWorkflowRunDiagnostics(runId),
    enabled: enabled && runId !== null,
  });
}

export function useWorkflowRunEvents(runId: WorkflowRunId | null, enabled = true, poll = false) {
  return useQuery({
    queryKey: workflowKeys.events(runId),
    queryFn: () =>
      runId === null
        ? Promise.reject(new Error("Missing workflow run ID"))
        : greenroomApi.listWorkflowRunEvents(runId),
    enabled: enabled && runId !== null,
    refetchInterval: poll ? 1_500 : false,
  });
}

export function useWorkflowRunHarnessEvents(
  runId: WorkflowRunId | null,
  enabled = true,
  poll = false,
) {
  return useQuery({
    queryKey: workflowKeys.harnessEvents(runId),
    queryFn: () =>
      runId === null
        ? Promise.reject(new Error("Missing workflow run ID"))
        : greenroomApi.listWorkflowRunHarnessEvents(runId),
    enabled: enabled && runId !== null,
    refetchInterval: poll ? 1_500 : false,
  });
}

export function useApproveWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: WorkflowRunId) => greenroomApi.approveWorkflowRun(runId),
    onSuccess: async (run) => {
      await invalidateWorkflowRun(queryClient, run.reviewDisplayId, run.id);
    },
  });
}

export function useCancelWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      runId,
      input = {},
    }: {
      runId: WorkflowRunId;
      input?: CancelWorkflowRunRequest;
    }) => greenroomApi.cancelWorkflowRun(runId, input),
    onSuccess: async (run) => {
      await invalidateWorkflowRun(queryClient, run.reviewDisplayId, run.id);
    },
  });
}

export function useRetryWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: WorkflowRunId) => greenroomApi.retryWorkflowRun(runId),
    onSuccess: async (run, previousRunId) => {
      await Promise.all([
        invalidateWorkflowRun(queryClient, run.reviewDisplayId, run.id),
        queryClient.invalidateQueries({ queryKey: workflowKeys.run(previousRunId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.events(previousRunId) }),
      ]);
    },
  });
}

export function useRecoverWorkflowRunFingerprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: WorkflowRunId) => greenroomApi.recoverWorkflowRunFingerprint(runId),
    onSuccess: async (recovery, previousRunId) => {
      await Promise.all([
        // Recovery refreshed the review to a new revision snapshot.
        invalidateRefreshedReview(queryClient, recovery.review),
        invalidateWorkflowRun(queryClient, recovery.run.reviewDisplayId, recovery.run.id),
        queryClient.invalidateQueries({ queryKey: workflowKeys.run(previousRunId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.events(previousRunId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.diagnostics(previousRunId) }),
      ]);
    },
  });
}

export function usePurgeWorkflowTranscripts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => greenroomApi.purgeWorkflowTranscripts(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

export function useSpotlightViews(reviewId: ReviewReference | null, enabled = true) {
  return useQuery({
    queryKey: spotlightKeys.views(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.listSpotlightViews(reviewId),
    enabled: enabled && reviewId !== null,
  });
}

export function useSpotlightViewDiff(
  reviewId: ReviewReference | null,
  viewRef: SpotlightViewReference | null,
  enabled = true,
) {
  return useQuery({
    queryKey: spotlightKeys.viewDiff(reviewId, viewRef),
    queryFn: () =>
      reviewId === null || viewRef === null
        ? Promise.reject(new Error("Missing Spotlight view"))
        : greenroomApi.readSpotlightViewDiff(viewRef),
    enabled: enabled && reviewId !== null && viewRef !== null,
  });
}

export function useSpotlightCoverage(reviewId: ReviewReference | null, enabled = true) {
  return useQuery({
    queryKey: spotlightKeys.coverage(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.readSpotlightCoverage(reviewId),
    enabled: enabled && reviewId !== null,
  });
}

export function useSpotlightLineMembership(reviewId: ReviewReference | null, enabled = true) {
  return useQuery({
    queryKey: spotlightKeys.lineMembership(reviewId),
    queryFn: () =>
      reviewId === null
        ? Promise.reject(new Error("Missing review ID"))
        : greenroomApi.readSpotlightLineMembership(reviewId),
    enabled: enabled && reviewId !== null,
  });
}

export function useSpotlightRun(
  reviewId: ReviewReference | null,
  runId: SpotlightRunId | null,
  enabled = true,
) {
  return useQuery({
    queryKey: spotlightKeys.run(reviewId, runId),
    queryFn: () =>
      reviewId === null || runId === null
        ? Promise.reject(new Error("Missing Spotlight run"))
        : greenroomApi.readSpotlightRun(reviewId, runId),
    enabled: enabled && reviewId !== null && runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && status !== "completed" && status !== "failed" ? 1_500 : false;
    },
  });
}

export function useCreateSpotlightRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      reviewId,
      input,
    }: {
      reviewId: ReviewReference;
      input: CreateSpotlightRunRequest;
    }) => greenroomApi.createSpotlightRun(reviewId, input),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowKeys.active }),
        queryClient.invalidateQueries({ queryKey: spotlightKeys.all(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.detail(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.review(run.reviewDisplayId) }),
      ]);
    },
  });
}

export function useApproveSpotlightRunContext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ reviewId, runId }: { reviewId: ReviewReference; runId: SpotlightRunId }) =>
      greenroomApi.approveSpotlightRunContext(reviewId, runId),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowKeys.active }),
        queryClient.invalidateQueries({ queryKey: spotlightKeys.all(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: spotlightKeys.run(run.reviewDisplayId, run.id) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.review(run.reviewDisplayId) }),
      ]);
    },
  });
}

export function useRefineSpotlightRunPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      reviewId,
      runId,
      input,
    }: {
      reviewId: ReviewReference;
      runId: SpotlightRunId;
      input: RefineSpotlightRunRequest;
    }) => greenroomApi.refineSpotlightRunPlan(reviewId, runId, input),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: spotlightKeys.all(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: spotlightKeys.run(run.reviewDisplayId, run.id) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.review(run.reviewDisplayId) }),
      ]);
    },
  });
}

export function useApproveSpotlightRunPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      reviewId,
      runId,
      input,
    }: {
      reviewId: ReviewReference;
      runId: SpotlightRunId;
      input: ApproveSpotlightPlanRequest;
    }) => greenroomApi.approveSpotlightRunPlan(reviewId, runId, input),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowKeys.active }),
        queryClient.invalidateQueries({ queryKey: spotlightKeys.all(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: spotlightKeys.run(run.reviewDisplayId, run.id) }),
        queryClient.invalidateQueries({ queryKey: spotlightKeys.views(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.review(run.reviewDisplayId) }),
      ]);
    },
  });
}

export function useCreateBuiltinReviewConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      reviewId,
      input,
    }: {
      reviewId: ReviewReference;
      input: BuiltinReviewConsentCreateInput;
    }) => greenroomApi.createBuiltinReviewConsent(reviewId, input),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowKeys.active }),
        queryClient.invalidateQueries({ queryKey: builtinReviewKeys.run(run.id) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.review(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.run(run.id as WorkflowRunId) }),
        queryClient.invalidateQueries({
          queryKey: workflowKeys.events(run.id as WorkflowRunId),
        }),
      ]);
    },
  });
}

export function useBuiltinReviewRun(runId: BuiltinReviewRunId | null, enabled = true) {
  return useQuery({
    queryKey: builtinReviewKeys.run(runId),
    queryFn: () =>
      runId === null
        ? Promise.reject(new Error("Missing built-in review run ID"))
        : greenroomApi.readBuiltinReviewRun(runId),
    enabled: enabled && runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isActiveBuiltinReviewRunStatus(status) ? 1_500 : false;
    },
  });
}

export function useApproveBuiltinReviewRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: BuiltinReviewRunId) => greenroomApi.approveBuiltinReviewRun(runId),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: builtinReviewKeys.run(run.id) }),
        invalidateWorkflowRun(queryClient, run.reviewDisplayId, run.id as WorkflowRunId),
        queryClient.invalidateQueries({ queryKey: reviewKeys.threads(run.reviewDisplayId) }),
      ]);
    },
  });
}

export function useApproveBuiltinReviewDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: BuiltinReviewRunId) => greenroomApi.approveBuiltinReviewDraft(runId),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: builtinReviewKeys.run(run.id) }),
        invalidateWorkflowRun(queryClient, run.reviewDisplayId, run.id as WorkflowRunId),
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.threads(run.reviewDisplayId) }),
      ]);
    },
  });
}

export function useCreateThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ reviewId, input }: { reviewId: ReviewReference; input: ThreadCreateInput }) =>
      greenroomApi.createThread(reviewId, input),
    onSuccess: async (_thread, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.threads(variables.reviewId) }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.detail(variables.reviewId) }),
      ]);
    },
  });
}

export function useReplyToThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      threadRef,
      input,
    }: {
      reviewId: ReviewReference;
      threadRef: ThreadReference;
      input: ReplyThreadRequest;
    }) => greenroomApi.replyToThread(threadRef, input),
    onSuccess: async (_comment, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.threads(variables.reviewId) }),
      ]);
    },
  });
}

export function useTransitionThreadStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      threadRef,
      status,
    }: {
      reviewId: ReviewReference;
      threadRef: ThreadReference;
      status: ThreadStatus;
    }) => greenroomApi.transitionThreadStatus(threadRef, status),
    onSuccess: async (_thread, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.threads(variables.reviewId) }),
      ]);
    },
  });
}

export function useCreateTeachingConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      reviewId,
      input,
    }: {
      reviewId: ReviewReference;
      input: TeachingConsentCreateInput;
    }) => greenroomApi.createTeachingConsent(reviewId, input),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowKeys.active }),
        queryClient.invalidateQueries({ queryKey: teachingKeys.run(run.id) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.review(run.reviewDisplayId) }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.run(run.id as WorkflowRunId) }),
        queryClient.invalidateQueries({
          queryKey: workflowKeys.events(run.id as WorkflowRunId),
        }),
      ]);
    },
  });
}

export function useTeachingRun(runId: TeachingRunId | null) {
  return useQuery({
    queryKey: teachingKeys.run(runId),
    queryFn: () =>
      runId === null
        ? Promise.reject(new Error("Missing teaching run ID"))
        : greenroomApi.readTeachingRun(runId),
    enabled: runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "approved" ? 1_500 : false;
    },
  });
}

export function useApproveTeachingRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: TeachingRunId) => greenroomApi.approveTeachingRun(runId),
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: teachingKeys.run(run.id) }),
        invalidateWorkflowRun(queryClient, run.reviewDisplayId, run.id as WorkflowRunId),
      ]);
    },
  });
}

export function useTeachingFollowUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ runId, input }: { runId: TeachingRunId; input: TeachingFollowUpRequest }) =>
      greenroomApi.answerTeachingFollowUp(runId, input),
    onSuccess: async (_followUp, variables) => {
      await queryClient.invalidateQueries({
        queryKey: workflowKeys.events(variables.runId as WorkflowRunId),
      });
    },
  });
}

export function usePromoteTeachingPoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      reviewId,
      input,
    }: {
      reviewId: ReviewReference;
      input: TeachingPromotionInput;
    }) => greenroomApi.promoteTeachingPoint(reviewId, input),
    onSuccess: async (_thread, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.threads(variables.reviewId) }),
      ]);
    },
  });
}

function isActiveWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return status === "queued" || status === "running" || status === "repairing";
}

function isActiveBuiltinReviewRunStatus(status: BuiltinReviewRunStatus): boolean {
  return status === "approved";
}

async function invalidateWorkflowRun(
  queryClient: ReturnType<typeof useQueryClient>,
  reviewId: ReviewReference,
  runId: WorkflowRunId,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: workflowKeys.active }),
    queryClient.invalidateQueries({ queryKey: workflowKeys.review(reviewId) }),
    queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) }),
    queryClient.invalidateQueries({ queryKey: workflowKeys.events(runId) }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.detail(reviewId) }),
  ]);
}
