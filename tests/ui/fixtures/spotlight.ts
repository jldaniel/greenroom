import type {
  DiffFile,
  Profile,
  Repository,
  ReviewPr,
  RevisionSnapshot,
  SpotlightRun,
  SpotlightView,
  SpotlightViewRegion,
  TeachingContextPack,
  TeachingRunResult,
  ThreadAnchor,
  ThreadWithComments,
  WorkflowRun,
} from "@greenroom/schemas";

import type { Page } from "./playwright";

export const spotlightNow = "2026-06-27T12:00:00.000Z";

type SpotlightViewResource = SpotlightView & {
  associatedFiles: { path: string; oldPath: string | null }[];
};

interface SpotlightContextSummary {
  review: { displayId: string; title: string };
  revision: { id: string; baseSha: string; headSha: string };
  profile: { id: string; name: string; provider: string; model: string };
  files: {
    path: string;
    oldPath: string | null;
    status: string;
    additions: number;
    deletions: number;
    hunkCount: number;
    changedLineCount: number;
  }[];
  fileCount: number;
  hunkCount: number;
  changedLineCount: number;
  approximateTokenCount: number;
}

type StepperSpotlightRun = SpotlightRun & {
  pendingOutline: SpotlightRun["approvedOutline"];
  contextSummary: SpotlightContextSummary;
  refinementCount: number;
};

export interface SpotlightTestState {
  views: SpotlightViewResource[];
  run: SpotlightRun | StepperSpotlightRun;
  threads: ThreadWithComments[];
  requests: {
    spotlightRun: unknown | null;
    teachingConsent: unknown | null;
    createdThreadSource: ThreadWithComments["source"] | null;
  };
}

export interface SpotlightTestFixture {
  review: ReviewPr;
  repository: Repository;
  revision: RevisionSnapshot;
  file: DiffFile;
  spotlightProfile: Profile;
  teachingProfile: Profile;
  generatedView: SpotlightViewResource;
  overlappingView: SpotlightViewResource;
  litAnchor: ThreadAnchor;
  coverageAnchor: ThreadAnchor;
  state: SpotlightTestState;
}

interface SetupSpotlightOptions {
  consentMode?: "one_click" | "two_step";
  initialViews?: boolean;
}

