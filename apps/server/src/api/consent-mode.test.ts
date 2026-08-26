import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import type {
  HarnessRunRequest,
  HarnessRunResponse,
  ProfileConsentMode,
  WorkflowRun,
  WorkflowRunId,
} from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices, type GreenroomApiServiceOptions } from "./services";

const fixedNow = "2026-06-25T12:00:00.000Z";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function createFixture(options: Omit<GreenroomApiServiceOptions, "domain"> = {}) {
  const storage = createTestStorage({
    clock: () => fixedNow,
    idFactory: deterministicIds(),
    defaultAiBackend: "mock",
  });
  storages.push(storage);
  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    ...options,
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
    autoResumeQueuedWorkflowRuns: false,
  });
  const app = createGreenroomApp({ services });
  const admin = services.tokens.create({ name: "Consent mode admin", scopes: ["admin"] });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${admin.plaintextToken}`);
    return app.request(path, { ...init, headers });
  };
  const repository = services.repositories.create({
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
  });
  const { review, revision } = services.reviews.createWithInitialRevision({
    review: {
      repositoryId: repository.id,
      title: "Consent mode review",
      range: {
        kind: "branch_to_branch",
        baseRef: { kind: "branch", value: "main" },
        headRef: { kind: "branch", value: "feature/consent" },
      },
      baseRefDisplay: "main",
      headRefDisplay: "feature/consent",
    },
    revision: {
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diffSummary: {
        fileCount: 1,
        additions: 1,
        deletions: 0,
        binaryFileCount: 0,
        renameCount: 0,
      },
    },
    diffFiles: [
      {
        path: "src/index.ts",
        oldPath: null,
        status: "modified",
        isBinary: false,
        additions: 1,
        deletions: 0,
        oldMode: null,
        newMode: null,
        renameMetadata: null,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            header: "@@ -1,1 +1,2 @@",
            sortOrder: 1,
            lines: [
              {
                type: "context",
                oldLineNumber: 1,
                newLineNumber: 1,
                content: "export const value = 1;",
              },
              {
                type: "addition",
                oldLineNumber: null,
                newLineNumber: 2,
                content: "export const next = 2;",
              },
            ],
          },
        ],
      },
    ],
  });

  return { services, request, review, revision };
}

function completedHarnessResponse(request: HarnessRunRequest, output: unknown): HarnessRunResponse {
  return {
    workflow: request.workflow,
    runId: request.runId,
    status: "completed",
    output,
    execution: {
      command: "fake-harness",
      exitCode: 0,
      durationMs: 1,
      stderrTail: "",
      timeoutMs: null,
      timeoutBudgetMs: null,
      timeoutClamped: false,
      timedOut: false,
      repositoryAccessMode: "mcp_only",
      repositoryWorkspaceStrategy: null,
      workspaceSetupStatus: "not_required",
      workspaceCleanupStatus: "not_required",
      workspaceErrorMessage: null,
      repositoryChanged: false,
      repositoryFingerprintBefore: null,
      repositoryFingerprintAfter: null,
      outputCapture: "structured_stdout",
    },
  };
}

function teachingProfileInput(name: string, consentMode?: ProfileConsentMode) {
  return {
    name,
    workflowType: "teaching" as const,
    provider: "mock" as const,
    model: "mock-teacher",
    modelSettings: {},
    allowedTools: [],
    contextPreferences: {},
    privacy: {
      persistTranscript: false,
      ...(consentMode === undefined ? {} : { consentMode }),
    },
  };
}

function spotlightProfileInput(name: string, consentMode: ProfileConsentMode) {
  return {
    name,
    workflowType: "spotlight" as const,
    provider: "mock" as const,
    model: "mock-spotlight",
    modelSettings: {},
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode },
  };
}

function builtinReviewProfileInput(name: string, consentMode: ProfileConsentMode) {
  return {
    name,
    workflowType: "builtin_review" as const,
    provider: "harness" as const,
    model: "claude-code",
    modelSettings: { harness: { kind: "claude-code" } },
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode },
  };
}

function expectApprovedScopeMatchesConsent(run: WorkflowRun, consentMode: ProfileConsentMode) {
  expect(run.approvedScope).not.toBeNull();
  expect(run.approvedScope).toMatchObject({
    label: run.consentSummary.scopeLabel,
    revisionId: run.consentSummary.revisionId,
    changedFiles: run.consentSummary.changedFiles,
  });
  expect(run.metadata.consentMode).toBe(consentMode);
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

async function waitForResult<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  description: string,
): Promise<T> {
  let latest: T;

  for (let poll = 0; poll < 100; poll += 1) {
    latest = read();

    if (predicate(latest)) {
      return latest;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

const storages: TestStorage[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }
});

describe("one-click consent", () => {
  it("runs a teaching run from a single consent request and records the approved scope", async () => {
    const { services, request, review, revision } = createFixture();
    // Profiles default to one-click consent when no consentMode is stored.
    const profile = services.profiles.create(teachingProfileInput("One-click teaching"));
    expect(profile.privacy.consentMode).toBe("one_click");

    const response = await request(`/api/reviews/${review.displayId}/teaching/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        revisionId: revision.id,
        scope: { kind: "full_pr" },
        start: true,
      }),
    });
    const payload = (await json(response)) as {
      run: { id: string; status: string; output: unknown };
    };

    expect(response.status).toBe(201);
    expect(payload.run.status).toBe("approved");

    const workflowRun = await waitForResult(
      () => services.workflowRunner.readRun(payload.run.id as WorkflowRunId),
      (run) => run?.status === "completed",
      "one-click teaching completion",
    );
    expect(workflowRun).not.toBeNull();
    expect(workflowRun).toMatchObject({
      workflowKind: "teaching_generate",
      status: "completed",
      consentSummary: { revisionId: revision.id },
    });
    expectApprovedScopeMatchesConsent(workflowRun!, "one_click");
  });

  it("enforces two-step consent for teaching profiles that opt in", async () => {
    const { services, request, review, revision } = createFixture();
    const profile = services.profiles.create(teachingProfileInput("Two-step teaching", "two_step"));

    const rejected = await request(`/api/reviews/${review.displayId}/teaching/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        revisionId: revision.id,
        scope: { kind: "full_pr" },
        start: true,
      }),
    });

    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toMatchObject({
      error: { code: "conflict", message: expect.stringContaining("two-step consent") },
    });
    expect(services.workflowRunner.listRunsByReview(review.id)).toHaveLength(0);

    const created = await request(`/api/reviews/${review.displayId}/teaching/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        revisionId: revision.id,
        scope: { kind: "full_pr" },
      }),
    });
    const createdPayload = (await json(created)) as { run: { id: string; status: string } };

    expect(created.status).toBe(201);
    expect(createdPayload.run.status).toBe("pending_consent");

    const pendingWorkflowRun = services.workflowRunner.readRun(
      createdPayload.run.id as WorkflowRunId,
    );
    expect(pendingWorkflowRun?.approvedScope).toBeNull();

    const approved = await request(`/api/teaching/runs/${createdPayload.run.id}/approve`, {
      method: "POST",
    });
    const approvedPayload = (await json(approved)) as { run: { status: string } };

    expect(approved.status).toBe(200);
    expect(approvedPayload.run.status).toBe("approved");

    const workflowRun = await waitForResult(
      () => services.workflowRunner.readRun(createdPayload.run.id as WorkflowRunId),
      (run) => run?.status === "completed",
      "two-step teaching completion",
    );
    expectApprovedScopeMatchesConsent(workflowRun!, "two_step");
  });

  it("runs one-click Spotlight generation and enforces two-step Spotlight profiles", async () => {
    const { services, request, review, revision } = createFixture();
    const oneClickProfile = services.profiles.create(
      spotlightProfileInput("One-click spotlight", "one_click"),
    );

    const response = await request(`/api/reviews/${review.displayId}/spotlight/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "generate",
        trigger: "manual",
        gated: false,
        revisionId: revision.id,
        profileId: oneClickProfile.id,
        start: true,
      }),
    });
    const payload = (await json(response)) as { run: { id: string; status: string } };

    expect(response.status).toBe(201);
    expect(payload.run.status).toBe("planning");
    await waitForResult(
      () => services.spotlight.getRun(payload.run.id as never),
      (run) => run?.status === "completed",
      "one-click Spotlight completion",
    );

    const workflowRuns = services.workflowRunner
      .listRunsByReview(review.id)
      .filter((run) => run.metadata.spotlightRunId === payload.run.id);
    expect(workflowRuns.length).toBeGreaterThan(0);

    for (const workflowRun of workflowRuns) {
      expect(workflowRun.approvedScope).not.toBeNull();
      expect(workflowRun.approvedScope).toMatchObject({
        label: workflowRun.consentSummary.scopeLabel,
        revisionId: workflowRun.consentSummary.revisionId,
        changedFiles: workflowRun.consentSummary.changedFiles,
      });
    }

    const planRun = workflowRuns.find((run) => run.workflowKind === "spotlight_plan");
    expect(planRun?.metadata.consentMode).toBe("one_click");

    const views = await request(`/api/reviews/${review.displayId}/spotlight/views`);
    const viewsPayload = (await json(views)) as { views: unknown[] };
    expect(viewsPayload.views.length).toBeGreaterThan(0);

    const twoStepProfile = services.profiles.create(
      spotlightProfileInput("Two-step spotlight", "two_step"),
    );
    const rejected = await request(`/api/reviews/${review.displayId}/spotlight/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "generate",
        trigger: "manual",
        gated: false,
        revisionId: revision.id,
        profileId: twoStepProfile.id,
        start: true,
      }),
    });

    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toMatchObject({
      error: { code: "conflict", message: expect.stringContaining("two-step consent") },
    });
  });

  it("runs one-click built-in review to draft approval and enforces two-step profiles", async () => {
    const harnessCalls: HarnessRunRequest[] = [];
    let anchorKey = "";
    const { services, request, review, revision } = createFixture({
      harnessClient: {
        async run(harnessRequest) {
          harnessCalls.push(harnessRequest);
          return completedHarnessResponse(harnessRequest, {
            kind: "builtin_review_findings",
            summary: "Harness one-click review summary.",
            findings: [
              {
                id: "finding-1",
                title: "Check the added constant",
                body: "The added constant should be reviewed with its callers.",
                type: "issue",
                severity: "minor",
                anchorKey,
                confidence: 0.8,
              },
            ],
            nonFindings: ["Nothing else actionable in the changed lines."],
          });
        },
      },
    });
    // Anchor key format mirrors the changed-line anchors the workflow validates against.
    anchorKey = [review.displayId, revision.id, "src/index.ts", "", "head", "addition", 2].join(
      ":",
    );
    const profile = services.profiles.create(
      builtinReviewProfileInput("One-click reviewer", "one_click"),
    );

    const response = await request(`/api/reviews/${review.displayId}/builtin-review/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        revisionId: revision.id,
        start: true,
      }),
    });
    const payload = (await json(response)) as {
      run: { id: string; status: string; approvedAt: string | null };
    };

    expect(response.status).toBe(201);
    await waitForResult(
      () => harnessCalls.length,
      (count) => count === 1,
      "one-click built-in review harness call",
    );
    // Draft approval before thread creation stays gated even in one-click mode.
    expect(payload.run.status).toBe("approved");
    expect(payload.run.approvedAt).not.toBeNull();
    expect(services.threads.listByReview(review.id)).toHaveLength(0);

    const workflowRun = await waitForResult(
      () => services.workflowRunner.readRun(payload.run.id as WorkflowRunId),
      (run) => run?.status === "awaiting_user",
      "one-click built-in review draft approval",
    );
    expect(workflowRun).toMatchObject({
      workflowKind: "builtin_review",
      status: "awaiting_user",
      consentSummary: { threadCreationGate: { mode: "draft_approval_required" } },
    });
    expectApprovedScopeMatchesConsent(workflowRun!, "one_click");

    const twoStepProfile = services.profiles.create(
      builtinReviewProfileInput("Two-step reviewer", "two_step"),
    );
    const rejected = await request(`/api/reviews/${review.displayId}/builtin-review/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: twoStepProfile.id,
        revisionId: revision.id,
        start: true,
      }),
    });

    expect(rejected.status).toBe(409);
    expect(await json(rejected)).toMatchObject({
      error: { code: "conflict", message: expect.stringContaining("two-step consent") },
    });
    expect(harnessCalls).toHaveLength(1);
  });
});

