import { Hono, type Context } from "hono";
import { getConnInfo } from "hono/bun";
import * as z from "zod";

import {
  absolutePathSchema,
  agentEventCreateInputSchema,
  builtinReviewConsentCreateInputSchema,
  builtinReviewRunIdSchema,
  capabilityScopesSchema,
  capabilityTokenCreateInputSchema,
  commentCreateInputSchema,
  gitRefSchema,
  handoffRequestSchema,
  profileCreateInputSchema,
  profileIdSchema,
  profileUpdateInputSchema,
  repositoryIdSchema,
  relativePathSchema,
  reviewReferenceSchema,
  reviewRangeKindSchema,
  reviewStateFilterSchema,
  reviewStatusSchema,
  revisionIdSchema,
  spotlightRunIdSchema,
  spotlightViewReferenceSchema,
  teachingConsentCreateInputSchema,
  teachingFollowUpRequestSchema,
  teachingPromotionInputSchema,
  teachingRunIdSchema,
  threadCreateInputSchema,
  threadReferenceSchema,
  threadStatusSchema,
  tokenIdSchema,
  workflowDraftOutputSchema,
  workflowExpectedOutputModeSchema,
  workflowKindSchema,
  workflowMcpCapabilitySchema,
  workflowRedactedMetadataSchema,
  workflowRunIdSchema,
  type WorkflowRun,
} from "@greenroom/schemas";
import {
  detectDefaultBranchCandidates,
  listBranches,
  listCommits,
  listRefs,
  listTags,
} from "@greenroom/git";

import type { GreenroomEnvironment } from "../config/paths";
import { hasScope, requireBearerAuth, requireScope, type GreenroomAuthEnv } from "./auth";
import {
  configFileUpdateRequestSchema,
  readConfigFileResource,
  writeConfigFileResource,
} from "./config-api";
import { apiErrorResponse, ApiHttpError, handleApiError } from "./errors";
import { readRuntimeStatusResource } from "./runtime-status";
import { createStaticWebHandler } from "./static-web";
import { createOpenApiDocument } from "./openapi";
import {
  assertAnchorsTargetChangedLines,
  createCommittedReview,
  createWorkflowRunForReview,
  createHandoffBundle,
  type GreenroomApiServices,
  apiReview,
  readReviewResource,
  readRevisionDiffResource,
  recordAgentEvent,
  registerRepository,
  requireCurrentRevision,
  requireRepository,
  requireReview,
  refreshReview,
  readReviewWorktreeStatus,
  gitOptions,
  previewCommittedReview,
} from "./services";
import { recoverWorkflowRunFromFingerprintChange } from "./run-recovery";
import {
  approveBuiltinReviewDraft,
  approveBuiltinReviewRun,
  createBuiltinReviewConsent,
  readBuiltinReviewRun,
} from "./builtin-review";
import {
  answerTeachingFollowUp,
  approveTeachingRun,
  createTeachingConsent,
  promoteTeachingPoint,
  readTeachingRun,
} from "./teaching";
import {
  createHarnessSetupSmokeResponse,
  installHarnessSkillPackage,
  readHarnessSkillCheck,
  readHarnessStatus,
} from "./harness-client";
import {
  approveSpotlightRunContext,
  approveSpotlightRunPlan,
  createSpotlightRun,
  listSpotlightViews,
  readSpotlightCoverage,
  readSpotlightLineMembership,
  readSpotlightRun,
  readSpotlightView,
  readSpotlightViewDiff,
  refineSpotlightRunPlan,
  spotlightPlanApprovalRequestSchema,
  spotlightPlanRefineRequestSchema,
  spotlightRunRequestSchema,
} from "./spotlight";
import { deriveWorkflowRunDiagnostics } from "../workflows/diagnostics";
import { parseJsonBody, parsePathParam, parseQuery } from "./validation";

export interface CreateGreenroomAppOptions {
  services: GreenroomApiServices;
  allowedOrigins?: readonly string[];
  allowLoopbackOrigins?: boolean;
  setupTokenEndpointEnabled?: boolean;
  /**
   * Resolves the remote (client) address of a request for the setup-token
   * endpoint's post-bootstrap loopback check. Defaults to Bun's
   * `server.requestIP` via hono/bun; injectable for tests (where requests
   * are dispatched without a Bun server and the address is unknown).
   * Returning `null` means "unknown", which fails closed.
   */
  setupTokenClientAddress?: (context: Context) => string | null;
  /**
   * Raw process environment used by the config-file API to resolve the
   * `greenroom.toml` path and detect env-var overrides. This must be the
   * unresolved environment (not the output of `loadGreenroomEnvironment`,
   * which overlays file values onto unset env vars); otherwise every file
   * value would be misreported as an env override.
   */
  configFileEnv?: GreenroomEnvironment;
  /**
   * Directory containing the built web app (Vite dist). When set, unknown
   * GET requests outside `/api` serve the SPA (static assets + index.html
   * fallback) from the same origin as the API. Registered after every API
   * route, so JSON endpoints always take precedence.
   */
  webDistDir?: string | null;
}

