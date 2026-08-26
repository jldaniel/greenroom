import { expect, test } from "./fixtures/playwright";

import type {
  BuiltinReviewRun,
  DiffFile,
  Profile,
  RevisionSnapshot,
  ThreadAnchor,
  ThreadWithComments,
  WorkflowRun,
  WorkflowRunEvent,
} from "@greenroom/schemas";

const now = "2026-06-28T12:00:00.000Z";

test("shows AI Review consent, draft findings, and gates thread creation", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });

  const longToken = `unbroken-${"finding".repeat(64)}`;
  const review = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Draft-gated AI review",
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: "main" },
      headRef: { kind: "branch", value: "feature/review" },
    },
    baseRefDisplay: "main",
    headRefDisplay: "feature/review",
    currentRevisionId: "revision_1",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const repository = {
    id: "repo_1",
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
    identityKey: "/work/greenroom/.git",
    displayName: "Greenroom",
    defaultBranchCandidate: "main",
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const revision: RevisionSnapshot = {
    id: "revision_1",
    reviewDisplayId: "GR-1",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktreeFingerprint: null,
    diffSummary: {
      fileCount: 1,
      additions: 1,
      deletions: 0,
      binaryFileCount: 0,
      renameCount: 0,
    },
    refreshReason: "initial",
    createdAt: now,
  };
  const file: DiffFile = {
    id: "diff_file_1",
    revisionId: "revision_1",
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
        id: "diff_hunk_1",
        fileId: "diff_file_1",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        header: "@@ -1 +1,2 @@",
        sortOrder: 1,
        lines: [
          {
            type: "context",
            oldLineNumber: 1,
            newLineNumber: 1,
            content: "export function answer() {",
          },
          { type: "addition", oldLineNumber: null, newLineNumber: 2, content: "  return 42;" },
        ],
      },
    ],
  };
  const profile: Profile = {
    id: "profile_review",
    name: "Harness reviewer",
    workflowType: "builtin_review",
    provider: "harness",
    model: "codex",
    description: null,
    systemPrompt: null,
    modelSettings: { harness: { kind: "codex" } },
    allowedTools: [],
    contextPreferences: {},
    // One-click consent is the default: a single confirmation dialog starts
    // the run atomically (create + approve) via `start: true`.
    privacy: { persistTranscript: false, consentMode: "one_click" },
    createdAt: now,
    updatedAt: now,
  };
  const anchor = changedAnchor("  return 42;");
  const threads: ThreadWithComments[] = [];
  const events: WorkflowRunEvent[] = [
    workflowEvent(1, "lifecycle", "Built-in review run started."),
    workflowEvent(2, "draft_submission", "Harness submitted draft findings."),
  ];
  let consentRequest: unknown = null;
  // One-click consent creates and starts the run atomically, so the run
  // returned by the consent endpoint has already settled to awaiting_user
  // with validated draft findings that still require explicit approval.
  let workflowRun: WorkflowRun = {
    id: "workflow_run_1",
    workflowKind: "builtin_review",
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    profileId: "profile_review",
    harnessKind: "codex",
    status: "awaiting_user",
    phase: "awaiting_user",
    consentSummary: {
      workflowKind: "builtin_review",
      selectedHarness: "codex",
      profile: {
        id: "profile_review",
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "codex",
      },
      reviewDisplayId: "GR-1",
      revisionId: "revision_1",
      scopeLabel: "All changed files",
      changedFiles: {
        fileCount: 1,
        additions: 1,
        deletions: 0,
        binaryFileCount: 0,
        renameCount: 0,
        files: [
          {
            path: "src/index.ts",
            oldPath: null,
            status: "modified",
            additions: 1,
            deletions: 0,
            isBinary: false,
          },
        ],
        omittedFileCount: 0,
      },
      allowedMcpCapabilities: ["review:read", "diff:read", "threads:read", "draft:submit"],
      expectedMcpResources: [
        "greenroom://reviews/GR-1/manifest",
        "greenroom://reviews/GR-1/files/{path}",
      ],
      expectedOutputMode: "builtin_review_findings",
      threadCreationGate: {
        mode: "draft_approval_required",
        autoCreateThreads: false,
        reason: "Built-in review defaults to validated draft approval before creating threads.",
      },
      repositoryAccess: {
        mode: "mcp_only",
        readScopeLabel: "Greenroom MCP context only",
        revisionId: null,
        baseSha: null,
        headSha: null,
        workspaceStrategy: null,
      },
      tracingStatus: "disabled",
    },
    approvedScope: null,
    draftOutput: {
      kind: "builtin_review_findings",
      summary: `Validated draft summary. ${longToken}`,
      findings: [
        {
          id: "finding-1",
          title: "Review the changed return",
          body: `This finding should wait for explicit draft approval. ${longToken}`,
          type: "issue",
          severity: "minor",
          anchorKey: "src/index.ts:2",
          confidence: 0.7,
        },
      ],
      nonFindings: [`No security concern found. ${longToken}`],
    },
    finalOutput: null,
    validationIssues: [],
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    queuedAt: now,
    startedAt: now,
    finishedAt: null,
    completedAt: null,
    cancelledAt: null,
    metadata: { consentMode: "one_click", threadCreationGateMode: "draft_approval_required" },
  };
  let builtinRun: BuiltinReviewRun = builtinRunFromWorkflow(workflowRun);

  await page.route("**/api/reviews/GR-1/builtin-review/consent", async (route) => {
    consentRequest = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { run: builtinRun } });
  });
  await page.route("**/api/builtin-review/runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: builtinRun } });
  });
  await page.route("**/api/builtin-review/runs/workflow_run_1/approve-draft", async (route) => {
    const thread: ThreadWithComments = {
      reviewDisplayId: "GR-1",
      shortRef: "GT-1",
      status: "open",
      type: "issue",
      severity: "minor",
      source: {
        kind: "builtin_reviewer",
        displayName: "Harness reviewer",
        profileId: "profile_review",
        metadata: { workflowRunId: "workflow_run_1", findingId: "finding-1" },
      },
      anchor,
      anchors: [anchor],
      remapConfidence: null,
      outdated: false,
      createdAt: now,
      updatedAt: now,
      comments: [
        {
          id: "comment_1",
          threadRef: "GT-1",
          parentCommentId: null,
          authorKind: "builtin_reviewer",
          authorDisplayName: "Harness reviewer",
          body: "This finding should wait for explicit draft approval.",
          sortOrder: 1,
          createdAt: now,
          editedAt: null,
        },
      ],
    };
    threads.splice(0, threads.length, thread);
    workflowRun = {
      ...workflowRun,
      status: "completed",
      phase: "completed",
      finalOutput: workflowRun.draftOutput,
      completedAt: now,
      finishedAt: now,
      updatedAt: now,
      metadata: {
        ...workflowRun.metadata,
        createdThreadRefs: ["GT-1"],
        createdThreadCount: 1,
      },
    };
    builtinRun = { ...builtinRunFromWorkflow(workflowRun), createdThreadRefs: ["GT-1"] };
    events.push(workflowEvent(3, "persistence", "Created review thread from approved draft."));
    await route.fulfill({ json: { run: builtinRun } });
  });
  await page.route("**/api/reviews/GR-1/workflow-runs", async (route) => {
    await route.fulfill({ json: { runs: [workflowRun] } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: workflowRun } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1/events", async (route) => {
    await route.fulfill({ json: { events } });
  });
  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    await route.fulfill({ json: { threads } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: { reviewDisplayId: "GR-1", revisionId: "revision_1", memberships: [] },
    });
  });
  await page.route("**/api/reviews/GR-1/diff", async (route) => {
    await route.fulfill({ json: { review, revision, files: [file] } });
  });
  await page.route("**/api/reviews/GR-1/revisions", async (route) => {
    await route.fulfill({ json: { revisions: [revision] } });
  });
  await page.route("**/api/reviews/GR-1", async (route) => {
    await route.fulfill({ json: { review, repository, currentRevision: revision } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [profile] } });
  });
  await page.route("**/api/reviews/GR-1/worktree-status", async (route) => {
    await route.fulfill({
      json: {
        reviewDisplayId: "GR-1",
        revisionId: "revision_1",
        applicable: true,
        dirty: true,
        snapshotFingerprint: null,
        currentFingerprint: {
          headSha: "c".repeat(40),
          stagedDiffHash: null,
          unstagedDiffHash: null,
        },
        checkedAt: now,
      },
    });
  });

  // The first-launch wizard probes /api/repositories without a token before
  // deciding whether to redirect to /setup; answer it deterministically so
  // the wizard never intercepts this test.
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });

  await page.goto("/reviews/GR-1");
  await page.getByRole("tab", { name: "AI Review" }).click();
  await page.getByRole("button", { name: "Run AI review" }).click();

  // One-click consent: a single confirmation dialog shows the run scope and
  // no consent request is sent until it is confirmed.
  const consentDialog = page.getByRole("dialog", { name: "Start AI review run" });
  await expect(consentDialog).toBeVisible();
  await expect(consentDialog.getByText("Harness reviewer")).toBeVisible();
  await expect(consentDialog.getByText("harness / codex")).toBeVisible();
  await expect(consentDialog.getByText("All changed files (1 file)")).toBeVisible();
  await expect(consentDialog.getByText(/Worktree has changed/)).toBeVisible();
  expect(consentRequest).toBeNull();

  // Confirming sends the atomic create-and-start request (`start: true`).
  await consentDialog.getByRole("button", { name: "Confirm & run" }).click();
  await expect(consentDialog).toHaveCount(0);

  await expect(page.getByText("Allowed inspection")).toBeVisible();
  await expect(page.getByText("diff:read")).toBeVisible();
  await expect(page.getByText("MCP resources (2)")).toBeVisible();
  expect(consentRequest).toMatchObject({
    profileId: "profile_review",
    revisionId: "revision_1",
    maxApproximateTokens: 24_000,
    start: true,
  });

  // The old separate approval step no longer exists for one-click profiles,
  // but findings still land as drafts that gate thread creation.
  await expect(page.getByRole("button", { name: "Approve run" })).toHaveCount(0);
  await expect(page.getByText("Draft findings are validated")).toBeVisible();
  await expect(page.getByText("Review the changed return")).toBeVisible();

  const findingCard = page.locator("article").filter({ hasText: longToken }).first();
  await expect(findingCard).toBeVisible();
  const findingOverflow = await findingCard.evaluate((card) => ({
    clientWidth: card.clientWidth,
    scrollWidth: card.scrollWidth,
  }));
  expect(findingOverflow.scrollWidth).toBeLessThanOrEqual(findingOverflow.clientWidth + 1);

  // The raw event timeline sits behind the shared RunStatus "Details"
  // disclosure and stays collapsed until opened.
  await expect(page.getByText("Harness submitted draft findings.")).toBeHidden();
  await page.getByText("Details", { exact: true }).click();
  await expect(page.getByText("Harness submitted draft findings.")).toBeVisible();
  expect(threads).toHaveLength(0);

  await page.getByRole("button", { name: "Approve all" }).click();
  await expect(page.getByText("Created threads: GT-1")).toBeVisible();
  expect(threads).toHaveLength(1);
});