describe("trusted consent", () => {
  it("auto-creates threads from validated findings for trusted built-in review profiles", async () => {
    const harnessCalls: HarnessRunRequest[] = [];
    let anchorKey = "";
    const { services, request, review, revision } = createFixture({
      harnessClient: {
        async run(harnessRequest) {
          harnessCalls.push(harnessRequest);
          return completedHarnessResponse(harnessRequest, {
            kind: "builtin_review_findings",
            summary: "Trusted review summary.",
            findings: [
              {
                id: "finding-1",
                title: "Check the added constant",
                body: "The added constant should be reviewed with its callers.",
                type: "issue",
                severity: "minor",
                anchorKey,
                confidence: 0.9,
              },
            ],
            nonFindings: [],
          });
        },
      },
    });
    anchorKey = [review.displayId, revision.id, "src/index.ts", "", "head", "addition", 2].join(
      ":",
    );
    const profile = services.profiles.create(
      builtinReviewProfileInput("Trusted reviewer", "trusted"),
    );

    // No start flag: trusted profiles start immediately server-side, so the
    // skip is a server-accepted mode rather than a UI shortcut.
    const response = await request(`/api/reviews/${review.displayId}/builtin-review/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        revisionId: revision.id,
      }),
    });
    const payload = (await json(response)) as {
      run: { id: string; status: string; createdThreadRefs: string[] };
    };

    expect(response.status).toBe(201);
    expect(payload.run.status).toBe("approved");
    await waitForResult(
      () => harnessCalls.length,
      (count) => count === 1,
      "trusted built-in review harness call",
    );
    const completedWorkflow = await waitForResult(
      () => services.workflowRunner.readRun(payload.run.id as WorkflowRunId),
      (run) => run?.status === "completed",
      "trusted built-in review completion",
    );

    const threads = services.threads.listByReview(review.id);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.anchor).toMatchObject({ filePath: "src/index.ts", lineNumber: 2 });

    expect(completedWorkflow).toMatchObject({
      workflowKind: "builtin_review",
      status: "completed",
      consentSummary: { threadCreationGate: { mode: "auto_create_after_validation" } },
      metadata: {
        threadCreationGateMode: "auto_create_after_validation",
        createdThreadCount: 1,
        validatedFindingCount: 1,
      },
    });
    // Trusted mode reduces clicks, not records: scope is recorded as usual.
    expectApprovedScopeMatchesConsent(completedWorkflow!, "trusted");
  });

  it("never creates threads from invalid findings, even for trusted profiles", async () => {
    const harnessCalls: HarnessRunRequest[] = [];
    const { services, request, review, revision } = createFixture({
      harnessClient: {
        async run(harnessRequest) {
          harnessCalls.push(harnessRequest);
          return completedHarnessResponse(harnessRequest, {
            kind: "builtin_review_findings",
            summary: "Trusted review with an invalid anchor.",
            findings: [
              {
                id: "finding-bad",
                title: "Points nowhere",
                body: "This finding references an anchor outside the diff.",
                type: "issue",
                severity: "minor",
                anchorKey: "not:a:real:anchor:key",
                confidence: 0.9,
              },
            ],
            nonFindings: [],
          });
        },
      },
    });
    const profile = services.profiles.create(
      builtinReviewProfileInput("Trusted invalid reviewer", "trusted"),
    );

    const response = await request(`/api/reviews/${review.displayId}/builtin-review/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        revisionId: revision.id,
        start: true,
      }),
    });

    expect(response.status).toBe(201);
    await waitForResult(
      () => harnessCalls.length,
      (count) => count > 1,
      "trusted invalid built-in review repair attempts",
    );
    await waitForResult(
      () => services.workflowRunner.listRunsByReview(review.id)[0],
      (run) => run?.status === "failed",
      "trusted invalid built-in review failure",
    );
    expect(services.threads.listByReview(review.id)).toHaveLength(0);

    const workflowRuns = services.workflowRunner.listRunsByReview(review.id);
    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]?.status).toBe("failed");
  });

  it("starts trusted teaching runs immediately without the two-step path", async () => {
    const { services, request, review, revision } = createFixture();
    const profile = services.profiles.create(teachingProfileInput("Trusted teaching", "trusted"));

    const response = await request(`/api/reviews/${review.displayId}/teaching/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        revisionId: revision.id,
        scope: { kind: "full_pr" },
      }),
    });
    const payload = (await json(response)) as {
      run: { id: string; status: string; output: unknown };
    };

    expect(response.status).toBe(201);
    expect(payload.run.status).toBe("approved");

    const workflowRun = await waitForResult(
      () => services.workflowRunner.readRun(payload.run.id as WorkflowRunId),
      (run) => run?.status === "completed",
      "trusted teaching completion",
    );
    expectApprovedScopeMatchesConsent(workflowRun!, "trusted");
  });

  it("starts trusted Spotlight runs immediately without the two-step path", async () => {
    const { services, request, review, revision } = createFixture();
    const profile = services.profiles.create(spotlightProfileInput("Trusted spotlight", "trusted"));

    const response = await request(`/api/reviews/${review.displayId}/spotlight/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "generate",
        trigger: "manual",
        gated: false,
        revisionId: revision.id,
        profileId: profile.id,
      }),
    });
    const payload = (await json(response)) as { run: { id: string; status: string } };

    expect(response.status).toBe(201);
    expect(payload.run.status).toBe("planning");
    await waitForResult(
      () => services.spotlight.getRun(payload.run.id as never),
      (run) => run?.status === "completed",
      "trusted Spotlight completion",
    );

    const workflowRuns = services.workflowRunner
      .listRunsByReview(review.id)
      .filter((run) => run.metadata.spotlightRunId === payload.run.id);
    expect(workflowRuns.length).toBeGreaterThan(0);

    for (const workflowRun of workflowRuns) {
      expect(workflowRun.approvedScope).not.toBeNull();
    }

    const planRun = workflowRuns.find((run) => run.workflowKind === "spotlight_plan");
    expect(planRun?.metadata.consentMode).toBe("trusted");

    const views = await request(`/api/reviews/${review.displayId}/spotlight/views`);
    const viewsPayload = (await json(views)) as { views: unknown[] };
    expect(viewsPayload.views.length).toBeGreaterThan(0);
  });
});
