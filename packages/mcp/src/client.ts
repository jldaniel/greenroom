import type {
  AgentEvent,
  AgentEventCreateInput,
  Comment,
  CommentCreateInput,
  DiffFile,
  HandoffBundle,
  HandoffRequest,
  Repository,
  ReviewPr,
  ReviewDisplayId,
  ReviewReference,
  ReviewStateFilter,
  RevisionId,
  RevisionSnapshot,
  SpotlightView,
  SpotlightViewReference,
  SpotlightViewRegion,
  ThreadCreateInput,
  ThreadAnchor,
  ThreadReference,
  ThreadWithComments,
  WorkflowDraftOutput,
  WorkflowRepairPromptMetadata,
  WorkflowRun,
  WorkflowRunId,
  WorkflowValidationIssue,
} from "@greenroom/schemas";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GreenroomHttpClientOptions {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
}

export interface GreenroomApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class GreenroomHttpError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(errorMessage(status, payload));
    this.name = "GreenroomHttpError";
    this.status = status;
    this.payload = payload;
  }
}

export interface ReviewResource {
  review: ReviewPr;
  repository: Repository;
  currentRevision: RevisionSnapshot | null;
}

export interface ReviewDiffResource {
  review: ReviewPr;
  revision: RevisionSnapshot;
  files: DiffFile[];
}

export interface SpotlightViewResource extends SpotlightView {
  associatedFiles: Array<{
    path: string;
    oldPath: string | null;
  }>;
}

export interface SpotlightViewWithRegionsResource extends SpotlightViewResource {
  regions: SpotlightViewRegion[];
}

export interface SpotlightViewDiffResource {
  view: SpotlightViewResource;
  revision: RevisionSnapshot;
  files: DiffFile[];
  regions: SpotlightViewRegion[];
}

export interface SpotlightLineMembershipResource {
  reviewDisplayId: ReviewDisplayId;
  revisionId: RevisionId;
  memberships: Array<{
    anchor: ThreadAnchor;
    views: SpotlightViewResource[];
  }>;
}

export interface SpotlightCoverageResource {
  reviewDisplayId: ReviewDisplayId;
  revisionId: RevisionId;
  unlitAnchors: ThreadAnchor[];
}

export type ThreadReplyInput = Omit<CommentCreateInput, "threadRef">;

export interface WorkflowDraftSubmissionResource {
  run: WorkflowRun;
  valid: boolean;
  issues: WorkflowValidationIssue[];
  repairContext: WorkflowRepairPromptMetadata | null;
}

export interface WorkflowProgressReportResource {
  event: unknown;
}

export class GreenroomHttpClient {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GreenroomHttpClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  listReviews(state: ReviewStateFilter = "open"): Promise<{ reviews: ReviewResource[] }> {
    return this.request("/api/reviews", { search: { state } });
  }

  getReview(reviewId: ReviewReference): Promise<ReviewResource> {
    return this.request(`/api/reviews/${encodeURIComponent(reviewId)}`);
  }

  getDiff(reviewId: ReviewReference, revisionId?: RevisionId): Promise<ReviewDiffResource> {
    if (revisionId !== undefined) {
      return this.request(
        `/api/reviews/${encodeURIComponent(reviewId)}/revisions/${encodeURIComponent(revisionId)}`,
      );
    }

    return this.request(`/api/reviews/${encodeURIComponent(reviewId)}/diff`);
  }

  getDiffFile(
    reviewId: ReviewReference,
    path: string,
    revisionId?: RevisionId,
  ): Promise<ReviewDiffResource> {
    if (revisionId !== undefined) {
      return this.request(
        `/api/reviews/${encodeURIComponent(reviewId)}/revisions/${encodeURIComponent(revisionId)}`,
        { search: { path } },
      );
    }

    return this.request(`/api/reviews/${encodeURIComponent(reviewId)}/diff`, {
      search: { path },
    });
  }

  listSpotlightViews(reviewId: ReviewReference): Promise<{ views: SpotlightViewResource[] }> {
    return this.request(`/api/reviews/${encodeURIComponent(reviewId)}/spotlight/views`);
  }

  getSpotlightView(
    viewRef: SpotlightViewReference,
  ): Promise<{ view: SpotlightViewWithRegionsResource }> {
    return this.request(`/api/spotlight/views/${encodeURIComponent(viewRef)}`);
  }

