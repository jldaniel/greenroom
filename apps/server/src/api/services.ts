import { nowTimestamp, type DomainFactoryOptions, type StoredReviewPr } from "@greenroom/core";
import {
  constructDefaultWorktreeReviewRange,
  constructReviewRange,
  constructWholeRepositoryReviewRange,
  detectRepository,
  generateStructuredCommittedDiff,
  generateStructuredEmptyTreeDiff,
  generateStructuredWorktreeDiff,
  getWorktreeFingerprint,
  summarizeDiffFiles,
  type StructuredDiffFile,
} from "@greenroom/git";
import {
  repositoryCreateInputSchema,
  agentEventCreateInputSchema,
  handoffBundleSchema,
  getHarnessKindDescriptor,
  harnessIdleTimeoutMsFromProfile,
  harnessKindFromProfile,
  type DiffHunk,
  type HarnessDetectedCli,
  type DiffSummary,
  type DiffFile,
  type DiffLine,
  type AgentEvent,
  type AgentEventCreateInput,
  type HandoffBundle,
  type HandoffRequest,
  type Repository,
  type RepositoryCreateInput,
  type RepositoryId,
  type ReviewRange,
  type ReviewPr,
  type ReviewDisplayId,
  type ReviewPrId,
  type ReviewReference,
  type ReviewRangeKind,
  type RevisionId,
  type RevisionSnapshot,
  type Profile,
  type ProfileId,
  type SpotlightRunId,
  type ThreadAnchor,
  type ThreadWithComments,
  type WorkflowExpectedOutputMode,
  type WorkflowChangedFileSummary,
  type WorkflowKind,
  type WorkflowMcpCapability,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
  type WorkflowConsentSummary,
  type WorktreeFingerprint,
} from "@greenroom/schemas";

import type { GreenroomDatabase, GreenroomDrizzleDatabase } from "../storage/database";
import {
  createRepositoryPersistenceService,
  type RepositoryPersistenceService,
} from "../storage/repositories";
import {
  createProfilePersistenceService,
  defaultHarnessProfileInputs,
  defaultMockProfileInputs,
  mockFallbackProfileDescription,
  mockFallbackSeedMarker,
  type ProfileDefaultAiBackend,
  type ProfilePersistenceService,
} from "../storage/profiles";
import {
  createAgentEventPersistenceService,
  type AgentEventPersistenceService,
} from "../storage/agent-events";
import {
  createReviewPersistenceService,
  type ReviewPersistenceService,
  type ReviewWithRevision,
} from "../storage/reviews";
import {
  createSpotlightPersistenceService,
  type CreateSpotlightRegionForViewInput,
  type SpotlightPersistenceService,
} from "../storage/spotlight";
import { createThreadPersistenceService, type ThreadPersistenceService } from "../storage/threads";
import { createTokenPersistenceService, type TokenPersistenceService } from "../storage/tokens";
import {
  createWorkflowPersistenceService,
  type WorkflowPersistenceService,
} from "../storage/workflows";
import {
  createWorkflowTranscriptPersistenceService,
  type WorkflowTranscriptPersistenceService,
} from "../storage/transcripts";
import {
  createBuiltinReviewWorkflowDefinition,
  createSetupSmokeWorkflowDefinition,
  createSpotlightWorkflowDefinitions,
  createTeachingWorkflowDefinitions,
  createWorkflowOrchestrator,
  stripOrchestratorReservedWorkflowMetadata,
  type WorkflowDefinition,
  type WorkflowRunner,
} from "../workflows";
import {
  readWorkflowRuntimeConfigFromEnv,
  workflowTracingStatusForProfile,
  type GreenroomWorkflowRuntimeConfig,
} from "../config";
import { lineNumberForAnchorSide, remapAnchorSet } from "./anchor-remap";
import { ApiHttpError } from "./errors";
import {
  createGreenroomApiEvents,
  INTERNAL_REVIEW_CREATED_ACTOR,
  type GreenroomApiEvents,
  type ReviewCreatedActor,
} from "./events";
import { createHarnessClientFromEnv, type HarnessClient } from "./harness-client";
import {
  workflowRepositoryAccessMetadata,
  workflowRepositoryAccessSummaryForProfile,
} from "./repository-access";
import { createTranscriptRecordingHarnessClient } from "./transcript-recording-client";
import { createDefaultTeachingProviders, type TeachingProviderRegistry } from "./teaching";
import {
  createDefaultSpotlightProviders,
  type SpotlightPlanState,
  type SpotlightProviderRegistry,
} from "./spotlight";

export interface GreenroomApiServiceOptions {
  domain?: DomainFactoryOptions;
  /**
   * Environment used by env-driven defaults (harness client, workflow runtime
   * config, MCP endpoint, default AI backend). Callers that load the config
   * file pass the resolved environment from `loadGreenroomEnvironment` here so
   * file values apply with env-var precedence.
   */
  env?: Record<string, string | undefined>;
  gitTimeoutMs?: number;
  harnessClient?: HarnessClient | null;
  /**
   * Explicit fresh-DB seed override (`mock` or `harness:<kind>`); wins over
   * both `GREENROOM_DEFAULT_AI_BACKEND` and harness detection. When neither
   * this option nor the env var is set, fresh databases are seeded from
   * detection via `seedProfilesFromDetection`.
   */
  defaultAiBackend?: ProfileDefaultAiBackend;
  providers?: TeachingProviderRegistry;
  spotlightProviders?: SpotlightProviderRegistry;
  workflowDefinitions?: readonly WorkflowDefinition[];
  autoResumeQueuedWorkflowRuns?: boolean;
  mcpServerUrl?: string;
  mcpServerPath?: string;
  workflowRuntimeConfig?: GreenroomWorkflowRuntimeConfig;
}

export interface GreenroomApiServices {
  database: GreenroomDatabase;
  repositories: RepositoryPersistenceService;
  reviews: ReviewPersistenceService;
  threads: ThreadPersistenceService;
  tokens: TokenPersistenceService;
  profiles: ProfilePersistenceService;
  agentEvents: AgentEventPersistenceService;
  spotlight: SpotlightPersistenceService;
  workflows: WorkflowPersistenceService;
  transcripts: WorkflowTranscriptPersistenceService;
  workflowRunner: WorkflowRunner;
  workflowRuntimeConfig: GreenroomWorkflowRuntimeConfig;
  spotlightPlanStates: Map<SpotlightRunId, SpotlightPlanState>;
  harnessClient: HarnessClient | null;
  providers: TeachingProviderRegistry;
  spotlightProviders: SpotlightProviderRegistry;
  /**
   * Internal in-process event bus. No listeners are registered
   * by default; see `./events.ts` for the extension-point contract.
   */
  events: GreenroomApiEvents;
  clock: () => string;
  gitTimeoutMs: number | undefined;
  withReviewRefreshTransaction: <T>(
    operation: (services: ReviewRefreshPersistenceServices) => T,
  ) => T;
}

interface ReviewRefreshPersistenceServices {
  reviews: ReviewPersistenceService;
  threads: ThreadPersistenceService;
  spotlight: SpotlightPersistenceService;
}