function builtinRunFromWorkflow(run: WorkflowRun): BuiltinReviewRun {
  const draft = run.finalOutput ?? run.draftOutput;
  const output =
    draft?.kind === "builtin_review_findings"
      ? {
          summary: draft.summary,
          findings: draft.findings,
          nonFindings: draft.nonFindings,
        }
      : null;

  return {
    id: run.id,
    reviewDisplayId: run.reviewDisplayId,
    profileId: run.profileId,
    status:
      run.status === "awaiting_user"
        ? "awaiting_user"
        : run.status === "completed"
          ? "completed"
          : run.status === "cancelled"
            ? "cancelled"
            : run.status === "failed"
              ? "failed"
              : run.status === "pending_consent"
                ? "pending_consent"
                : "approved",
    context: {
      review: {
        displayId: "GR-1",
        repositoryId: "repo_1",
        title: "Draft-gated AI review",
        range: {
          kind: "branch_to_branch",
          baseRef: { kind: "branch", value: "main" },
          headRef: { kind: "branch", value: "feature/review" },
        },
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
        currentRevisionId: "revision_1",
        status: "open",
        spotlightConfig: { autoGenerateSpotlight: false },
        createdAt: now,
        updatedAt: now,
      },
      repository: {
        id: "repo_1",
        rootPath: "/work/greenroom",
        gitCommonDir: "/work/greenroom/.git",
        identityKey: "/work/greenroom/.git",
        displayName: "Greenroom",
        defaultBranchCandidate: "main",
        lastOpenedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      revision: {
        id: "revision_1",
        reviewDisplayId: "GR-1",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        worktreeFingerprint: null,
        diffSummary: {
          fileCount: 1,
          additions: 1,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
        refreshReason: "initial",
        createdAt: now,
      },
      files: [
        {
          path: "src/index.ts",
          oldPath: null,
          status: "modified",
          isBinary: false,
          additions: 1,
          deletions: 0,
          hunks: [],
          changedLineCount: 1,
          approximateTokenCount: 120,
        },
      ],
      omittedFiles: [],
      existingThreads: [],
      spotlightViews: [],
      approximateTokenCount: 320,
      generatedAt: now,
    },
    createdAt: run.createdAt,
    approvedAt: run.queuedAt,
    completedAt: run.completedAt,
    errorMessage: run.errorMessage,
    output,
    createdThreadRefs: Array.isArray(run.metadata.createdThreadRefs)
      ? (run.metadata.createdThreadRefs as BuiltinReviewRun["createdThreadRefs"])
      : [],
  };
}

function workflowEvent(
  sequenceNumber: number,
  eventType: WorkflowRunEvent["eventType"],
  summary: string,
): WorkflowRunEvent {
  return {
    id: `workflow_event_${sequenceNumber}`,
    runId: "workflow_run_1",
    reviewDisplayId: "GR-1",
    sequenceNumber,
    eventType,
    summary,
    severity: "info",
    timestamp: now,
    metadata: {},
  };
}

function changedAnchor(originalLineText: string): ThreadAnchor {
  return {
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    filePath: "src/index.ts",
    oldFilePath: null,
    side: "head",
    lineNumber: 2,
    lineType: "addition",
    hunkId: "diff_hunk_1",
    hunkHeader: "@@ -1 +1,2 @@",
    contextBefore: ["export function answer() {"],
    contextAfter: [],
    originalLineText,
  };
}