const repositoryRegistrationRequestSchema = z
  .object({
    rootPath: absolutePathSchema,
    displayName: z.string().trim().min(1).max(200).optional(),
    defaultBranchCandidate: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();

const refsQuerySchema = z
  .object({
    kind: z.enum(["all", "branches", "tags"]).default("all"),
  })
  .strict();

const reviewListQuerySchema = z
  .object({
    state: z.preprocess(
      (value) => (typeof value === "string" ? value.toLowerCase() : value),
      reviewStateFilterSchema.default("open"),
    ),
  })
  .strict();

const workflowRunListQuerySchema = z
  .object({
    // "active" is the only supported filter today: the cross-review list
    // backs the app header run indicator and completion toasts,
    // which only care about queued/running/repairing work.
    status: z.literal("active").default("active"),
  })
  .strict();

const commitsQuerySchema = z
  .object({
    baseRef: gitRefSchema.optional(),
    headRef: gitRefSchema.optional(),
    search: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
  })
  .strict()
  .refine(
    (value) =>
      (value.baseRef === undefined && value.headRef === undefined) ||
      (value.baseRef !== undefined && value.headRef !== undefined),
    "Commit range queries require both baseRef and headRef",
  );

const committedReviewCreateRequestSchema = z
  .object({
    repositoryId: repositoryIdSchema,
    title: z.string().trim().min(1).max(240).optional(),
    baseRef: gitRefSchema.optional(),
    headRef: gitRefSchema.optional(),
    kind: reviewRangeKindSchema.optional(),
    comparisonMode: z.enum(["worktree", "refs", "whole_repository"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const mode = value.comparisonMode ?? (value.baseRef === undefined ? "worktree" : "refs");

    if (mode === "worktree") {
      if (value.baseRef !== undefined) {
        context.addIssue({
          code: "custom",
          message: "Worktree reviews are created from the default mode without baseRef",
          path: ["baseRef"],
        });
      }

      if (value.headRef !== undefined && value.headRef !== "HEAD") {
        context.addIssue({
          code: "custom",
          message: "Default worktree reviews use the current HEAD",
          path: ["headRef"],
        });
      }

      if (value.kind !== undefined && value.kind !== "worktree") {
        context.addIssue({
          code: "custom",
          message: "Worktree comparison mode only accepts kind worktree",
          path: ["kind"],
        });
      }

      return;
    }

    if (mode === "whole_repository") {
      if (value.baseRef !== undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Whole repository reviews compare the selected head against the empty repository",
          path: ["baseRef"],
        });
      }

      if (value.kind !== undefined && value.kind !== "whole_repository") {
        context.addIssue({
          code: "custom",
          message: "Whole repository comparison mode only accepts kind whole_repository",
          path: ["kind"],
        });
      }

      return;
    }

    if (value.baseRef === undefined) {
      context.addIssue({
        code: "custom",
        message: "Refs comparison mode requires baseRef",
        path: ["baseRef"],
      });
    }

    if (value.comparisonMode === "refs" && value.headRef === undefined) {
      context.addIssue({
        code: "custom",
        message: "Refs comparison mode requires headRef",
        path: ["headRef"],
      });
    }

    if (value.kind === "worktree" || value.kind === "whole_repository") {
      context.addIssue({
        code: "custom",
        message: "Refs comparison mode requires a committed-ref range kind",
        path: ["kind"],
      });
    }
  });

const threadReplyRequestSchema = commentCreateInputSchema.omit({ threadRef: true }).strict();

const setupTokenCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160).default("Local setup admin"),
    scopes: capabilityScopesSchema.default(["admin"]),
  })
  .strict()
  // Setup tokens always carry admin scope: the web app that mints them needs
  // token/config management (Settings), and a loopback client is the
  // local operator anyway, so a reduced-scope default would only break the UI
  // without adding a security boundary.
  .refine((value) => value.scopes.includes("admin"), {
    path: ["scopes"],
    message: "Setup tokens must include admin scope",
  });

const harnessKindPathParamSchema = z.string().trim().min(1).max(120);

const harnessSetupSmokeRequestSchema = z
  .object({
    kind: harnessKindPathParamSchema.default("claude-code"),
  })
  .strict();

const workflowRunCreateRequestSchema = z
  .object({
    workflowKind: workflowKindSchema,
    profileId: profileIdSchema,
    revisionId: revisionIdSchema.nullable().optional(),
    harnessKind: z.string().trim().min(1).max(120).optional(),
    scopeLabel: z.string().trim().min(1).max(240).optional(),
    allowedMcpCapabilities: z.array(workflowMcpCapabilitySchema).max(40).optional(),
    expectedOutputMode: workflowExpectedOutputModeSchema.optional(),
    idleTimeoutMs: z
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    absoluteTimeoutMs: z
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    metadata: workflowRedactedMetadataSchema.optional(),
  })
  .strict();

const workflowRunCancelRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();

const workflowRunProgressRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    completedUnits: z.number().int().min(0).optional(),
    totalUnits: z.number().int().min(1).optional(),
    phase: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.completedUnits !== undefined &&
      value.totalUnits !== undefined &&
      value.completedUnits > value.totalUnits
    ) {
      context.addIssue({
        code: "custom",
        message: "completedUnits cannot exceed totalUnits",
        path: ["completedUnits"],
      });
    }
  });

const workflowDraftSubmissionRequestSchema = z
  .object({
    draft: workflowDraftOutputSchema,
  })
  .strict();

/**
 * True when a socket peer address is a loopback address (IPv4 127.0.0.0/8,
 * IPv6 ::1, or the IPv6-mapped IPv4 form Bun can report for dual-stack
 * sockets). Complements `isLoopbackHost` in cli.ts, which classifies bind
 * hosts (including "localhost") rather than resolved peer addresses.
 */
export function isLoopbackClientAddress(address: string): boolean {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/^::ffff:/u, "");

  return (
    normalized === "localhost" || normalized === "::1" || /^127(\.\d{1,3}){3}$/u.test(normalized)
  );
}

