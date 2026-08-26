import { basename } from "node:path";
import { randomUUID } from "node:crypto";

import {
  capabilityTokenCreateInputSchema,
  capabilityTokenSchema,
  commentCreateInputSchema,
  commentSchema,
  agentEventCreateInputSchema,
  agentEventSchema,
  profileCreateInputSchema,
  profileSchema,
  repositoryCreateInputSchema,
  repositorySchema,
  revisionCreateInputSchema,
  revisionSnapshotSchema,
  reviewPrCreateInputSchema,
  reviewPrSchema,
  reviewDisplayIdSchema,
  spotlightRunCreateInputSchema,
  spotlightRunSchema,
  spotlightViewCreateInputSchema,
  spotlightViewRegionCreateInputSchema,
  spotlightViewRegionSchema,
  spotlightViewSchema,
  threadCreateInputSchema,
  threadSchema,
  type AgentEvent,
  type AgentEventCreateInput,
  type CapabilityToken,
  type CapabilityTokenCreateInput,
  type Comment,
  type CommentCreateInput,
  type Profile,
  type ProfileCreateInput,
  type Repository,
  type RepositoryCreateInput,
  type RevisionCreateInput,
  type RevisionSnapshot,
  type ReviewPr,
  type ReviewPrCreateInput,
  type ReviewPrId,
  type ReviewDisplayId,
  type SpotlightRun,
  type SpotlightRunCreateInput,
  type SpotlightView,
  type SpotlightViewCreateInput,
  type SpotlightViewId,
  type SpotlightViewRegion,
  type SpotlightViewRegionCreateInput,
  type Thread,
  type ThreadAnchor,
  type ThreadCreateInput,
  type ThreadId,
  type ThreadStatus,
} from "@greenroom/schemas";

export type IdPrefix =
  | "repo"
  | "review"
  | "revision"
  | "thread"
  | "comment"
  | "profile"
  | "token"
  | "event"
  | "spotlight_view"
  | "spotlight_region"
  | "spotlight_run";

export type Clock = () => string;

export type IdFactory = (prefix: IdPrefix) => string;

export interface DomainFactoryOptions {
  clock?: Clock;
  idFactory?: IdFactory;
}

export interface ThreadFactoryOptions extends DomainFactoryOptions {
  nextThreadNumber: number;
}

export interface SpotlightViewFactoryOptions extends DomainFactoryOptions {
  nextViewNumber: number;
}

/**
 * Storage-layer shapes: the API entity plus the opaque primary key. Opaque
 * ids are internal currency only — they never leave the server, so the API
 * entity schemas do not carry them.
 */
export type StoredReviewPr = ReviewPr & { id: ReviewPrId };
export type StoredThread = Thread & { id: ThreadId };
export type StoredSpotlightView = SpotlightView & { id: SpotlightViewId };

export interface CreatedThread {
  thread: StoredThread;
  firstComment: Comment;
}

export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}

export const nowTimestamp: Clock = () => new Date().toISOString();

export const createOpaqueId: IdFactory = (prefix) => `${prefix}_${randomUUID()}`;

function optionsWithDefaults(options: DomainFactoryOptions = {}): Required<DomainFactoryOptions> {
  return {
    clock: options.clock ?? nowTimestamp,
    idFactory: options.idFactory ?? createOpaqueId,
  };
}

function normalizeThreadAnchors(
  primaryAnchor: ThreadAnchor,
  inputAnchors: readonly ThreadAnchor[] | undefined,
): ThreadAnchor[] {
  const anchors: ThreadAnchor[] = [];

  for (const anchor of inputAnchors ?? [primaryAnchor]) {
    if (
      !anchors.some(
        (candidate) => threadAnchorLocationKey(candidate) === threadAnchorLocationKey(anchor),
      )
    ) {
      anchors.push(anchor);
    }
  }

  if (
    !anchors.some(
      (anchor) => threadAnchorLocationKey(anchor) === threadAnchorLocationKey(primaryAnchor),
    )
  ) {
    anchors.push(primaryAnchor);
  }

  return anchors;
}

/**
 * Stable per-line key addressing a diff line of a thread anchor:
 * `reviewDisplayId:revisionId:filePath:oldFilePath:side:lineType:lineNumber`
 * (e.g. `GR-1:revision_...:src/index.ts::head:addition:5`).
 *
 * Agents receive these keys in prompts and must echo them back verbatim;
 * they are persisted in workflow draft/final outputs and approved Spotlight
 * outlines. Every producer and consumer of anchor keys must go through this
 * helper so the format can never partially change.
 */
