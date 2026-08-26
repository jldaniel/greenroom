import { expect, test } from "./fixtures/playwright";

const now = "2026-06-28T12:00:00.000Z";

// A cross-page header indicator shows active runs and a toast fires when a
// run leaves the active set. The failed-run toast links to the run's
// workspace section, where RunStatus surfaces the diagnostics endpoint.
test("header run indicator and completion toast persist across pages", async ({ page }) => {
  const consentSummary = {
    workflowKind: "builtin_review",
    selectedHarness: "claude-code",
    profile: {
      id: "profile_review",
      name: "Claude reviewer",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-sonnet",
    },
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    scopeLabel: "All changed files",
    changedFiles: {
      fileCount: 0,
      additions: 0,
      deletions: 0,
      binaryFileCount: 0,
      renameCount: 0,
      files: [],
      omittedFileCount: 0,
    },
    allowedMcpCapabilities: ["review:read", "diff:read", "threads:read", "draft:submit"],
    expectedMcpResources: ["greenroom://reviews/GR-1/manifest"],
    expectedOutputMode: "builtin_review_findings",
    threadCreationGate: {
      mode: "draft_approval_required",
      autoCreateThreads: false,
      reason: "Validated findings require approval.",
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
  };
  const activeRun = {
    id: "workflow_run_1",
    workflowKind: "builtin_review",
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    profileId: "profile_review",
    harnessKind: "claude-code",
    status: "running",
    phase: "drafting",
    consentSummary,
    approvedScope: null,
    draftOutput: null,
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
    metadata: {},
  };
  const failedRun = {
    ...activeRun,
    status: "failed",
    phase: "failed",
    errorMessage: "Harness bridge is unavailable.",
    finishedAt: now,
  };
  const review = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Failed AI review",
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: "main" },
      headRef: { kind: "branch", value: "feature/notifications" },
    },
    baseRefDisplay: "main",
    headRefDisplay: "feature/notifications",
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
  const revision = {
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
  const file = {
    id: "diff_file_1",
    revisionId: "revision_1",
    path: "src/notifications.ts",
    oldPath: null,
    status: "modified",
    isBinary: false,
    additions: 1,
    deletions: 0,
    oldMode: null,
    newMode: null,
    renameMetadata: null,
    hunks: [],
  };
  const profile = {
    id: "profile_review",
    name: "Claude reviewer",
    workflowType: "builtin_review",
    provider: "harness",
    model: "claude-sonnet",
    description: null,
    systemPrompt: null,
    modelSettings: { harness: { kind: "claude-code" } },
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode: "one_click" },
    createdAt: now,
    updatedAt: now,
  };
  let activeRuns: unknown[] = [activeRun];

  await page.route(
    (url) => url.pathname.endsWith("/api/workflow-runs") && url.searchParams.has("status"),
    async (route) => {
      await route.fulfill({ json: { runs: activeRuns } });
    },
  );
  await page.route("**/api/workflow-runs/workflow_run_1", async (route) => {
    await route.fulfill({
      json: {
        run: failedRun,
        transcripts: [],
      },
    });
  });
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });
  await page.route(
    (url) => url.pathname.endsWith("/api/reviews"),
    async (route) => {
      await route.fulfill({
        json: { reviews: [{ review, repository, currentRevision: revision }] },
      });
    },
  );
  await page.route("**/api/reviews/GR-1", async (route) => {
    await route.fulfill({ json: { review, repository, currentRevision: revision } });
  });
  await page.route("**/api/reviews/GR-1/revisions", async (route) => {
    await route.fulfill({ json: { revisions: [revision] } });
  });
  await page.route("**/api/reviews/GR-1/diff", async (route) => {
    await route.fulfill({ json: { review, revision, files: [file] } });
  });
  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: { reviewDisplayId: "GR-1", revisionId: "revision_1", memberships: [] },
    });
  });
  await page.route("**/api/reviews/GR-1/workflow-runs", async (route) => {
    // The review-scoped list provides the resumable run identity while the
    // exact run endpoint is the authoritative settled state.
    await route.fulfill({ json: { runs: [activeRun] } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1/events**", async (route) => {
    await route.fulfill({ json: { events: [], nextCursor: 0, terminal: true } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1/diagnostics", async (route) => {
    await route.fulfill({
      json: {
        diagnostics: {
          runId: "workflow_run_1",
          status: "failed",
          failureCategory: "bridge_down",
          summary: "The harness bridge could not be reached.",
          errorMessage: "Harness bridge is unavailable.",
          failingStep: null,
          exitCode: null,
          stderrTail: null,
          repairAttempts: [],
          maxRepairAttempts: null,
          fingerprint: {
            changed: false,
            consentedRevisionId: "revision_1",
            currentRevisionId: "revision_1",
          },
          repositoryAccess: {
            mode: "mcp_only",
            readScopeLabel: "Greenroom MCP context only",
            revisionId: null,
            baseSha: null,
            headSha: null,
            workspaceStrategy: null,
            workspaceSetupStatus: null,
            workspaceCleanupStatus: null,
            workspaceErrorMessage: null,
          },
          timeoutMs: null,
          timeoutBudgetMs: null,
          transcripts: [],
          transcriptsUrl: "/api/workflow-runs/workflow_run_1/transcripts",
        },
      },
    });
  });
  await page.route("**/api/builtin-review/runs/workflow_run_1", async (route) => {
    await route.fulfill({
      json: {
        run: {
          id: "workflow_run_1",
          reviewDisplayId: "GR-1",
          profileId: "profile_review",
          status: "failed",
          context: null,
          createdAt: now,
          approvedAt: now,
          completedAt: now,
          errorMessage: "Harness bridge is unavailable.",
          output: null,
          createdThreadRefs: [],
        },
      },
    });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [profile] } });
  });
  await page.route("**/api/reviews/GR-1/worktree-status", async (route) => {
    await route.fulfill({
      json: {
        reviewDisplayId: "GR-1",
        revisionId: "revision_1",
        applicable: false,
        dirty: false,
        snapshotFingerprint: null,
        currentFingerprint: null,
        checkedAt: now,
      },
    });
  });
  await page.route("**/api/harness/status", async (route) => {
    await route.fulfill({
      json: {
        bridge: { configured: true, reachable: false, baseUrl: "http://127.0.0.1:8788" },
        detected: [],
      },
    });
  });

  await page.goto("/");

  // The indicator lives in the app header chrome, not the workspace.
  const indicator = page.getByTestId("header-run-indicator");
  await expect(indicator.getByRole("button", { name: "1 active run" })).toBeVisible();

  // The dropdown lists the run with its kind and status.
  await indicator.getByRole("button", { name: "1 active run" }).click();
  // The row's accessible name is "kind + activity label + status"; the middle
  // segment varies (phase, progress units, or last-activity age), so only pin
  // the kind and the trailing status.
  await expect(indicator.getByRole("button", { name: /AI review\s+.*running/ })).toBeVisible();
  await indicator.getByRole("button", { name: "1 active run" }).click();

  // The run settles as failed: it leaves the active list, the poller fetches
  // its final state, and a failure toast with a diagnostics link fires.
  activeRuns = [];

  const toast = page.getByRole("status").filter({ hasText: "AI review run failed" });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText("Harness bridge is unavailable.");
  await expect(page.getByTestId("header-run-indicator")).toHaveCount(0);

  // The diagnostics action opens the run's review workspace — addressed by
  // display ref, never the opaque review id — with the AI Review drawer
  // section pre-selected (where RunStatus shows diagnostics).
  await page.getByRole("button", { name: "View diagnostics" }).click();
  await expect(page).toHaveURL(/\/reviews\/GR-1$/);

  const aiReviewTab = page.getByRole("tab", { name: "AI Review" });
  await expect(aiReviewTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Harness bridge is unavailable.").last()).toBeVisible();
  await expect(page.getByText("bridge down", { exact: true })).toBeVisible();
  await expect(page.getByText("The harness bridge could not be reached.")).toBeVisible();

  const drawerState = await page.evaluate(() =>
    window.localStorage.getItem("greenroom.workspace.drawer"),
  );
  expect(JSON.parse(drawerState ?? "{}")).toMatchObject({ open: true, section: "ai_review" });
});