export async function setupSpotlightTest(
  page: Page,
  { consentMode = "one_click", initialViews = true }: SetupSpotlightOptions = {},
): Promise<SpotlightTestFixture> {
  const review: ReviewPr = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Spotlight review",
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: "main" },
      headRef: { kind: "branch", value: "feature/spotlight" },
    },
    baseRefDisplay: "main",
    headRefDisplay: "feature/spotlight",
    currentRevisionId: "revision_1",
    status: "open",
    spotlightConfig: { autoGenerateSpotlight: false },
    createdAt: spotlightNow,
    updatedAt: spotlightNow,
  };
  const repository: Repository = {
    id: "repo_1",
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
    identityKey: "/work/greenroom/.git",
    displayName: "Greenroom",
    defaultBranchCandidate: "main",
    spotlightConfig: { autoGenerateSpotlight: false },
    lastOpenedAt: null,
    createdAt: spotlightNow,
    updatedAt: spotlightNow,
  };
  const revision: RevisionSnapshot = {
    id: "revision_1",
    reviewDisplayId: "GR-1",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktreeFingerprint: null,
    diffSummary: {
      fileCount: 1,
      additions: 2,
      deletions: 0,
      binaryFileCount: 0,
      renameCount: 0,
    },
    refreshReason: "initial",
    createdAt: spotlightNow,
  };
  const file: DiffFile = {
    id: "diff_file_1",
    revisionId: "revision_1",
    path: "src/index.ts",
    oldPath: null,
    status: "modified",
    isBinary: false,
    additions: 2,
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
        newLines: 3,
        header: "@@ -1 +1,3 @@",
        sortOrder: 1,
        lines: [
          {
            type: "context",
            oldLineNumber: 1,
            newLineNumber: 1,
            content: "export function answer() {",
          },
          {
            type: "addition",
            oldLineNumber: null,
            newLineNumber: 2,
            content: "  const value = 42;",
          },
          {
            type: "addition",
            oldLineNumber: null,
            newLineNumber: 3,
            content: "  return value;",
          },
        ],
      },
    ],
  };
  const spotlightProfile: Profile = {
    id: "profile_1",
    name: consentMode === "two_step" ? "Two-step spotlight" : "Default spotlight",
    workflowType: "spotlight",
    provider: "mock",
    model: "mock-spotlight",
    description: null,
    systemPrompt: null,
    modelSettings: {},
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode },
    createdAt: spotlightNow,
    updatedAt: spotlightNow,
  };
  const teachingProfile: Profile = {
    ...spotlightProfile,
    id: "profile_teaching",
    name: "Mock teaching",
    workflowType: "teaching",
    model: "mock-teacher",
    privacy: { persistTranscript: false, consentMode: "one_click" },
  };
  const litAnchor = changedAnchor(2, "  const value = 42;");
  const coverageAnchor = changedAnchor(3, "  return value;");
  const generatedView: SpotlightViewResource = {
    reviewDisplayId: "GR-1",
    displayRef: "SV-1",
    title: "Implementation changes",
    description: "Source changes that carry the reviewed behavior.",
    intent: "feature",
    orderIndex: 0,
    health: "current",
    originRunId: "spotlight_run_1",
    lastReconciledRevisionId: "revision_1",
    createdAt: spotlightNow,
    updatedAt: spotlightNow,
    associatedFiles: [{ path: "src/index.ts", oldPath: null }],
  };
  const overlappingView: SpotlightViewResource = {
    ...generatedView,
    displayRef: "SV-2",
    title: "Runtime flow",
    description: "The same changed line seen through a cross-cutting runtime concern.",
    intent: "cross-cutting",
    orderIndex: 1,
  };
  const region: SpotlightViewRegion = {
    id: "spotlight_region_1",
    viewRef: "SV-1",
    filePath: "src/index.ts",
    oldPath: null,
    anchors: [litAnchor],
    remapConfidence: 1,
    stale: false,
  };
  const overlappingRegion: SpotlightViewRegion = {
    ...region,
    id: "spotlight_region_2",
    viewRef: "SV-2",
  };
  const outlineItem = {
    title: "Implementation changes",
    intent: "feature",
    description: "Source changes that carry the reviewed behavior.",
  };
  const completedRun: SpotlightRun = {
    id: "spotlight_run_1",
    reviewDisplayId: "GR-1",
    type: "generate",
    trigger: "manual",
    gated: consentMode === "two_step",
    status: "completed",
    revisionId: "revision_1",
    profileId: "profile_1",
    approvedOutline: [outlineItem],
    errorMessage: null,
    createdAt: spotlightNow,
    updatedAt: spotlightNow,
    completedAt: spotlightNow,
  };
  const contextSummary: SpotlightContextSummary = {
    review: { displayId: "GR-1", title: "Spotlight review" },
    revision: {
      id: "revision_1",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    },
    profile: {
      id: "profile_1",
      name: "Two-step spotlight",
      provider: "mock",
      model: "mock-spotlight",
    },
    files: [
      {
        path: "src/index.ts",
        oldPath: null,
        status: "modified",
        additions: 2,
        deletions: 0,
        hunkCount: 1,
        changedLineCount: 2,
      },
    ],
    fileCount: 1,
    hunkCount: 1,
    changedLineCount: 2,
    approximateTokenCount: 240,
  };
  const pendingRun: StepperSpotlightRun = {
    ...completedRun,
    status: "pending_consent",
    approvedOutline: null,
    completedAt: null,
    pendingOutline: null,
    contextSummary,
    refinementCount: 0,
  };
  const awaitingPlanRun: StepperSpotlightRun = {
    ...pendingRun,
    status: "awaiting_plan_approval",
    pendingOutline: [outlineItem],
    updatedAt: "2026-06-27T12:01:00.000Z",
  };
  const completedStepperRun: StepperSpotlightRun = {
    ...awaitingPlanRun,
    status: "completed",
    approvedOutline: [outlineItem],
    pendingOutline: null,
    completedAt: "2026-06-27T12:02:00.000Z",
    updatedAt: "2026-06-27T12:02:00.000Z",
  };
  const teachingContext: TeachingContextPack = {
    review,
    repository,
    revision,
    scope: {
      kind: "spotlight_view",
      viewRef: "SV-1",
      title: "Implementation changes",
      health: "current",
    },
    files: [
      {
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        isBinary: file.isBinary,
        additions: file.additions,
        deletions: file.deletions,
        hunks: file.hunks.map((hunk) => ({
          header: hunk.header,
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          lines: hunk.lines,
        })),
        approximateTokenCount: 120,
      },
    ],
    omittedFiles: [],
    spotlightRegions: [{ filePath: file.path, oldPath: file.oldPath, anchors: [litAnchor] }],
    omittedRegions: [],
    approximateTokenCount: 240,
    generatedAt: spotlightNow,
  };
  const approvedTeachingRun: TeachingRunResult = {
    id: "workflow_run_1",
    reviewDisplayId: "GR-1",
    profileId: "profile_teaching",
    status: "approved",
    context: teachingContext,
    createdAt: spotlightNow,
    approvedAt: spotlightNow,
    completedAt: null,
    errorMessage: null,
    output: null,
  };
  const teachingWorkflowRun: WorkflowRun = {
    id: "workflow_run_1",
    workflowKind: "teaching_generate",
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    profileId: "profile_teaching",
    harnessKind: "mock-teacher",
    status: "running",
    phase: "drafting",
    consentSummary: {
      workflowKind: "teaching_generate",
      selectedHarness: "mock-teacher",
      profile: {
        id: "profile_teaching",
        name: "Mock teaching",
        workflowType: "teaching",
        provider: "mock",
        model: "mock-teacher",
      },
      reviewDisplayId: "GR-1",
      revisionId: "revision_1",
      scopeLabel: "Spotlight View: Implementation changes",
      changedFiles: {
        fileCount: 1,
        additions: 1,
        deletions: 0,
        binaryFileCount: 0,
        renameCount: 0,
        files: [],
        omittedFileCount: 0,
      },
      allowedMcpCapabilities: ["review:read", "diff:read", "teaching:read", "draft:submit"],
      expectedMcpResources: ["greenroom://reviews/GR-1/manifest"],
      expectedOutputMode: "teaching_draft",
      threadCreationGate: null,
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
    draftOutput: null,
    finalOutput: null,
    validationIssues: [],
    errorMessage: null,
    createdAt: spotlightNow,
    updatedAt: spotlightNow,
    queuedAt: spotlightNow,
    startedAt: spotlightNow,
    finishedAt: null,
    completedAt: null,
    cancelledAt: null,
    metadata: { workflowFamily: "teaching", teachingScopeKind: "spotlight_view" },
  };
  const state: SpotlightTestState = {
    views: initialViews ? [generatedView, overlappingView] : [],
    run: consentMode === "two_step" ? pendingRun : completedRun,
    threads: [],
    requests: {
      spotlightRun: null,
      teachingConsent: null,
      createdThreadSource: null,
    },
  };

  await page.route("**/api/reviews/GR-1/spotlight/runs", async (route) => {
    state.requests.spotlightRun = route.request().postDataJSON();
    if (consentMode === "one_click") {
      state.views = [generatedView, overlappingView];
    }
    await route.fulfill({ status: 201, json: { run: state.run } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/runs/spotlight_run_1", async (route) => {
    await route.fulfill({ json: { run: state.run } });
  });
  await page.route(
    "**/api/reviews/GR-1/spotlight/runs/spotlight_run_1/approve-context",
    async (route) => {
      state.run = awaitingPlanRun;
      await route.fulfill({ json: { run: state.run } });
    },
  );
  await page.route(
    "**/api/reviews/GR-1/spotlight/runs/spotlight_run_1/approve-plan",
    async (route) => {
      state.run = completedStepperRun;
      state.views = [generatedView];
      await route.fulfill({ json: { run: state.run } });
    },
  );
  await page.route("**/api/reviews/GR-1/spotlight/views", async (route) => {
    await route.fulfill({ json: { views: state.views } });
  });
  await page.route("**/api/spotlight/views/SV-1/diff", async (route) => {
    await route.fulfill({
      json: { view: generatedView, revision, files: [file], regions: [region] },
    });
  });
  await page.route("**/api/spotlight/views/SV-2/diff", async (route) => {
    await route.fulfill({
      json: {
        view: overlappingView,
        revision,
        files: [file],
        regions: [overlappingRegion],
      },
    });
  });
  await page.route("**/api/reviews/GR-1/spotlight/coverage", async (route) => {
    await route.fulfill({
      json: {
        reviewDisplayId: "GR-1",
        revisionId: "revision_1",
        unlitAnchors: consentMode === "two_step" ? [] : [coverageAnchor],
      },
    });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: {
        reviewDisplayId: "GR-1",
        revisionId: "revision_1",
        memberships:
          consentMode === "two_step"
            ? []
            : [
                { anchor: litAnchor, views: state.views },
                { anchor: coverageAnchor, views: [] },
              ],
      },
    });
  });
  await page.route("**/api/reviews/GR-1/workflow-runs", async (route) => {
    await route.fulfill({ json: { runs: [] } });
  });
  await page.route("**/api/reviews/GR-1/teaching/consent", async (route) => {
    state.requests.teachingConsent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { run: approvedTeachingRun } });
  });
  await page.route("**/api/teaching/runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: approvedTeachingRun } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: teachingWorkflowRun } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1/events*", async (route) => {
    await route.fulfill({ json: { events: [] } });
  });
  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { threads: state.threads } });
      return;
    }

    const input = route.request().postDataJSON() as {
      anchor: ThreadWithComments["anchor"];
      anchors?: ThreadWithComments["anchors"];
      firstComment: {
        authorDisplayName: string;
        authorKind: "human";
        body: string;
      };
      severity: ThreadWithComments["severity"];
      source: ThreadWithComments["source"];
      type: ThreadWithComments["type"];
    };
    state.requests.createdThreadSource = input.source;
    const thread: ThreadWithComments = {
      reviewDisplayId: "GR-1",
      shortRef: "GT-1",
      status: "open",
      type: input.type,
      severity: input.severity ?? null,
      source: input.source,
      anchor: input.anchor,
      anchors: input.anchors ?? [input.anchor],
      remapConfidence: null,
      outdated: false,
      createdAt: spotlightNow,
      updatedAt: spotlightNow,
      comments: [
        {
          id: "comment_1",
          threadRef: "GT-1",
          parentCommentId: null,
          authorKind: input.firstComment.authorKind,
          authorDisplayName: input.firstComment.authorDisplayName,
          body: input.firstComment.body,
          sortOrder: 1,
          createdAt: spotlightNow,
          editedAt: null,
        },
      ],
    };
    state.threads.splice(0, state.threads.length, thread);
    await route.fulfill({ status: 201, json: { thread } });
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
    await route.fulfill({ json: { profiles: [spotlightProfile, teachingProfile] } });
  });
  await page.route("**/api/reviews/GR-1/worktree-status", async (route) => {
    await route.fulfill({
      json: {
        reviewDisplayId: "GR-1",
        revisionId: "revision_1",
        applicable: true,
        dirty: false,
        snapshotFingerprint: null,
        currentFingerprint: null,
        checkedAt: spotlightNow,
      },
    });
  });
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });

  return {
    review,
    repository,
    revision,
    file,
    spotlightProfile,
    teachingProfile,
    generatedView,
    overlappingView,
    litAnchor,
    coverageAnchor,
    state,
  };
}

function changedAnchor(lineNumber: number, originalLineText: string): ThreadAnchor {
  return {
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    filePath: "src/index.ts",
    oldFilePath: null,
    side: "head",
    lineNumber,
    lineType: "addition",
    hunkId: "diff_hunk_1",
    hunkHeader: "@@ -1 +1,3 @@",
    contextBefore: ["export function answer() {"],
    contextAfter: [],
    originalLineText,
  };
}