export interface RegisterRepositoryRequest {
  rootPath: string;
  displayName?: string;
  defaultBranchCandidate?: string | null;
}

export interface CreateCommittedReviewRequest {
  repositoryId: RepositoryId;
  title?: string;
  baseRef?: string;
  headRef?: string;
  kind?: ReviewRangeKind;
  comparisonMode?: ReviewComparisonMode;
  /** Creator context carried on the emitted `review.created` event. */
  createdBy?: ReviewCreatedActor;
}

export type ReviewComparisonMode = "worktree" | "refs" | "whole_repository";

export interface CommittedReviewPreview {
  title: string;
  range: ReviewRange;
  baseSha: string;
  headSha: string;
  worktreeFingerprint: WorktreeFingerprint | null;
  baseRefDisplay: string;
  headRefDisplay: string;
  diffSummary: DiffSummary;
  files: StructuredDiffFile[];
}

export interface ReviewApiResource {
  review: ReviewPr;
  repository: Repository;
  currentRevision: RevisionSnapshot | null;
}

export interface ReviewDiffResource {
  review: ReviewPr;
  revision: RevisionSnapshot;
  files: DiffFile[];
}

export interface RefreshReviewResult extends ReviewWithRevision {
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

export interface CreateWorkflowRunForReviewRequest {
  reviewDisplayId: ReviewDisplayId;
  workflowKind: WorkflowKind;
  profileId: ProfileId;
  revisionId?: RevisionId | null;
  harnessKind?: string;
  scopeLabel?: string;
  allowedMcpCapabilities?: WorkflowMcpCapability[];
  expectedMcpResources?: string[];
  expectedOutputMode?: WorkflowExpectedOutputMode;
  threadCreationGate?: WorkflowConsentSummary["threadCreationGate"];
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
  /** Untrusted API metadata; orchestrator-owned keys are removed before persistence. */
  clientMetadata?: WorkflowRedactedMetadata;
  /** Trusted metadata produced by Greenroom's workflow-specific services. */
  metadata?: WorkflowRedactedMetadata;
}

export function createGreenroomApiServices(
  database: GreenroomDatabase,
  options: GreenroomApiServiceOptions = {},
): GreenroomApiServices {
  const env = options.env ?? process.env;
  const defaultAiBackend = options.defaultAiBackend ?? readDefaultAiBackendOverrideFromEnv(env);
  const profileService = createProfilePersistenceService(database.db, {
    ...options.domain,
    ...(defaultAiBackend === null ? {} : { defaultAiBackend }),
  });
  const tokenService = createTokenPersistenceService(database.db, options.domain);
  const agentEventService = createAgentEventPersistenceService(database.db, options.domain);
  const workflowPersistence = createWorkflowPersistenceService(database.db, {
    ...(options.domain?.clock === undefined ? {} : { clock: options.domain.clock }),
  });
  const transcriptService = createWorkflowTranscriptPersistenceService(database.db, {
    ...(options.domain?.clock === undefined ? {} : { clock: options.domain.clock }),
    env,
  });
  // Startup retention pass so caps also apply to transcripts written before a
  // configuration change.
  transcriptService.enforceRetention();
  const baseHarnessClient =
    options.harnessClient === undefined ? createHarnessClientFromEnv(env) : options.harnessClient;
  const harnessClient =
    baseHarnessClient === null
      ? null
      : createTranscriptRecordingHarnessClient(baseHarnessClient, {
          transcripts: transcriptService,
          workflows: workflowPersistence,
          profiles: profileService,
        });
  const workflowRuntimeConfig =
    options.workflowRuntimeConfig ?? readWorkflowRuntimeConfigFromEnv(env);
  profileService.ensureDefaults();
  let servicesRef: GreenroomApiServices | null = null;
  const getServices = () => {
    if (servicesRef === null) {
      throw new Error("Greenroom API services are not initialized");
    }

    return servicesRef;
  };
  const workflowRunner = createWorkflowOrchestrator({
    workflows: workflowPersistence,
    tokens: tokenService,
    agentEvents: agentEventService,
    definitions: [
      createSetupSmokeWorkflowDefinition(),
      createBuiltinReviewWorkflowDefinition({
        getServices,
        mcpServerUrl: options.mcpServerUrl ?? readMcpServerUrlFromEnv(env),
        mcpServerPath: options.mcpServerPath ?? readMcpServerPathFromEnv(env),
      }),
      ...createSpotlightWorkflowDefinitions({
        getServices,
        mcpServerUrl: options.mcpServerUrl ?? readMcpServerUrlFromEnv(env),
        mcpServerPath: options.mcpServerPath ?? readMcpServerPathFromEnv(env),
      }),
      ...createTeachingWorkflowDefinitions({
        getServices,
        mcpServerUrl: options.mcpServerUrl ?? readMcpServerUrlFromEnv(env),
        mcpServerPath: options.mcpServerPath ?? readMcpServerPathFromEnv(env),
      }),
      ...(options.workflowDefinitions ?? []),
    ],
    ...(options.domain?.clock === undefined ? {} : { clock: options.domain.clock }),
    ...(options.autoResumeQueuedWorkflowRuns === undefined
      ? {}
      : { autoResumeQueuedRuns: options.autoResumeQueuedWorkflowRuns }),
    runtimeConfig: workflowRuntimeConfig,
  });
  const services: GreenroomApiServices = {
    database,
    repositories: createRepositoryPersistenceService(database.db, options.domain),
    reviews: createReviewPersistenceService(database.db, options.domain),
    threads: createThreadPersistenceService(database.db, options.domain),
    tokens: tokenService,
    profiles: profileService,
    agentEvents: agentEventService,
    spotlight: createSpotlightPersistenceService(database.db, options.domain),
    workflows: workflowPersistence,
    transcripts: transcriptService,
    workflowRunner,
    workflowRuntimeConfig,
    spotlightPlanStates: new Map(),
    harnessClient,
    providers: {
      ...createDefaultTeachingProviders(),
      ...options.providers,
    },
    spotlightProviders: {
      ...createDefaultSpotlightProviders(),
      ...options.spotlightProviders,
    },
    events: createGreenroomApiEvents(),
    clock: options.domain?.clock ?? nowTimestamp,
    gitTimeoutMs: options.gitTimeoutMs,
    withReviewRefreshTransaction(operation) {
      return database.db.transaction((transaction) => {
        // Drizzle's transaction object implements the query and nested-transaction
        // surface used by these persistence services. Keeping the services bound
        // to it ensures every refresh write participates in this outer transaction.
        const transactionDatabase = transaction as unknown as GreenroomDrizzleDatabase;

        return operation({
          reviews: createReviewPersistenceService(transactionDatabase, options.domain),
          threads: createThreadPersistenceService(transactionDatabase, options.domain),
          spotlight: createSpotlightPersistenceService(transactionDatabase, options.domain),
        });
      });
    },
  };

  servicesRef = services;
  return services;
}

/**
 * `GREENROOM_DEFAULT_AI_BACKEND` is an explicit override rather than the
 * fresh-DB default: `mock` or `harness:<kind>` (for example
 * `harness:claude-code` or `harness:codex`). Unset, empty, or unknown values
 * are ignored and return null, which means fresh databases are seeded from
 * harness detection instead — see `seedProfilesFromDetection`.
 */
export function readDefaultAiBackendOverrideFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProfileDefaultAiBackend | null {
  const value = env.GREENROOM_DEFAULT_AI_BACKEND?.trim();

  if (value === undefined || value.length === 0) {
    return null;
  }

  if (value === "mock") {
    return value;
  }

  if (value.startsWith("harness:") && value.length > "harness:".length) {
    return value as ProfileDefaultAiBackend;
  }

  return null;
}

export const profileSeedDetectionTimeoutMsDefault = 3000;

export interface ProfileSeedOptions {
  /** Upper bound for the bridge detection request during seeding. */
  detectionTimeoutMs?: number;
}

export type ProfileSeedOutcome =
  /** Profiles already exist (beyond the mock detection fallback); no seeding. */
  | "profiles_exist"
  /** Harness CLIs were detected; harness-backed profiles were seeded. */
  | "harness_detected"
  /** No harness detected (or bridge unreachable); mock fallback profiles seeded. */
  | "mock_fallback";

export interface ProfileSeedResult {
  outcome: ProfileSeedOutcome;
  /** Harness kinds reported as installed by the bridge, in bridge order. */
  detectedKinds: string[];
  created: Profile[];
}

/**
 * Fresh-DB profile seeding from detected reality.
 *
 * Design: seeding runs once at API startup, before the server starts
 * listening (`greenroom up` starts the bridge first, so detection normally
 * answers immediately). The bridge is queried with a short timeout; when it
 * cannot answer (unconfigured, down, or slow) the mock fallback profiles are
 * seeded with a description explaining why and how to fix it. Fallback
 * profiles carry a `contextPreferences.seededBy` marker, so a database that
 * contains only the fallback still retries harness seeding on the next
 * startup (and the first-run wizard can call
 * `seedHarnessProfilesFromDetection` directly) — installing a harness CLI
 * and restarting upgrades to harness profiles without any re-seed system.
 *
 * An explicit `GREENROOM_DEFAULT_AI_BACKEND` override (or the
 * `defaultAiBackend` service option) wins over detection: it seeds
 * synchronously when the services are created, so this helper then sees a
 * non-empty profile table and reports `profiles_exist`.
 */
export async function seedProfilesFromDetection(
  services: Pick<GreenroomApiServices, "profiles" | "harnessClient">,
  options: ProfileSeedOptions = {},
): Promise<ProfileSeedResult> {
  const existing = services.profiles.list();
  const nonFallbackProfiles = existing.filter(
    (profile) => profile.contextPreferences.seededBy !== mockFallbackSeedMarker,
  );

  if (nonFallbackProfiles.length > 0) {
    return { outcome: "profiles_exist", detectedKinds: [], created: [] };
  }

  const detected = await detectInstalledHarnesses(services.harnessClient, options);
  const workflowCapable = detected.filter(detectedCliSupportsWorkflows);

  if (workflowCapable.length > 0) {
    return {
      outcome: "harness_detected",
      detectedKinds: workflowCapable.map((cli) => cli.kind),
      created: seedHarnessProfilesForDetectedClis(services.profiles, workflowCapable),
    };
  }

  const created =
    existing.length > 0
      ? []
      : services.profiles.seedProfiles(
          defaultMockProfileInputs({
            description: mockFallbackDescriptionForDetection(detected),
            seedMarker: mockFallbackSeedMarker,
          }),
        );

  return { outcome: "mock_fallback", detectedKinds: [], created };
}

/**
 * A detected CLI only drives profile seeding when its harness kind can run at
 * least one workflow (descriptor `supportedWorkflows`); a detected Codex CLI
 * (`supportedWorkflows: []`) must not seed profiles the bridge would reject.
 * Unknown kinds are assumed capable, matching `defaultHarnessProfileInputs`.
 */
function detectedCliSupportsWorkflows(cli: HarnessDetectedCli): boolean {
  const descriptor = getHarnessKindDescriptor(cli.kind);
  return descriptor === null || descriptor.supportedWorkflows.length > 0;
}

function mockFallbackDescriptionForDetection(detected: readonly HarnessDetectedCli[]): string {
  if (detected.length === 0) {
    return mockFallbackProfileDescription;
  }

  const labels = detected.map((cli) => cli.label).join(", ");
  return (
    `Mock AI profile seeded automatically: the detected harness CLI(s) (${labels}) cannot run ` +
    "Greenroom workflows yet, so no harness-backed profiles were created. Mock runs return " +
    "canned output. To use a real AI backend, install a supported harness CLI (for example " +
    "Claude Code) and restart Greenroom with `greenroom up`."
  );
}

/**
 * Seeds harness-backed default profiles for every harness CLI the bridge
 * currently reports as installed, skipping kinds and workflow types that
 * already have a harness profile. Safe to call at any time (idempotent);
 * exported for the first-run wizard so it can upgrade a mock-only
 * database after the user installs a harness CLI.
 */
export async function seedHarnessProfilesFromDetection(
  services: Pick<GreenroomApiServices, "profiles" | "harnessClient">,
  options: ProfileSeedOptions = {},
): Promise<Pick<ProfileSeedResult, "detectedKinds" | "created">> {
  const detected = await detectInstalledHarnesses(services.harnessClient, options);

  return {
    detectedKinds: detected.map((cli) => cli.kind),
    created: seedHarnessProfilesForDetectedClis(services.profiles, detected),
  };
}

async function detectInstalledHarnesses(
  harnessClient: HarnessClient | null,
  options: ProfileSeedOptions,
): Promise<HarnessDetectedCli[]> {
  if (harnessClient === null || harnessClient.detectedHarnesses === undefined) {
    return [];
  }

  const timeoutMs = options.detectionTimeoutMs ?? profileSeedDetectionTimeoutMsDefault;

  try {
    const response = await resolveWithTimeout(
      harnessClient.detectedHarnesses(),
      timeoutMs,
      `Harness detection timed out after ${timeoutMs}ms during profile seeding`,
    );

    return response.harnesses.filter((cli) => cli.found);
  } catch {
    // Detection is best-effort at seed time: an unreachable or slow bridge
    // degrades to the mock fallback (with explanation) instead of failing
    // API startup.
    return [];
  }
}

function seedHarnessProfilesForDetectedClis(
  profiles: ProfilePersistenceService,
  detected: readonly HarnessDetectedCli[],
): Profile[] {
  const existing = profiles.list();
  const inputs = detected.flatMap((cli) =>
    defaultHarnessProfileInputs(cli.kind, {
      label: cli.label,
      description: seededHarnessProfileDescription(cli),
    }).filter(
      (input) =>
        !existing.some(
          (profile) =>
            profile.workflowType === input.workflowType &&
            harnessKindFromProfile(profile) === cli.kind,
        ),
    ),
  );

  return profiles.seedProfiles(inputs);
}

function seededHarnessProfileDescription(cli: HarnessDetectedCli): string {
  const version = cli.version === null ? "" : ` (${cli.version})`;
  return `Seeded automatically because the ${cli.label} CLI${version} was detected on this machine.`;
}

function resolveWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function readMcpServerUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.GREENROOM_MCP_BASE_URL?.trim() ?? env.GREENROOM_MCP_SERVER_URL?.trim();