  getSpotlightViewDiff(viewRef: SpotlightViewReference): Promise<SpotlightViewDiffResource> {
    return this.request(`/api/spotlight/views/${encodeURIComponent(viewRef)}/diff`);
  }

  getSpotlightLineMembership(reviewId: ReviewReference): Promise<SpotlightLineMembershipResource> {
    return this.request(`/api/reviews/${encodeURIComponent(reviewId)}/spotlight/line-membership`);
  }

  getSpotlightCoverage(reviewId: ReviewReference): Promise<SpotlightCoverageResource> {
    return this.request(`/api/reviews/${encodeURIComponent(reviewId)}/spotlight/coverage`);
  }

  listThreads(reviewId: ReviewReference): Promise<{ threads: ThreadWithComments[] }> {
    return this.request(`/api/reviews/${encodeURIComponent(reviewId)}/threads`);
  }

  getThread(threadRef: ThreadReference): Promise<{ thread: ThreadWithComments }> {
    return this.request(`/api/threads/${encodeURIComponent(threadRef)}`);
  }

  createThread(input: ThreadCreateInput): Promise<{ thread: ThreadWithComments }> {
    return this.request(`/api/reviews/${encodeURIComponent(input.reviewDisplayId)}/threads`, {
      method: "POST",
      body: input,
    });
  }

  replyToThread(
    threadRef: ThreadReference,
    input: ThreadReplyInput,
  ): Promise<{ comment: Comment }> {
    return this.request(`/api/threads/${encodeURIComponent(threadRef)}/comments`, {
      method: "POST",
      body: input,
    });
  }

  resolveThread(threadRef: ThreadReference): Promise<{ thread: ThreadWithComments }> {
    return this.transitionThread(threadRef, "resolve");
  }

  dismissThread(threadRef: ThreadReference): Promise<{ thread: ThreadWithComments }> {
    return this.transitionThread(threadRef, "dismiss");
  }

  createHandoff(input: HandoffRequest): Promise<{ handoff: HandoffBundle }> {
    return this.request(`/api/reviews/${encodeURIComponent(input.reviewDisplayId)}/handoff`, {
      method: "POST",
      body: input,
    });
  }

  reportAgentEvent(input: AgentEventCreateInput): Promise<{ event: AgentEvent }> {
    return this.request("/api/agent-events", {
      method: "POST",
      body: input,
    });
  }

  submitWorkflowDraft(
    runId: WorkflowRunId,
    draft: WorkflowDraftOutput,
  ): Promise<WorkflowDraftSubmissionResource> {
    return this.request(`/api/workflow-runs/${encodeURIComponent(runId)}/draft`, {
      method: "POST",
      body: { draft },
    });
  }

  reportWorkflowProgress(input: {
    runId: WorkflowRunId;
    message: string;
    completedUnits?: number;
    totalUnits?: number;
    phase?: string;
  }): Promise<WorkflowProgressReportResource> {
    return this.request(`/api/workflow-runs/${encodeURIComponent(input.runId)}/progress`, {
      method: "POST",
      body: {
        message: input.message,
        ...(input.completedUnits === undefined ? {} : { completedUnits: input.completedUnits }),
        ...(input.totalUnits === undefined ? {} : { totalUnits: input.totalUnits }),
        ...(input.phase === undefined ? {} : { phase: input.phase }),
      },
    });
  }

  private transitionThread(
    threadRef: ThreadReference,
    transition: "dismiss" | "resolve",
  ): Promise<{ thread: ThreadWithComments }> {
    return this.request(`/api/threads/${encodeURIComponent(threadRef)}/${transition}`, {
      method: "POST",
    });
  }

  private async request<T>(
    path: string,
    options: { method?: "GET" | "POST"; body?: unknown; search?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    for (const [key, value] of Object.entries(options.search ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers = new Headers();
    headers.set("authorization", `Bearer ${this.token}`);

    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    const response = await this.fetchImpl(url.toString(), {
      method: options.method ?? "GET",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new GreenroomHttpError(response.status, payload);
    }

    return payload as T;
  }
}

export function createGreenroomHttpClient(
  options: GreenroomHttpClientOptions,
): GreenroomHttpClient {
  return new GreenroomHttpClient(options);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

function errorMessage(status: number, payload: unknown): string {
  const apiPayload = payload as GreenroomApiErrorPayload;
  const message = apiPayload.error?.message;

  return message === undefined ? `Greenroom API request failed with status ${status}` : message;
}