export function threadAnchorLineKey(anchor: ThreadAnchor): string {
  return [
    anchor.reviewDisplayId,
    anchor.revisionId,
    anchor.filePath,
    anchor.oldFilePath ?? "",
    anchor.side,
    anchor.lineType,
    anchor.lineNumber,
  ].join(":");
}

function threadAnchorLocationKey(anchor: ThreadAnchor): string {
  return [threadAnchorLineKey(anchor), anchor.hunkId ?? ""].join(":");
}

function anchorsTargetSameFileRevision(left: ThreadAnchor, right: ThreadAnchor): boolean {
  return (
    left.reviewDisplayId === right.reviewDisplayId &&
    left.revisionId === right.revisionId &&
    left.filePath === right.filePath &&
    left.oldFilePath === right.oldFilePath
  );
}

export function createRepository(
  input: RepositoryCreateInput,
  options: DomainFactoryOptions = {},
): Repository {
  const parsed = repositoryCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);
  const timestamp = clock();
  const gitCommonDir = parsed.gitCommonDir ?? `${parsed.rootPath}/.git`;

  return repositorySchema.parse({
    id: idFactory("repo"),
    rootPath: parsed.rootPath,
    gitCommonDir,
    identityKey: parsed.identityKey ?? gitCommonDir,
    displayName: parsed.displayName ?? basename(parsed.rootPath),
    defaultBranchCandidate: parsed.defaultBranchCandidate ?? null,
    spotlightConfig: parsed.spotlightConfig ?? {},
    lastOpenedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createReviewPr(
  input: ReviewPrCreateInput & { displayId: ReviewDisplayId },
  options: DomainFactoryOptions = {},
): StoredReviewPr {
  const parsed = {
    ...reviewPrCreateInputSchema.parse(input),
    displayId: reviewDisplayIdSchema.parse(input.displayId),
  };
  const { clock, idFactory } = optionsWithDefaults(options);
  const timestamp = clock();

  const entity = reviewPrSchema.parse({
    displayId: parsed.displayId,
    repositoryId: parsed.repositoryId,
    title: parsed.title,
    range: parsed.range,
    baseRefDisplay: parsed.baseRefDisplay,
    headRefDisplay: parsed.headRefDisplay,
    currentRevisionId: null,
    status: "open",
    spotlightConfig: parsed.spotlightConfig ?? {},
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { ...entity, id: idFactory("review") };
}

export function createRevisionSnapshot(
  input: RevisionCreateInput,
  options: DomainFactoryOptions = {},
): RevisionSnapshot {
  const parsed = revisionCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);

  return revisionSnapshotSchema.parse({
    id: idFactory("revision"),
    reviewDisplayId: parsed.reviewDisplayId,
    baseSha: parsed.baseSha,
    headSha: parsed.headSha,
    worktreeFingerprint: parsed.worktreeFingerprint ?? null,
    diffSummary: parsed.diffSummary,
    refreshReason: parsed.refreshReason,
    createdAt: clock(),
  });
}

export function createComment(
  input: CommentCreateInput,
  options: DomainFactoryOptions & { sortOrder?: number } = {},
): Comment {
  const parsed = commentCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);

  return commentSchema.parse({
    id: idFactory("comment"),
    threadRef: parsed.threadRef,
    parentCommentId: parsed.parentCommentId ?? null,
    authorKind: parsed.authorKind,
    authorDisplayName: parsed.authorDisplayName,
    body: parsed.body,
    sortOrder: options.sortOrder ?? 1,
    createdAt: clock(),
    editedAt: null,
  });
}

export function createThread(
  input: ThreadCreateInput,
  options: ThreadFactoryOptions,
): CreatedThread {
  const parsed = threadCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);
  const anchors = normalizeThreadAnchors(parsed.anchor, parsed.anchors);

  if (anchors.some((anchor) => anchor.reviewDisplayId !== parsed.reviewDisplayId)) {
    throw new DomainInvariantError("Thread anchors must belong to the same review as the thread");
  }

  if (anchors.some((anchor) => !anchorsTargetSameFileRevision(parsed.anchor, anchor))) {
    throw new DomainInvariantError("Thread anchors must target one file in one revision");
  }

  if (options.nextThreadNumber < 1 || !Number.isInteger(options.nextThreadNumber)) {
    throw new DomainInvariantError("Thread refs require a positive integer counter");
  }

  const timestamp = clock();
  const entity = threadSchema.parse({
    reviewDisplayId: parsed.reviewDisplayId,
    shortRef: `GT-${options.nextThreadNumber}`,
    status: "open",
    type: parsed.type,
    severity: parsed.severity ?? null,
    source: parsed.source,
    anchor: parsed.anchor,
    anchors,
    remapConfidence: null,
    outdated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const thread: StoredThread = { ...entity, id: idFactory("thread") };

  const firstComment = createComment(
    {
      ...parsed.firstComment,
      threadRef: thread.shortRef,
      parentCommentId: null,
    },
    { clock: () => timestamp, idFactory, sortOrder: 1 },
  );

  return { thread, firstComment };
}

export function transitionThreadStatus(
  thread: Thread,
  status: ThreadStatus,
  options: DomainFactoryOptions = {},
): Thread {
  const { clock } = optionsWithDefaults(options);

  if (thread.status === status) {
    return thread;
  }

  return threadSchema.parse({
    ...thread,
    status,
    updatedAt: clock(),
  });
}

export function createProfile(
  input: ProfileCreateInput,
  options: DomainFactoryOptions = {},
): Profile {
  const parsed = profileCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);
  const timestamp = clock();

  return profileSchema.parse({
    id: idFactory("profile"),
    name: parsed.name,
    workflowType: parsed.workflowType,
    provider: parsed.provider,
    model: parsed.model,
    description: parsed.description ?? null,
    systemPrompt: parsed.systemPrompt ?? null,
    modelSettings: parsed.modelSettings,
    allowedTools: parsed.allowedTools,
    contextPreferences: parsed.contextPreferences,
    privacy: parsed.privacy,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createSpotlightView(
  input: SpotlightViewCreateInput,
  options: SpotlightViewFactoryOptions,
): StoredSpotlightView {
  const parsed = spotlightViewCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);

  if (options.nextViewNumber < 1 || !Number.isInteger(options.nextViewNumber)) {
    throw new DomainInvariantError("Spotlight view refs require a positive integer counter");
  }

  const timestamp = clock();

  const entity = spotlightViewSchema.parse({
    reviewDisplayId: parsed.reviewDisplayId,
    displayRef: `SV-${options.nextViewNumber}`,
    title: parsed.title,
    description: parsed.description,
    intent: parsed.intent,
    orderIndex: parsed.orderIndex,
    health: parsed.health,
    originRunId: parsed.originRunId,
    lastReconciledRevisionId: parsed.lastReconciledRevisionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { ...entity, id: idFactory("spotlight_view") };
}

export function createSpotlightViewRegion(
  input: SpotlightViewRegionCreateInput,
  options: DomainFactoryOptions = {},
): SpotlightViewRegion {
  const parsed = spotlightViewRegionCreateInputSchema.parse(input);
  const { idFactory } = optionsWithDefaults(options);

  return spotlightViewRegionSchema.parse({
    id: idFactory("spotlight_region"),
    viewRef: parsed.viewRef,
    filePath: parsed.filePath,
    oldPath: parsed.oldPath,
    anchors: parsed.anchors,
    remapConfidence: parsed.remapConfidence,
    stale: parsed.stale,
  });
}

export function createSpotlightRun(
  input: SpotlightRunCreateInput,
  options: DomainFactoryOptions = {},
): SpotlightRun {
  const parsed = spotlightRunCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);
  const timestamp = clock();

  return spotlightRunSchema.parse({
    id: idFactory("spotlight_run"),
    reviewDisplayId: parsed.reviewDisplayId,
    type: parsed.type,
    trigger: parsed.trigger,
    gated: parsed.gated,
    status: parsed.status,
    revisionId: parsed.revisionId,
    profileId: parsed.profileId,
    approvedOutline: parsed.approvedOutline,
    errorMessage: parsed.errorMessage,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  });
}

export function createCapabilityToken(
  input: CapabilityTokenCreateInput & { tokenHash: string },
  options: DomainFactoryOptions = {},
): CapabilityToken {
  const parsed = capabilityTokenCreateInputSchema.parse({
    name: input.name,
    scopes: input.scopes,
  });
  const { clock, idFactory } = optionsWithDefaults(options);
  const timestamp = clock();

  return capabilityTokenSchema.parse({
    id: idFactory("token"),
    name: parsed.name,
    tokenHash: input.tokenHash,
    scopes: parsed.scopes,
    createdAt: timestamp,
    lastUsedAt: null,
    revokedAt: null,
  });
}

export function createAgentEvent(
  input: AgentEventCreateInput,
  options: DomainFactoryOptions = {},
): AgentEvent {
  const parsed = agentEventCreateInputSchema.parse(input);
  const { clock, idFactory } = optionsWithDefaults(options);

  return agentEventSchema.parse({
    id: idFactory("event"),
    reviewDisplayId: parsed.reviewDisplayId ?? null,
    eventType: parsed.eventType,
    source: parsed.source,
    threadRefs: parsed.threadRefs,
    summary: parsed.summary,
    metadata: parsed.metadata,
    createdAt: clock(),
  });
}