  if (explicit !== undefined && explicit.length > 0) {
    return explicit.replace(/\/+$/u, "");
  }

  const host = env.GREENROOM_MCP_HOST?.trim() || "127.0.0.1";
  const port = env.GREENROOM_MCP_PORT?.trim() || "49332";

  return `http://${host}:${port}`;
}

function readMcpServerPathFromEnv(env: Record<string, string | undefined> = process.env): string {
  const path = env.GREENROOM_MCP_PATH?.trim();

  if (path === undefined || path.length === 0) {
    return "/mcp";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

export async function registerRepository(
  services: GreenroomApiServices,
  input: RegisterRepositoryRequest,
): Promise<Repository> {
  const identity = await detectRepository(input.rootPath, gitOptions(services));
  const createInput: RepositoryCreateInput = {
    rootPath: identity.rootPath,
    gitCommonDir: identity.gitCommonDir,
    identityKey: identity.identityKey,
  };

  if (input.displayName !== undefined) {
    createInput.displayName = input.displayName;
  }

  if (input.defaultBranchCandidate !== undefined) {
    createInput.defaultBranchCandidate = input.defaultBranchCandidate;
  }

  return services.repositories.create(repositoryCreateInputSchema.parse(createInput));
}

export async function createCommittedReview(
  services: GreenroomApiServices,
  input: CreateCommittedReviewRequest,
): Promise<ReviewWithRevision> {
  const preview = await previewCommittedReview(services, input);

  const created = services.reviews.createWithInitialRevision({
    review: {
      repositoryId: input.repositoryId,
      title: preview.title,
      range: preview.range,
      baseRefDisplay: preview.baseRefDisplay,
      headRefDisplay: preview.headRefDisplay,
    },
    revision: {
      baseSha: preview.baseSha,
      headSha: preview.headSha,
      worktreeFingerprint: preview.worktreeFingerprint,
      diffSummary: preview.diffSummary,
    },
    diffFiles: preview.files,
  });

  services.events.emit("review.created", {
    review: created.review,
    repository: requireRepository(services, input.repositoryId),
    revision: created.revision,
    createdBy: input.createdBy ?? INTERNAL_REVIEW_CREATED_ACTOR,
    createdAt: services.clock(),
  });

  return created;
}

export async function previewCommittedReview(
  services: GreenroomApiServices,
  input: CreateCommittedReviewRequest,
): Promise<CommittedReviewPreview> {
  const comparisonMode = resolveReviewComparisonMode(input);

  if (comparisonMode === "worktree") {
    return previewDefaultWorktreeReview(services, input);
  }

  if (comparisonMode === "whole_repository") {
    return previewWholeRepositoryReview(services, input);
  }

  if (input.baseRef === undefined) {
    throw new ApiHttpError(400, "bad_request", "Refs comparison mode requires baseRef");
  }

  const repository = requireRepository(services, input.repositoryId);
  const headRef = input.headRef ?? "HEAD";
  const normalized = await constructReviewRange(
    repository.rootPath,
    gitOptions(services, {
      baseRef: input.baseRef,
      headRef,
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
    }),
  );

  const diffFiles = await generateStructuredCommittedDiff(
    repository.rootPath,
    gitOptions(services, {
      baseRef: normalized.baseSha,
      headRef: normalized.headSha,
    }),
  );
  const defaultTitle = `${normalized.baseRefDisplay}..${normalized.headRefDisplay}`;

  return {
    title: input.title ?? defaultTitle,
    range: normalized.range,
    baseSha: normalized.baseSha,
    headSha: normalized.headSha,
    worktreeFingerprint: null,
    baseRefDisplay: normalized.baseRefDisplay,
    headRefDisplay: normalized.headRefDisplay,
    diffSummary: summarizeDiffFiles(diffFiles),
    files: diffFiles,
  };
}

function resolveReviewComparisonMode(input: CreateCommittedReviewRequest): ReviewComparisonMode {
  return input.comparisonMode ?? (input.baseRef === undefined ? "worktree" : "refs");
}

async function previewWholeRepositoryReview(
  services: GreenroomApiServices,
  input: CreateCommittedReviewRequest,
): Promise<CommittedReviewPreview> {
  if (input.baseRef !== undefined) {
    throw new ApiHttpError(
      400,
      "bad_request",
      "Whole repository reviews compare the selected head against the empty repository",
    );
  }

  const repository = requireRepository(services, input.repositoryId);
  const headRef = input.headRef ?? "HEAD";
  const normalized = await constructWholeRepositoryReviewRange(
    repository.rootPath,
    gitOptions(services, { headRef }),
  );
  const diffFiles = await generateStructuredEmptyTreeDiff(
    repository.rootPath,
    gitOptions(services, { headRef: normalized.headSha }),
  );
  const defaultTitle = `${normalized.baseRefDisplay}..${normalized.headRefDisplay}`;

  return {
    title: input.title ?? defaultTitle,
    range: normalized.range,
    baseSha: normalized.baseSha,
    headSha: normalized.headSha,
    worktreeFingerprint: null,
    baseRefDisplay: normalized.baseRefDisplay,
    headRefDisplay: normalized.headRefDisplay,
    diffSummary: summarizeDiffFiles(diffFiles),
    files: diffFiles,
  };
}

async function previewDefaultWorktreeReview(
  services: GreenroomApiServices,
  input: CreateCommittedReviewRequest,
): Promise<CommittedReviewPreview> {
  if (input.headRef !== undefined && input.headRef !== "HEAD") {
    throw new ApiHttpError(
      400,
      "bad_request",
      "Default worktree reviews use the current HEAD; use a custom base/head review for other refs",
    );
  }

  const repository = requireRepository(services, input.repositoryId);
  const normalized = await constructDefaultWorktreeReviewRange(
    repository.rootPath,
    gitOptions(services),
  );
  const diffFiles = await generateStructuredWorktreeDiff(
    repository.rootPath,
    gitOptions(services, { baseRef: normalized.baseSha }),
  );
  const defaultTitle = `${normalized.baseRefDisplay}..${normalized.headRefDisplay}`;

  return {
    title: input.title ?? defaultTitle,
    range: normalized.range,
    baseSha: normalized.baseSha,
    headSha: normalized.headSha,
    worktreeFingerprint: normalized.worktreeFingerprint,
    baseRefDisplay: normalized.baseRefDisplay,
    headRefDisplay: normalized.headRefDisplay,
    diffSummary: summarizeDiffFiles(diffFiles),
    files: diffFiles,
  };
}

export function requireRepository(
  services: GreenroomApiServices,
  repositoryId: RepositoryId,
): Repository {
  const repository = services.repositories.get(repositoryId);

  if (repository === null) {
    throw new ApiHttpError(404, "not_found", `Repository ${repositoryId} was not found`);
  }

  return repository;
}

export function requireReview(
  services: GreenroomApiServices,
  reviewReference: ReviewReference,
): StoredReviewPr {
  const review = services.reviews.getByDisplayId(reviewReference);

  if (review === null) {
    throw new ApiHttpError(404, "not_found", `Review ${reviewReference} was not found`);
  }

  return review;
}

/**
 * Exit serializer: strips the opaque primary key before an entity crosses
 * the API boundary. Display refs are the only external identifiers.
 */
export function apiReview(review: StoredReviewPr): ReviewPr {
  const { id: _id, ...entity } = review;
  return entity;
}

export function readReviewResource(
  services: GreenroomApiServices,
  review: StoredReviewPr,
): ReviewApiResource {
  return {
    review: apiReview(review),
    repository: requireRepository(services, review.repositoryId),
    currentRevision:
      review.currentRevisionId === null
        ? null
        : services.reviews.getRevision(review.currentRevisionId),
  };
}

export function readRevisionDiffResource(
  services: GreenroomApiServices,
  reviewId: ReviewReference,
  revisionId: RevisionId,
  path?: string,
): ReviewDiffResource {
  const review = requireReview(services, reviewId);
  const revision = services.reviews.getRevision(revisionId);

  if (revision === null || revision.reviewDisplayId !== review.displayId) {
    throw new ApiHttpError(404, "not_found", `Revision ${revisionId} was not found`);
  }

  return {
    review: apiReview(review),
    revision,
    files:
      path === undefined
        ? services.reviews.listDiffFiles(revision.id)
        : [requireDiffFile(services, revision.id, path)],
  };
}

function requireDiffFile(
  services: GreenroomApiServices,
  revisionId: RevisionId,
  path: string,
): DiffFile {
  const file = services.reviews.getDiffFile(revisionId, path);

  if (file === null) {
    throw new ApiHttpError(404, "not_found", `Changed file ${path} was not found`);
  }

  return file;
}

export function createWorkflowRunForReview(
  services: GreenroomApiServices,
  input: CreateWorkflowRunForReviewRequest,
): WorkflowRun {
  const review = requireReview(services, input.reviewDisplayId);
  const revision =
    input.revisionId === undefined || input.revisionId === null
      ? requireCurrentRevision(services, review)
      : services.reviews.getRevision(input.revisionId);

  if (revision === null || revision.reviewDisplayId !== review.displayId) {
    throw new ApiHttpError(404, "not_found", `Revision ${input.revisionId} was not found`);
  }

  const profile = services.profiles.get(input.profileId);

  if (profile === null) {
    throw new ApiHttpError(404, "not_found", `Profile ${input.profileId} was not found`);
  }

  assertWorkflowProfileCompatible(input.workflowKind, profile.workflowType);

  const expectedOutputMode =
    input.expectedOutputMode ?? expectedOutputModeForKind(input.workflowKind);
  const allowedMcpCapabilities =
    input.allowedMcpCapabilities ?? defaultMcpCapabilitiesForKind(input.workflowKind);
  const expectedMcpResources =
    input.expectedMcpResources ??
    defaultExpectedMcpResourcesForKind(input.workflowKind, review.displayId);
  const changedFiles = workflowChangedFilesForRevision(services, revision);
  const harnessKind = input.harnessKind ?? harnessKindForProfile(profile);
  const scopeLabel = input.scopeLabel ?? "All changed files";
  const profileIdleTimeoutMs = harnessIdleTimeoutMsFromProfile(profile);
  const idleTimeoutMs = input.idleTimeoutMs ?? profileIdleTimeoutMs;
  const repository = requireRepository(services, review.repositoryId);
  const repositoryAccess = workflowRepositoryAccessSummaryForProfile({
    profile,
    repository,
    revision,
  });

  return services.workflowRunner.createRun({
    run: {
      workflowKind: input.workflowKind,
      revisionId: revision.id,
      profileId: profile.id,
      harnessKind,
      consentSummary: {
        workflowKind: input.workflowKind,
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
        scopeLabel,
        changedFiles,
        allowedMcpCapabilities,
        expectedMcpResources,
        expectedOutputMode,
        repositoryAccess,
        threadCreationGate: input.threadCreationGate ?? null,
        tracingStatus: workflowTracingStatusForProfile(profile, services.workflowRuntimeConfig),
      },
      metadata: {
        ...stripOrchestratorReservedWorkflowMetadata(input.clientMetadata ?? {}),
        ...(input.metadata ?? {}),
        ...workflowRepositoryAccessMetadata(repositoryAccess),
        ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
        ...(input.absoluteTimeoutMs === undefined
          ? {}
          : { absoluteTimeoutMs: input.absoluteTimeoutMs }),
      },
    },
  });
}

export function createHandoffBundle(
  services: GreenroomApiServices,
  input: HandoffRequest,
): HandoffBundle {
  const review = requireReview(services, input.reviewDisplayId);
  const resource = readReviewResource(services, review);
  const selectedThreads = input.threadRefs.map((threadRef) => {
    const thread = services.threads.getByRef(threadRef);

    if (thread === null) {
      throw new ApiHttpError(404, "not_found", `Thread ${threadRef} was not found`);
    }

    if (thread.reviewDisplayId !== review.displayId) {
      throw new ApiHttpError(
        400,
        "bad_request",
        `Thread ${threadRef} belongs to a different review than ${review.displayId}`,
      );
    }

    return {
      thread,
      anchor: thread.anchor,
      anchors: thread.anchors,
      comments: thread.comments,
      snippets: snippetsForThreadAnchors(services, thread),
    };
  });

  return handoffBundleSchema.parse({
    reviewDisplayId: review.displayId,
    review: apiReview(review),
    repository: resource.repository,
    currentRevision: resource.currentRevision,
    selectedThreadRefs: input.threadRefs,
    desiredOutcome: input.desiredOutcome ?? null,
    threads: selectedThreads,
    createdAt: services.clock(),
  });
}

export function recordAgentEvent(
  services: GreenroomApiServices,
  input: AgentEventCreateInput,
): AgentEvent {
  const parsed = agentEventCreateInputSchema.parse(input);

  if (parsed.reviewDisplayId !== undefined && parsed.reviewDisplayId !== null) {
    requireReview(services, parsed.reviewDisplayId);

    for (const threadRef of parsed.threadRefs) {
      const thread = services.threads.getByRef(threadRef);

      if (thread === null || thread.reviewDisplayId !== parsed.reviewDisplayId) {
        throw new ApiHttpError(404, "not_found", `Thread ${threadRef} was not found`);
      }
    }
  }

  return services.agentEvents.create(parsed);
}

function assertWorkflowProfileCompatible(
  workflowKind: WorkflowKind,
  workflowType: Profile["workflowType"],
): void {
  const expected = profileWorkflowTypeForKind(workflowKind);

  if (expected === null || workflowType === expected) {
    return;
  }

  throw new ApiHttpError(
    400,
    "bad_request",
    `Workflow ${workflowKind} requires a ${expected} profile`,
  );
}

function profileWorkflowTypeForKind(workflowKind: WorkflowKind): Profile["workflowType"] | null {
  switch (workflowKind) {
    case "builtin_review":
      return "builtin_review";
    case "spotlight_plan":
    case "spotlight_membership":
    case "spotlight_refine":
      return "spotlight";
    case "teaching_generate":
    case "teaching_follow_up":
      return "teaching";
    case "setup_smoke":
      return null;
  }
}

function expectedOutputModeForKind(workflowKind: WorkflowKind): WorkflowExpectedOutputMode {
  switch (workflowKind) {
    case "builtin_review":
      return "builtin_review_findings";
    case "spotlight_plan":
    case "spotlight_refine":
      return "spotlight_outline";
    case "spotlight_membership":
      return "spotlight_membership";
    case "teaching_generate":
      return "teaching_draft";
    case "teaching_follow_up":
      return "teaching_follow_up_answer";
    case "setup_smoke":
      return "setup_smoke_report";
  }
}

function defaultMcpCapabilitiesForKind(workflowKind: WorkflowKind): WorkflowMcpCapability[] {
  const capabilities: WorkflowMcpCapability[] = [
    "review:read",
    "revision:read",
    "diff:read",
    "draft:submit",
    "validation:read",
  ];

  if (workflowKind === "builtin_review") {
    capabilities.push("threads:read");
    capabilities.push("spotlight:read");
  }

  if (
    workflowKind === "spotlight_plan" ||
    workflowKind === "spotlight_membership" ||
    workflowKind === "spotlight_refine"
  ) {
    capabilities.push("threads:read");
    capabilities.push("spotlight:read");
  }

  if (workflowKind === "teaching_generate") {
    capabilities.push("teaching:read");
  }

  if (workflowKind === "teaching_follow_up") {
    capabilities.push("teaching:read");
  }

  return capabilities;
}

function defaultExpectedMcpResourcesForKind(
  workflowKind: WorkflowKind,
  reviewDisplayId: ReviewPr["displayId"],
): string[] {
  const review = reviewDisplayId;
  const base = [
    "greenroom://concepts/review-model",
    "greenroom://concepts/anchors",
    `greenroom://reviews/${review}/manifest`,
    `greenroom://reviews/${review}/diff-summary`,
    `greenroom://reviews/${review}/files`,
    `greenroom://reviews/${review}/files/{path}`,
    `greenroom://reviews/${review}/anchors/{path}`,
    "greenroom://runs/{runId}/instructions",
    "greenroom://runs/{runId}/output-schema",
    "greenroom://runs/{runId}/consent-scope",
    "greenroom://runs/{runId}/validation-errors",
  ];

  if (workflowKind === "builtin_review") {
    return [
      ...base,
      `greenroom://reviews/${review}/threads`,
      `greenroom://reviews/${review}/spotlight/views`,
    ];
  }

  if (
    workflowKind === "spotlight_plan" ||
    workflowKind === "spotlight_membership" ||
    workflowKind === "spotlight_refine"
  ) {
    return [
      ...base,
      `greenroom://reviews/${review}/threads`,
      `greenroom://reviews/${review}/spotlight/views`,
      `greenroom://reviews/${review}/spotlight/coverage`,
    ];
  }

  if (workflowKind === "teaching_generate" || workflowKind === "teaching_follow_up") {
    return [
      ...base,
      `greenroom://reviews/${review}/threads`,
      `greenroom://reviews/${review}/spotlight/views`,
    ];
  }

  return base;
}

function workflowChangedFilesForRevision(
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

function harnessKindForProfile(profile: Profile): string {
  if (profile.provider === "harness") {
    const harnessSettings = profile.modelSettings.harness;

    if (
      harnessSettings !== null &&
      typeof harnessSettings === "object" &&
      "kind" in harnessSettings &&
      typeof harnessSettings.kind === "string" &&
      harnessSettings.kind.trim().length > 0
    ) {
      return harnessSettings.kind;
    }
  }

  return profile.model;
}

function snippetsForThreadAnchors(
  services: GreenroomApiServices,
  thread: ThreadWithComments,
): string[] {
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const anchor of thread.anchors) {
    const anchorSnippets = snippetsForThreadAnchor(services, anchor);
    const key = anchorSnippets.join("\n");

    if (key.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    snippets.push(...(snippets.length === 0 ? anchorSnippets : ["", ...anchorSnippets]));
  }

  return snippets;
}

function snippetsForThreadAnchor(services: GreenroomApiServices, anchor: ThreadAnchor): string[] {
  const files = services.reviews.listDiffFiles(anchor.revisionId);
  const file = files.find(
    (candidate) =>
      candidate.path === anchor.filePath && (candidate.oldPath ?? null) === anchor.oldFilePath,
  );

  if (file === undefined) {
    return [];
  }

  const hunk =
    anchor.hunkId === null
      ? file.hunks.find((candidate) => hunkContainsAnchor(candidate, anchor))
      : file.hunks.find((candidate) => candidate.id === anchor.hunkId);

  if (hunk === undefined) {
    return [];
  }

  const anchorIndex = hunk.lines.findIndex(
    (line) =>
      line.type === anchor.lineType &&
      lineNumberForAnchorSide(line, anchor.side) === anchor.lineNumber,
  );

  if (anchorIndex < 0) {
    return [];
  }

  const start = Math.max(0, anchorIndex - 3);
  const end = Math.min(hunk.lines.length, anchorIndex + 4);

  return [
    `${file.path}${file.oldPath === null ? "" : ` (renamed from ${file.oldPath})`}`,
    hunk.header,
    ...hunk.lines.slice(start, end).map(formatSnippetLine),
  ];
}

function hunkContainsAnchor(hunk: DiffHunk, anchor: ThreadAnchor): boolean {
  return hunk.lines.some(
    (line) =>
      line.type === anchor.lineType &&
      lineNumberForAnchorSide(line, anchor.side) === anchor.lineNumber,
  );
}

function formatSnippetLine(line: DiffLine): string {
  const marker = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
  const oldNumber = line.oldLineNumber === null ? " " : String(line.oldLineNumber);
  const newNumber = line.newLineNumber === null ? " " : String(line.newLineNumber);

  return `${marker} ${oldNumber.padStart(4)} ${newNumber.padStart(4)} ${line.content}`;
}

export function requireCurrentRevision(
  services: GreenroomApiServices,
  review: ReviewPr,
): RevisionSnapshot {
  if (review.currentRevisionId === null) {
    throw new ApiHttpError(404, "not_found", `Review ${review.displayId} has no current revision`);
  }

  const revision = services.reviews.getRevision(review.currentRevisionId);

  if (revision === null) {
    throw new ApiHttpError(404, "not_found", `Revision ${review.currentRevisionId} was not found`);
  }

  return revision;
}

/**
 * Cheap worktree dirtiness check: compares the current worktree
 * fingerprint with the review's latest revision snapshot so run-start
 * surfaces can warn before consenting a run that would fail on a
 * fingerprint change. `applicable` is false for committed-range reviews,
 * whose snapshots carry no worktree fingerprint.
 */
export interface ReviewWorktreeStatus {
  reviewDisplayId: ReviewDisplayId;
  revisionId: RevisionId | null;
  applicable: boolean;
  dirty: boolean;
  snapshotFingerprint: WorktreeFingerprint | null;
  currentFingerprint: WorktreeFingerprint | null;
  checkedAt: string;
}

export async function readReviewWorktreeStatus(
  services: GreenroomApiServices,
  reviewId: ReviewReference,
): Promise<ReviewWorktreeStatus> {
  const review = requireReview(services, reviewId);
  const revision =
    review.currentRevisionId === null
      ? null
      : services.reviews.getRevision(review.currentRevisionId);
  const snapshotFingerprint = revision?.worktreeFingerprint ?? null;

  if (revision === null || snapshotFingerprint === null) {
    return {
      reviewDisplayId: review.displayId,
      revisionId: revision?.id ?? null,
      applicable: false,
      dirty: false,
      snapshotFingerprint: null,
      currentFingerprint: null,
      checkedAt: services.clock(),
    };
  }

  const repository = requireRepository(services, review.repositoryId);
  const currentFingerprint = await getWorktreeFingerprint(
    repository.rootPath,
    gitOptions(services),
  );

  return {
    reviewDisplayId: review.displayId,
    revisionId: revision.id,
    applicable: true,
    dirty: !worktreeFingerprintsMatch(snapshotFingerprint, currentFingerprint),
    snapshotFingerprint,
    currentFingerprint,
    checkedAt: services.clock(),
  };
}

export function worktreeFingerprintsMatch(
  snapshot: WorktreeFingerprint,
  current: WorktreeFingerprint,
): boolean {
  return (
    snapshot.headSha === current.headSha &&
    snapshot.stagedDiffHash === current.stagedDiffHash &&
    snapshot.unstagedDiffHash === current.unstagedDiffHash
  );
}

export async function refreshReview(
  services: GreenroomApiServices,
  reviewId: ReviewReference,
): Promise<RefreshReviewResult> {
  const review = requireReview(services, reviewId);

  return serializeReviewRefresh(services, review.id, () =>
    refreshReviewSerialized(services, review.displayId),
  );
}

const reviewRefreshLocks = new WeakMap<GreenroomApiServices, Map<ReviewPrId, Promise<void>>>();

async function serializeReviewRefresh<T>(
  services: GreenroomApiServices,
  reviewId: ReviewPrId,
  operation: () => Promise<T>,
): Promise<T> {
  let locks = reviewRefreshLocks.get(services);

  if (locks === undefined) {
    locks = new Map();
    reviewRefreshLocks.set(services, locks);
  }

  const previous = locks.get(reviewId) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  locks.set(reviewId, tail);

  await previous;

  try {
    return await operation();
  } finally {
    release();

    if (locks.get(reviewId) === tail) {
      locks.delete(reviewId);

      if (locks.size === 0) {
        reviewRefreshLocks.delete(services);
      }
    }
  }
}

async function refreshReviewSerialized(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
): Promise<RefreshReviewResult> {
  for (;;) {
    const review = requireReview(services, reviewDisplayId);
    const currentRevision = requireCurrentRevision(services, review);
    const nextSnapshot = await buildRefreshSnapshot(services, review, currentRevision);

    if (revisionMatchesSnapshot(currentRevision, nextSnapshot)) {
      return reusedRefreshResult(review, currentRevision);
    }

    const committed = commitReviewRefresh(
      services,
      review.displayId,
      currentRevision.id,
      nextSnapshot,
    );

    if (committed !== null) {
      return committed;
    }

    // Another writer advanced the pointer between snapshot construction and
    // the transaction boundary. Rebuild from the new current revision rather
    // than committing a stale snapshot over it.
  }
}

function reusedRefreshResult(
  review: StoredReviewPr,
  revision: RevisionSnapshot,
): RefreshReviewResult {
  return {
    review,
    revision,
    reused: true,
    remap: { remapped: 0, outdated: 0 },
    spotlightRemap: { remapped: 0, stale: 0, driftedViews: 0 },
  };
}

function commitReviewRefresh(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  expectedRevisionId: RevisionId,
  nextSnapshot: RefreshSnapshot,
): RefreshReviewResult | null {
  return services.withReviewRefreshTransaction((persistence) => {
    const transactionServices: GreenroomApiServices = { ...services, ...persistence };
    const review = requireReview(transactionServices, reviewDisplayId);
    const currentRevision = requireCurrentRevision(transactionServices, review);

    if (currentRevision.id !== expectedRevisionId) {
      return revisionMatchesSnapshot(currentRevision, nextSnapshot)
        ? reusedRefreshResult(review, currentRevision)
        : null;
    }

    const created = transactionServices.reviews.createRevision({
      reviewId: review.id,
      revision: {
        baseSha: nextSnapshot.baseSha,
        headSha: nextSnapshot.headSha,
        worktreeFingerprint: nextSnapshot.worktreeFingerprint,
        diffSummary: nextSnapshot.diffSummary,
        refreshReason: "manual_refresh",
      },
      diffFiles: nextSnapshot.files,
    });

    if (created === null) {
      throw new ApiHttpError(404, "not_found", `Review ${review.id} was not found`);
    }

    const refreshedFiles = transactionServices.reviews.listDiffFiles(created.revision.id);
    const remap = remapThreadsToRevision(
      transactionServices,
      review,
      created.revision.id,
      refreshedFiles,
    );
    const spotlightRemap = remapSpotlightRegionsToRevision(
      transactionServices,
      review,
      created.revision.id,
      refreshedFiles,
    );

    return {
      ...created,
      reused: false,
      remap,
      spotlightRemap,
    };
  });
}

interface RefreshSnapshot {
  baseSha: string;
  headSha: string;
  worktreeFingerprint: WorktreeFingerprint | null;
  diffSummary: DiffSummary;
  files: StructuredDiffFile[];
}

async function buildRefreshSnapshot(
  services: GreenroomApiServices,
  review: ReviewPr,
  currentRevision: RevisionSnapshot,
): Promise<RefreshSnapshot> {
  const repository = requireRepository(services, review.repositoryId);

  if (review.range.kind === "worktree" || review.range.headRef.kind === "worktree") {
    const worktreeFingerprint = await getWorktreeFingerprint(
      repository.rootPath,
      gitOptions(services),
    );
    const files = await generateStructuredWorktreeDiff(
      repository.rootPath,
      gitOptions(services, { baseRef: currentRevision.baseSha }),
    );

    return {
      baseSha: currentRevision.baseSha,
      headSha: worktreeFingerprint.headSha,
      worktreeFingerprint,
      diffSummary: summarizeDiffFiles(files),
      files,
    };
  }

  if (review.range.kind === "whole_repository") {
    const normalized = await constructWholeRepositoryReviewRange(
      repository.rootPath,
      gitOptions(services, { headRef: review.range.headRef.value }),
    );
    const files = await generateStructuredEmptyTreeDiff(
      repository.rootPath,
      gitOptions(services, { headRef: normalized.headSha }),
    );

    return {
      baseSha: normalized.baseSha,
      headSha: normalized.headSha,
      worktreeFingerprint: null,
      diffSummary: summarizeDiffFiles(files),
      files,
    };
  }

  const refreshKind = committedRefreshKind(review.range.kind);
  const normalized = await constructReviewRange(
    repository.rootPath,
    gitOptions(services, {
      baseRef: review.range.baseRef.value,
      headRef: review.range.headRef.value,
      ...(refreshKind !== undefined ? { kind: refreshKind } : {}),
    }),
  );
  const files = await generateStructuredCommittedDiff(
    repository.rootPath,
    gitOptions(services, {
      baseRef: normalized.baseSha,
      headRef: normalized.headSha,
    }),
  );

  return {
    baseSha: normalized.baseSha,
    headSha: normalized.headSha,
    worktreeFingerprint: null,
    diffSummary: summarizeDiffFiles(files),
    files,
  };
}

function committedRefreshKind(kind: ReviewRangeKind): ReviewRangeKind | undefined {
  return kind === "default_branch" || kind === "worktree" ? undefined : kind;
}

function revisionMatchesSnapshot(revision: RevisionSnapshot, snapshot: RefreshSnapshot): boolean {
  return (
    revision.baseSha === snapshot.baseSha &&
    revision.headSha === snapshot.headSha &&
    JSON.stringify(revision.worktreeFingerprint) === JSON.stringify(snapshot.worktreeFingerprint)
  );
}

function remapThreadsToRevision(
  services: GreenroomApiServices,
  review: StoredReviewPr,
  revisionId: RevisionId,
  files: readonly DiffFile[],
): { remapped: number; outdated: number } {
  let remapped = 0;
  let outdated = 0;

  for (const thread of services.threads.listByReview(review.id)) {
    const result = remapThreadAnchor(thread, review.displayId, revisionId, files);

    services.threads.updateAnchor(thread.shortRef, {
      anchor: result.anchor,
      anchors: result.anchors,
      remapConfidence: result.confidence,
      outdated: result.outdated,
    });

    if (result.outdated) {
      outdated += 1;
    } else {
      remapped += 1;
    }
  }

  return { remapped, outdated };
}

interface AnchorRemapResult {
  anchor: ThreadAnchor;
  anchors: ThreadAnchor[];
  confidence: number | null;
  outdated: boolean;
}

function remapThreadAnchor(
  thread: ThreadWithComments,
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  files: readonly DiffFile[],
): AnchorRemapResult {
  const result = remapAnchorSet({
    primaryAnchor: thread.anchor,
    anchors: thread.anchors,
    reviewDisplayId,
    revisionId,
    files,
  });

  return {
    anchor: result.primaryAnchor,
    anchors: result.anchors,
    confidence: result.confidence,
    outdated: result.stale,
  };
}

function remapSpotlightRegionsToRevision(
  services: GreenroomApiServices,
  review: StoredReviewPr,
  revisionId: RevisionId,
  files: readonly DiffFile[],
): { remapped: number; stale: number; driftedViews: number } {
  let remapped = 0;
  let stale = 0;
  let driftedViews = 0;

  for (const view of services.spotlight.listViewsWithRegionsByReview(review.id)) {
    const replacementRegions: CreateSpotlightRegionForViewInput[] = [];
    let viewHasStaleRegion = false;

    for (const region of view.regions) {
      const primaryAnchor = region.anchors[0];

      if (primaryAnchor === undefined) {
        continue;
      }

      const result = remapAnchorSet({
        primaryAnchor,
        anchors: region.anchors,
        reviewDisplayId: review.displayId,
        revisionId,
        files,
      });

      if (result.stale) {
        stale += 1;
        viewHasStaleRegion = true;
        replacementRegions.push({
          filePath: region.filePath,
          oldPath: region.oldPath,
          anchors: region.anchors,
          remapConfidence: result.confidence,
          stale: true,
        });
        continue;
      }

      remapped += 1;
      replacementRegions.push(...groupAnchorsByFile(result.anchors, result.confidence, false));
    }

    services.spotlight.replaceRegions(view.displayRef, replacementRegions);
    services.spotlight.updateViewHealth(view.displayRef, {
      health: viewHasStaleRegion ? "drifted" : view.health === "outdated" ? "outdated" : "current",
      lastReconciledRevisionId: revisionId,
    });

    if (viewHasStaleRegion) {
      driftedViews += 1;
    }
  }

  return { remapped, stale, driftedViews };
}

function groupAnchorsByFile(
  anchors: readonly ThreadAnchor[],
  remapConfidence: number | null,
  stale: boolean,
): CreateSpotlightRegionForViewInput[] {
  const grouped = new Map<string, CreateSpotlightRegionForViewInput>();

  for (const anchor of anchors) {
    const key = `${anchor.filePath}\0${anchor.oldFilePath ?? ""}`;
    const existing = grouped.get(key);

    if (existing === undefined) {
      grouped.set(key, {
        filePath: anchor.filePath,
        oldPath: anchor.oldFilePath,
        anchors: [anchor],
        remapConfidence,
        stale,
      });
      continue;
    }

    existing.anchors.push(anchor);
  }

  return Array.from(grouped.values());
}

export function assertAnchorTargetsChangedLine(
  services: GreenroomApiServices,
  anchor: ThreadAnchor,
): void {
  const review = requireReview(services, anchor.reviewDisplayId);
  const revision = services.reviews.getRevision(anchor.revisionId);

  if (revision === null || revision.reviewDisplayId !== review.displayId) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor revision does not belong to review");
  }

  if (review.currentRevisionId !== revision.id) {
    throw new ApiHttpError(409, "conflict", "Thread anchors must target the current revision");
  }

  const file = findAnchorFile(services.reviews.listDiffFiles(revision.id), anchor);

  if (file === null) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor file was not found in the diff");
  }

  const hunk =
    anchor.hunkId === null
      ? file.hunks.find((candidate) =>
          candidate.lines.some((line) => lineTargetsAnchor(line, anchor)),
        )
      : file.hunks.find((candidate) => candidate.id === anchor.hunkId);

  if (hunk === undefined) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor hunk was not found in the diff");
  }

  const line = hunk.lines.find((candidate) => lineTargetsAnchor(candidate, anchor));

  if (line === undefined) {
    throw new ApiHttpError(400, "bad_request", "Thread anchor must target a changed diff line");
  }
}

export function assertAnchorsTargetChangedLines(
  services: GreenroomApiServices,
  anchors: readonly ThreadAnchor[],
): void {
  for (const anchor of anchors) {
    assertAnchorTargetsChangedLine(services, anchor);
  }
}

function findAnchorFile(files: readonly DiffFile[], anchor: ThreadAnchor): DiffFile | null {
  return (
    files.find(
      (file) => file.path === anchor.filePath && (file.oldPath ?? null) === anchor.oldFilePath,
    ) ?? null
  );
}

function lineTargetsAnchor(line: DiffLine, anchor: ThreadAnchor): boolean {
  if (line.type !== anchor.lineType) {
    return false;
  }

  if (anchor.side === "head") {
    return line.type === "addition" && line.newLineNumber === anchor.lineNumber;
  }

  return line.type === "deletion" && line.oldLineNumber === anchor.lineNumber;
}

export function gitOptions<T extends object = object>(
  services: Pick<GreenroomApiServices, "gitTimeoutMs">,
  options: T = {} as T,
): T & { timeoutMs?: number } {
  if (services.gitTimeoutMs === undefined) {
    return options;
  }

  return { ...options, timeoutMs: services.gitTimeoutMs };
}