function defaultSetupTokenClientAddress(context: Context): string | null {
  try {
    // With `Bun.serve({ fetch: app.fetch })`, Bun passes its server object as
    // the second fetch argument, which hono/bun reads to call
    // `server.requestIP`. Outside Bun.serve (tests via app.request) this
    // throws and the address is reported as unknown.
    return getConnInfo(context).remote.address ?? null;
  } catch {
    return null;
  }
}

export function createGreenroomApp(options: CreateGreenroomAppOptions): Hono<GreenroomAuthEnv> {
  const app = new Hono<GreenroomAuthEnv>();
  const { services } = options;
  const configFileEnv: GreenroomEnvironment = options.configFileEnv ?? process.env;
  const resolveSetupTokenClientAddress =
    options.setupTokenClientAddress ?? defaultSetupTokenClientAddress;
  const originPolicy = {
    allowedOrigins: new Set(options.allowedOrigins ?? []),
    allowLoopbackOrigins: options.allowLoopbackOrigins ?? true,
  };

  app.onError((error, context) => handleApiError(error, context));
  app.notFound((context) =>
    apiErrorResponse(context, 404, "not_found", `Route ${context.req.path} was not found`),
  );

  app.use("*", async (context, next) => {
    const origin = context.req.header("origin");

    if (origin !== undefined && !isAllowedOrigin(origin, originPolicy)) {
      throw new ApiHttpError(403, "forbidden", "Request origin is not allowed");
    }

    if (origin !== undefined) {
      context.header("Access-Control-Allow-Origin", origin);
      context.header("Vary", "Origin");
    }

    if (context.req.method === "OPTIONS") {
      context.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
      context.header("Access-Control-Allow-Headers", "authorization,content-type");
      context.header("Access-Control-Max-Age", "600");
      return context.body(null, 204);
    }

    await next();
  });

  app.use("*", async (context, next) => {
    context.header("X-Greenroom-API-Version", "1");
    await next();
  });

  app.get("/health", (context) =>
    context.json({
      status: "ok",
      databasePath: services.database.path,
    }),
  );

  app.post("/api/setup/tokens", async (context) => {
    if (options.setupTokenEndpointEnabled === false) {
      throw new ApiHttpError(
        403,
        "forbidden",
        "Unauthenticated setup token creation is disabled because the API is not bound to loopback. " +
          "Pre-provision an admin token with GREENROOM_BOOTSTRAP_ADMIN_TOKEN (or bind the API to 127.0.0.1).",
      );
    }

    // Setup-token minting is no longer restricted to the very first
    // token. The old no-tokens-yet 409 protected non-loopback binds run with
    // `--setup-token-endpoint enabled` from LAN clients minting admin tokens
    // forever after bootstrap; on loopback binds it only blocked local
    // clients who are already the trusted operator (they
    // can read the data dir, run `greenroom token create`, or restart the
    // server). Cross-origin browser abuse (CSRF/DNS rebinding) is blocked by
    // the Origin allowlist middleware above, which rejects any non-loopback
    // Origin before this route runs. So post-bootstrap minting requires the
    // requesting client address itself to be loopback and fails closed when
    // it is unknown; rate limiting is deliberately omitted because loopback
    // clients cross no security boundary here. The first-token path still
    // allows the `--setup-token-endpoint enabled` operator override to
    // bootstrap the initial token from a remote client.
    if (services.tokens.activeCount() > 0) {
      const clientAddress = resolveSetupTokenClientAddress(context);

      if (clientAddress === null || !isLoopbackClientAddress(clientAddress)) {
        throw new ApiHttpError(
          403,
          "forbidden",
          "Setup token creation after the first token is limited to loopback clients. " +
            "Mint a token on the Greenroom machine with `greenroom token create` " +
            "(or pre-provision one with GREENROOM_BOOTSTRAP_ADMIN_TOKEN) and paste it into the app.",
        );
      }
    }

    const input = await parseJsonBody(context, setupTokenCreateRequestSchema);
    return context.json(services.tokens.create(input), 201);
  });

  app.use("/api/*", async (context, next) => {
    await requireBearerAuth(context, services);
    await next();
  });

  app.get("/api/tokens", (context) => {
    requireScope(context, "admin");
    return context.json({ tokens: services.tokens.list() });
  });

  app.post("/api/tokens", async (context) => {
    requireScope(context, "admin");
    const input = await parseJsonBody(context, capabilityTokenCreateInputSchema);
    return context.json(services.tokens.create(input), 201);
  });

  app.post("/api/tokens/:tokenId/revoke", (context) => {
    requireScope(context, "admin");
    const tokenId = parsePathParam(context, "tokenId", tokenIdSchema);
    const token = services.tokens.revoke(tokenId);

    if (token === null) {
      throw new ApiHttpError(404, "not_found", `Token ${tokenId} was not found`);
    }

    return context.json({ token });
  });

  app.get("/api/openapi.json", (context) => {
    requireScope(context, "read");
    return context.json(createOpenApiDocument());
  });

  app.get("/api/config/file", (context) => {
    requireScope(context, "admin");
    return context.json(readConfigFileResource(configFileEnv));
  });

  app.put("/api/config/file", async (context) => {
    requireScope(context, "admin");
    const input = await parseJsonBody(context, configFileUpdateRequestSchema);
    return context.json(writeConfigFileResource(configFileEnv, input.config));
  });

  app.get("/api/runtime/status", async (context) => {
    requireScope(context, "read");
    return context.json(await readRuntimeStatusResource(configFileEnv));
  });

  app.get("/api/harness/status", async (context) => {
    requireScope(context, "read");
    return context.json(await readHarnessStatus(services.harnessClient));
  });

  app.get("/api/harness/models/:kind", async (context) => {
    requireScope(context, "read");
    const kind = parsePathParam(context, "kind", harnessKindPathParamSchema);

    if (services.harnessClient?.models === undefined) {
      throw new ApiHttpError(400, "bad_request", "Harness model discovery is not configured");
    }

    const refresh = context.req.query("refresh");
    return context.json(
      await services.harnessClient.models(kind, { refresh: refresh === "true" || refresh === "1" }),
    );
  });

  app.get("/api/harness/skills/:kind", async (context) => {
    requireScope(context, "read");
    const kind = parsePathParam(context, "kind", harnessKindPathParamSchema);
    return context.json(await readHarnessSkillCheck(kind));
  });

  app.post("/api/harness/skills/:kind/install", async (context) => {
    requireScope(context, "admin");
    const kind = parsePathParam(context, "kind", harnessKindPathParamSchema);
    return context.json(await installHarnessSkillPackage(kind));
  });

  app.post("/api/harness/setup-smoke", async (context) => {
    requireScope(context, "read");
    const input = await parseJsonBody(context, harnessSetupSmokeRequestSchema);
    const response = await createHarnessSetupSmokeResponse(input.kind, {
      harnessClient: services.harnessClient,
    });

    // A passed smoke run marks the currently detected CLI version as
    // verified on the bridge, clearing the version-change re-smoke
    // recommendation.
    if (response.status === "passed" && services.harnessClient?.recordSmoke !== undefined) {
      try {
        await services.harnessClient.recordSmoke(input.kind);
      } catch {
        // Recording the verified version is best-effort; the smoke result
        // itself is still returned.
      }
    }

    return context.json(response);
  });

  app.get("/api/profiles", (context) => {
    requireScope(context, "read");
    return context.json({ profiles: services.profiles.list() });
  });

  app.post("/api/profiles", async (context) => {
    requireScope(context, "admin");
    const input = await parseJsonBody(context, profileCreateInputSchema);
    return context.json({ profile: services.profiles.create(input) }, 201);
  });

  app.get("/api/profiles/:profileId", (context) => {
    requireScope(context, "read");
    const profileId = parsePathParam(context, "profileId", profileIdSchema);
    const profile = services.profiles.get(profileId);

    if (profile === null) {
      throw new ApiHttpError(404, "not_found", `Profile ${profileId} was not found`);
    }

    return context.json({ profile });
  });

  app.post("/api/profiles/:profileId", async (context) => {
    requireScope(context, "admin");
    const profileId = parsePathParam(context, "profileId", profileIdSchema);
    const input = await parseJsonBody(context, profileUpdateInputSchema);
    const profile = services.profiles.update(profileId, input);

    if (profile === null) {
      throw new ApiHttpError(404, "not_found", `Profile ${profileId} was not found`);
    }

    return context.json({ profile });
  });

  app.post("/api/profiles/:profileId/delete", (context) => {
    requireScope(context, "admin");
    const profileId = parsePathParam(context, "profileId", profileIdSchema);
    const profile = services.profiles.delete(profileId);

    if (profile === null) {
      throw new ApiHttpError(404, "not_found", `Profile ${profileId} was not found`);
    }

    return context.json({ profile });
  });

  app.get("/api/repositories", (context) => {
    requireScope(context, "read");
    return context.json({ repositories: services.repositories.list() });
  });

  app.post("/api/repositories", async (context) => {
    requireScope(context, "review:write");
    const input = await parseJsonBody(context, repositoryRegistrationRequestSchema);
    const repository = await registerRepository(services, {
      rootPath: input.rootPath,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.defaultBranchCandidate !== undefined
        ? { defaultBranchCandidate: input.defaultBranchCandidate }
        : {}),
    });
    return context.json({ repository }, 201);
  });

  app.get("/api/repositories/:repositoryId/refs", async (context) => {
    requireScope(context, "read");
    const repositoryId = parsePathParam(context, "repositoryId", repositoryIdSchema);
    const query = parseQuery(context, refsQuerySchema);
    const repository = requireRepository(services, repositoryId);
    const refs =
      query.kind === "branches"
        ? await listBranches(repository.rootPath, gitOptions(services))
        : query.kind === "tags"
          ? await listTags(repository.rootPath, gitOptions(services))
          : await listRefs(repository.rootPath, gitOptions(services));

    return context.json({ refs });
  });

  app.get("/api/repositories/:repositoryId/commits", async (context) => {
    requireScope(context, "read");
    const repositoryId = parsePathParam(context, "repositoryId", repositoryIdSchema);
    const query = parseQuery(context, commitsQuerySchema);
    const repository = requireRepository(services, repositoryId);
    const commits = await listCommits(
      repository.rootPath,
      gitOptions(services, {
        ...(query.baseRef !== undefined ? { baseRef: query.baseRef } : {}),
        ...(query.headRef !== undefined ? { headRef: query.headRef } : {}),
        ...(query.search !== undefined ? { search: query.search } : {}),
        limit: query.limit,
      }),
    );

    return context.json({ commits });
  });

  app.get("/api/repositories/:repositoryId/base-candidates", async (context) => {
    requireScope(context, "read");
    const repositoryId = parsePathParam(context, "repositoryId", repositoryIdSchema);
    const repository = requireRepository(services, repositoryId);
    const candidates = await detectDefaultBranchCandidates(
      repository.rootPath,
      gitOptions(services),
    );

    return context.json({ candidates });
  });

  app.post("/api/reviews", async (context) => {
    requireScope(context, "review:write");
    const token = context.get("greenroomToken");
    const input = await parseJsonBody(context, committedReviewCreateRequestSchema);
    const created = await createCommittedReview(services, {
      repositoryId: input.repositoryId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.baseRef !== undefined ? { baseRef: input.baseRef } : {}),
      ...(input.headRef !== undefined ? { headRef: input.headRef } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.comparisonMode !== undefined ? { comparisonMode: input.comparisonMode } : {}),
      createdBy: { kind: "api_token", tokenId: token.id, tokenName: token.name },
    });
    return context.json({ ...created, review: apiReview(created.review) }, 201);
  });

  app.post("/api/reviews/preview", async (context) => {
    requireScope(context, "read");
    const input = await parseJsonBody(context, committedReviewCreateRequestSchema);
    const preview = await previewCommittedReview(services, {
      repositoryId: input.repositoryId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.baseRef !== undefined ? { baseRef: input.baseRef } : {}),
      ...(input.headRef !== undefined ? { headRef: input.headRef } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.comparisonMode !== undefined ? { comparisonMode: input.comparisonMode } : {}),
    });
    return context.json(preview);
  });

  app.get("/api/reviews", (context) => {
    requireScope(context, "read");
    const query = parseQuery(context, reviewListQuerySchema);
    const reviews = services.reviews
      .list(query.state)
      .map((review) => readReviewResource(services, review));

    return context.json({ reviews });
  });

  app.get("/api/reviews/:reviewId", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    return context.json(readReviewResource(services, review));
  });

  app.get("/api/reviews/:reviewId/diff", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const revision = requireCurrentRevision(services, review);
    const requestedPath = context.req.query("path");
    const path = requestedPath === undefined ? undefined : relativePathSchema.parse(requestedPath);
    const files =
      path === undefined
        ? services.reviews.listDiffFiles(revision.id)
        : readRevisionDiffResource(services, reviewReference, revision.id, path).files;

    return context.json({ review: apiReview(review), revision, files });
  });

  app.get("/api/reviews/:reviewId/revisions", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    return context.json({ revisions: services.reviews.listRevisions(review.id) });
  });

  app.get("/api/reviews/:reviewId/revisions/:revisionId", (context) => {
    requireScope(context, "read");
    const reviewId = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const revisionId = parsePathParam(context, "revisionId", revisionIdSchema);
    const requestedPath = context.req.query("path");
    const path = requestedPath === undefined ? undefined : relativePathSchema.parse(requestedPath);
    return context.json(readRevisionDiffResource(services, reviewId, revisionId, path));
  });

  app.get("/api/reviews/:reviewId/workflow-runs", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    return context.json({ runs: services.workflowRunner.listRunsByReview(review.id) });
  });

  app.post("/api/reviews/:reviewId/workflow-runs", async (context) => {
    requireScope(context, "review:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const input = await parseJsonBody(context, workflowRunCreateRequestSchema);
    return context.json(
      {
        run: createWorkflowRunForReview(services, {
          reviewDisplayId: review.displayId,
          workflowKind: input.workflowKind,
          profileId: input.profileId,
          ...(input.revisionId !== undefined ? { revisionId: input.revisionId } : {}),
          ...(input.harnessKind !== undefined ? { harnessKind: input.harnessKind } : {}),
          ...(input.scopeLabel !== undefined ? { scopeLabel: input.scopeLabel } : {}),
          ...(input.allowedMcpCapabilities !== undefined
            ? { allowedMcpCapabilities: input.allowedMcpCapabilities }
            : {}),
          ...(input.expectedOutputMode !== undefined
            ? { expectedOutputMode: input.expectedOutputMode }
            : {}),
          ...(input.idleTimeoutMs !== undefined ? { idleTimeoutMs: input.idleTimeoutMs } : {}),
          ...(input.absoluteTimeoutMs !== undefined
            ? { absoluteTimeoutMs: input.absoluteTimeoutMs }
            : {}),
          ...(input.metadata !== undefined ? { clientMetadata: input.metadata } : {}),
        }),
      },
      201,
    );
  });

  app.get("/api/workflow-runs", (context) => {
    requireScope(context, "read");
    parseQuery(context, workflowRunListQuerySchema);
    return context.json({ runs: services.workflowRunner.listActiveRuns() });
  });

  app.get("/api/workflow-runs/:runId", (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    return context.json({
      run: requireWorkflowRun(services, runId),
      transcripts: services.transcripts.listMetadataByRun(runId),
    });
  });

  app.get("/api/workflow-runs/:runId/transcripts", (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    requireWorkflowRun(services, runId);
    return context.json({ transcripts: services.transcripts.listByRun(runId) });
  });

  app.get("/api/workflow-runs/:runId/diagnostics", (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    const run = requireWorkflowRun(services, runId);
    const review = services.reviews.getByDisplayId(run.reviewDisplayId);

    return context.json({
      diagnostics: deriveWorkflowRunDiagnostics({
        run,
        events: services.workflowRunner.listEvents(runId),
        transcripts: services.transcripts.listByRun(runId),
        currentRevisionId: review?.currentRevisionId ?? null,
      }),
    });
  });

  app.post("/api/workflow-transcripts/purge", (context) => {
    requireScope(context, "admin");
    return context.json({ deletedCount: services.transcripts.purgeAll() });
  });

  app.get("/api/workflow-runs/:runId/events", (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    requireWorkflowRun(services, runId);

    const url = new URL(context.req.url);

    if (url.searchParams.get("stream") === "1") {
      return streamWorkflowRunHarnessEvents(services, runId, readCursor(url));
    }

    if (url.searchParams.has("since")) {
      return context.json(listWorkflowRunHarnessEvents(services, runId, readCursor(url)));
    }

    return context.json({ events: services.workflowRunner.listEvents(runId) });
  });

  app.post("/api/workflow-runs/:runId/approve", (context) => {
    requireScope(context, "review:write");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    requireWorkflowRun(services, runId);
    return context.json({ run: services.workflowRunner.approveRun(runId) });
  });

  app.post("/api/workflow-runs/:runId/cancel", async (context) => {
    requireScope(context, "review:write");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    requireWorkflowRun(services, runId);
    const input = await parseJsonBody(context, workflowRunCancelRequestSchema);
    return context.json({
      run: services.workflowRunner.cancelRun(runId, input.reason),
    });
  });

  app.post("/api/workflow-runs/:runId/retry", (context) => {
    requireScope(context, "review:write");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    requireWorkflowRun(services, runId);
    return context.json({ run: services.workflowRunner.retryRun(runId) }, 201);
  });

  app.post("/api/workflow-runs/:runId/recover-fingerprint", async (context) => {
    requireScope(context, "review:write");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    return context.json(await recoverWorkflowRunFromFingerprintChange(services, runId), 201);
  });

  app.post("/api/workflow-runs/:runId/draft", async (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    const run = requireWorkflowRun(services, runId);
    requireWorkflowDraftActor(context, run);
    const input = await parseJsonBody(context, workflowDraftSubmissionRequestSchema);
    return context.json(await services.workflowRunner.submitDraft(runId, input.draft));
  });

  app.post("/api/workflow-runs/:runId/progress", async (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", workflowRunIdSchema);
    const run = requireWorkflowRun(services, runId);
    requireWorkflowDraftActor(context, run);
    const input = await parseJsonBody(context, workflowRunProgressRequestSchema);
    return context.json({
      event: services.workflowRunner.reportProgress({
        runId,
        message: input.message,
        ...(input.completedUnits === undefined ? {} : { completedUnits: input.completedUnits }),
        ...(input.totalUnits === undefined ? {} : { totalUnits: input.totalUnits }),
        ...(input.phase === undefined ? {} : { phase: input.phase }),
      }),
    });
  });

  app.post("/api/reviews/:reviewId/refresh", async (context) => {
    requireScope(context, "review:write");
    const reviewId = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const refreshed = await refreshReview(services, reviewId);
    return context.json(
      { ...refreshed, review: apiReview(refreshed.review) },
      refreshed.reused ? 200 : 201,
    );
  });

  app.get("/api/reviews/:reviewId/worktree-status", async (context) => {
    requireScope(context, "read");
    const reviewId = parsePathParam(context, "reviewId", reviewReferenceSchema);
    return context.json(await readReviewWorktreeStatus(services, reviewId));
  });

  app.post("/api/reviews/:reviewId/close", (context) => {
    requireScope(context, "review:write");
    return transitionReviewByRef(context, services, "closed");
  });

  app.post("/api/reviews/:reviewId/reopen", (context) => {
    requireScope(context, "review:write");
    return transitionReviewByRef(context, services, "open");
  });

  app.get("/api/reviews/:reviewId/spotlight/views", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    return context.json({ views: listSpotlightViews(services, review.displayId) });
  });

  app.get("/api/spotlight/views/:viewRef", (context) => {
    requireScope(context, "read");
    const viewRef = parsePathParam(context, "viewRef", spotlightViewReferenceSchema);
    return context.json({ view: readSpotlightView(services, viewRef) });
  });

  app.get("/api/spotlight/views/:viewRef/diff", (context) => {
    requireScope(context, "read");
    const viewRef = parsePathParam(context, "viewRef", spotlightViewReferenceSchema);
    return context.json(readSpotlightViewDiff(services, viewRef));
  });

  app.get("/api/reviews/:reviewId/spotlight/coverage", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    return context.json(readSpotlightCoverage(services, review.displayId));
  });

  app.get("/api/reviews/:reviewId/spotlight/line-membership", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    return context.json(readSpotlightLineMembership(services, review.displayId));
  });

  app.post("/api/reviews/:reviewId/spotlight/runs", async (context) => {
    requireScope(context, "review:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const input = await parseJsonBody(context, spotlightRunRequestSchema);
    return context.json({ run: await createSpotlightRun(services, review.displayId, input) }, 201);
  });

  app.get("/api/reviews/:reviewId/spotlight/runs/:runId", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const runId = parsePathParam(context, "runId", spotlightRunIdSchema);
    return context.json({ run: readSpotlightRun(services, review.displayId, runId) });
  });

  app.post("/api/reviews/:reviewId/spotlight/runs/:runId/approve-context", async (context) => {
    requireScope(context, "review:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const runId = parsePathParam(context, "runId", spotlightRunIdSchema);
    return context.json({
      run: await approveSpotlightRunContext(services, review.displayId, runId),
    });
  });

  app.post("/api/reviews/:reviewId/spotlight/runs/:runId/refine", async (context) => {
    requireScope(context, "review:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const runId = parsePathParam(context, "runId", spotlightRunIdSchema);
    const input = await parseJsonBody(context, spotlightPlanRefineRequestSchema);
    return context.json({
      run: await refineSpotlightRunPlan(services, review.displayId, runId, input.instruction),
    });
  });

  app.post("/api/reviews/:reviewId/spotlight/runs/:runId/approve-plan", async (context) => {
    requireScope(context, "review:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const runId = parsePathParam(context, "runId", spotlightRunIdSchema);
    const input = await parseJsonBody(context, spotlightPlanApprovalRequestSchema);
    return context.json({
      run: await approveSpotlightRunPlan(services, review.displayId, runId, input.approvedOutline),
    });
  });

  app.post("/api/reviews/:reviewId/handoff", async (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const input = await parseJsonBody(context, handoffRequestSchema);

    if (input.reviewDisplayId !== review.displayId) {
      throw new ApiHttpError(
        400,
        "bad_request",
        "Handoff reviewDisplayId must match the route reviewId",
      );
    }

    return context.json({ handoff: createHandoffBundle(services, input) });
  });

  app.post("/api/reviews/:reviewId/teaching/consent", async (context) => {
    requireScope(context, "review:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const input = await parseJsonBody(context, teachingConsentCreateInputSchema);
    return context.json(
      {
        run: await createTeachingConsent(services, { ...input, reviewDisplayId: review.displayId }),
      },
      201,
    );
  });

  app.post("/api/reviews/:reviewId/teaching/promote", async (context) => {
    requireScope(context, "comment:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const input = await parseJsonBody(context, teachingPromotionInputSchema);
    return context.json({ thread: promoteTeachingPoint(services, review.displayId, input) }, 201);
  });

  app.post("/api/reviews/:reviewId/builtin-review/consent", async (context) => {
    requireScope(context, "review:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    const input = await parseJsonBody(context, builtinReviewConsentCreateInputSchema);
    return context.json(
      {
        run: await createBuiltinReviewConsent(services, {
          ...input,
          reviewDisplayId: review.displayId,
        }),
      },
      201,
    );
  });

  app.get("/api/builtin-review/runs/:runId", (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", builtinReviewRunIdSchema);
    return context.json({ run: readBuiltinReviewRun(services, runId) });
  });

  app.post("/api/builtin-review/runs/:runId/approve", async (context) => {
    requireScope(context, "comment:write");
    const runId = parsePathParam(context, "runId", builtinReviewRunIdSchema);
    return context.json({ run: await approveBuiltinReviewRun(services, runId) });
  });

  app.post("/api/builtin-review/runs/:runId/approve-draft", (context) => {
    requireScope(context, "comment:write");
    const runId = parsePathParam(context, "runId", builtinReviewRunIdSchema);
    return context.json({ run: approveBuiltinReviewDraft(services, runId) });
  });

  app.get("/api/teaching/runs/:runId", (context) => {
    requireScope(context, "read");
    const runId = parsePathParam(context, "runId", teachingRunIdSchema);
    return context.json({ run: readTeachingRun(services, runId) });
  });

  app.post("/api/teaching/runs/:runId/approve", async (context) => {
    requireScope(context, "review:write");
    const runId = parsePathParam(context, "runId", teachingRunIdSchema);
    return context.json({ run: await approveTeachingRun(services, runId) });
  });

  app.post("/api/teaching/runs/:runId/follow-up", async (context) => {
    requireScope(context, "review:write");
    const runId = parsePathParam(context, "runId", teachingRunIdSchema);
    const input = await parseJsonBody(context, teachingFollowUpRequestSchema);
    return context.json({
      followUp: await answerTeachingFollowUp(services, runId, input.question),
    });
  });

  app.post("/api/agent-events", async (context) => {
    requireScope(context, "comment:write");
    const input = await parseJsonBody(context, agentEventCreateInputSchema);
    return context.json({ event: recordAgentEvent(services, input) }, 201);
  });

  app.post("/api/reviews/:reviewId/threads", async (context) => {
    requireScope(context, "comment:write");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);

    const input = await parseJsonBody(context, threadCreateInputSchema);

    if (input.reviewDisplayId !== review.displayId) {
      throw new ApiHttpError(
        400,
        "bad_request",
        "Thread reviewDisplayId must match the route reviewId",
      );
    }

    assertAnchorsTargetChangedLines(services, [input.anchor, ...(input.anchors ?? [])]);
    const thread = services.threads.create(input);
    return context.json({ thread }, 201);
  });

  app.get("/api/reviews/:reviewId/threads", (context) => {
    requireScope(context, "read");
    const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
    const review = requireReview(services, reviewReference);
    return context.json({ threads: services.threads.listByReview(review.id) });
  });

  app.get("/api/threads/:threadRef", (context) => {
    requireScope(context, "read");
    const threadRef = parsePathParam(context, "threadRef", threadReferenceSchema);
    const thread = requireThreadByRef(services, threadRef);
    return context.json({ thread });
  });

  app.post("/api/threads/:threadRef/comments", async (context) => {
    requireScope(context, "comment:write");
    const threadRef = parsePathParam(context, "threadRef", threadReferenceSchema);
    const thread = requireThreadByRef(services, threadRef);
    const input = await parseJsonBody(context, threadReplyRequestSchema);

    if (
      input.parentCommentId !== undefined &&
      input.parentCommentId !== null &&
      !thread.comments.some((comment) => comment.id === input.parentCommentId)
    ) {
      throw new ApiHttpError(400, "bad_request", "Parent comment must belong to the target thread");
    }

    const comment = services.threads.addComment({ ...input, threadRef: thread.shortRef });
    return context.json({ comment }, 201);
  });

  app.post("/api/threads/:threadRef/resolve", (context) => {
    requireScope(context, "thread:resolve");
    return transitionThreadByRef(context, services, "resolved");
  });

  app.post("/api/threads/:threadRef/dismiss", (context) => {
    requireScope(context, "thread:resolve");
    return transitionThreadByRef(context, services, "dismissed");
  });

  app.post("/api/threads/:threadRef/reopen", (context) => {
    requireScope(context, "thread:resolve");
    return transitionThreadByRef(context, services, "open");
  });

  const webDistDir = options.webDistDir?.trim();

  if (webDistDir !== undefined && webDistDir.length > 0) {
    // Catch-all SPA handler; must be registered after every API route.
    const serveStaticWeb = createStaticWebHandler(webDistDir);
    app.get("*", (context) => serveStaticWeb(context));
  }

  return app;
}

function requireWorkflowRun(
  services: GreenroomApiServices,
  runId: z.infer<typeof workflowRunIdSchema>,
): WorkflowRun {
  const run = services.workflowRunner.readRun(runId);

  if (run === null) {
    throw new ApiHttpError(404, "not_found", `Workflow run ${runId} was not found`);
  }

  return run;
}

function listWorkflowRunHarnessEvents(
  services: GreenroomApiServices,
  runId: z.infer<typeof workflowRunIdSchema>,
  since: number,
): { events: unknown[]; nextCursor: number; terminal: boolean } {
  const run = requireWorkflowRun(services, runId);
  const events = services.transcripts
    .listEventsByRun(runId)
    .map((row) => row.event)
    .filter((event) => event.sequence > since);
  const nextCursor = events.reduce((cursor, event) => Math.max(cursor, event.sequence), since);

  return {
    events,
    nextCursor,
    terminal: run.status === "completed" || run.status === "failed" || run.status === "cancelled",
  };
}

function streamWorkflowRunHarnessEvents(
  services: GreenroomApiServices,
  runId: z.infer<typeof workflowRunIdSchema>,
  since: number,
): Response {
  let cursor = since;
  let interval: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        if (closed) {
          return;
        }

        const payload = listWorkflowRunHarnessEvents(services, runId, cursor);

        for (const event of payload.events) {
          if (
            typeof event === "object" &&
            event !== null &&
            "sequence" in event &&
            typeof event.sequence === "number"
          ) {
            cursor = event.sequence;
            controller.enqueue(encoder.encode(`id: ${event.sequence}\n`));
            controller.enqueue(encoder.encode("event: harness\n"));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        }

        if (payload.terminal && cursor >= payload.nextCursor) {
          closed = true;

          if (interval !== null) {
            clearInterval(interval);
          }

          controller.close();
        }
      };

      send();
      if (!closed) {
        interval = setInterval(send, 1000);
      }
    },
    cancel() {
      if (interval !== null) {
        clearInterval(interval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function readCursor(url: URL): number {
  const parsed = Number(url.searchParams.get("since") ?? "0");
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function requireWorkflowDraftActor(context: Context<GreenroomAuthEnv>, run: WorkflowRun): void {
  const token = context.get("greenroomToken");
  const grantId = typeof run.metadata.mcpGrantId === "string" ? run.metadata.mcpGrantId : null;

  if (token.id === grantId || hasScope(token, "review:write") || hasScope(token, "comment:write")) {
    return;
  }

  throw new ApiHttpError(
    403,
    "forbidden",
    "Draft submission requires the run-scoped MCP grant or workflow write authority",
  );
}

function requireThreadByRef(
  services: GreenroomApiServices,
  threadRef: z.infer<typeof threadReferenceSchema>,
) {
  const thread = services.threads.getByRef(threadRef);

  if (thread === null) {
    throw new ApiHttpError(404, "not_found", `Thread ${threadRef} was not found`);
  }

  return thread;
}

function transitionReviewByRef(
  context: Context<GreenroomAuthEnv>,
  services: GreenroomApiServices,
  status: z.infer<typeof reviewStatusSchema>,
): Response {
  const reviewReference = parsePathParam(context, "reviewId", reviewReferenceSchema);
  const review = requireReview(services, reviewReference);
  const transitioned = services.reviews.update(review.id, { status });

  if (transitioned === null) {
    throw new ApiHttpError(404, "not_found", `Review ${reviewReference} was not found`);
  }

  return context.json(readReviewResource(services, transitioned));
}

function transitionThreadByRef(
  context: Context<GreenroomAuthEnv>,
  services: GreenroomApiServices,
  status: z.infer<typeof threadStatusSchema>,
): Response {
  const threadRef = parsePathParam(context, "threadRef", threadReferenceSchema);
  const thread = requireThreadByRef(services, threadRef);
  const transitioned = services.threads.transitionStatus(thread.shortRef, status);

  if (transitioned === null) {
    throw new ApiHttpError(404, "not_found", `Thread ${threadRef} was not found`);
  }

  const refreshed = services.threads.getByRef(thread.shortRef);
  return context.json({ thread: refreshed ?? transitioned });
}

interface OriginPolicy {
  allowedOrigins: ReadonlySet<string>;
  allowLoopbackOrigins: boolean;
}

function isAllowedOrigin(origin: string, policy: OriginPolicy): boolean {
  if (policy.allowedOrigins.has(origin)) {
    return true;
  }

  if (!policy.allowLoopbackOrigins) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname === "[::1]")
    );
  } catch {
    return false;
  }
}
