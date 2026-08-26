import type {
  DiffFile,
  Profile,
  Repository,
  ReviewPr,
  RevisionSnapshot,
  StructuredTeachingOutput,
  TeachingConsentCreateInput,
  TeachingContextPack,
  TeachingFollowUpRequest,
  TeachingPromotionInput,
  TeachingRunResult,
  ThreadAnchor,
  ThreadWithComments,
  WorkflowRun,
} from "@greenroom/schemas";

import type { Page } from "./playwright";

export const teachingNow = "2026-06-25T12:00:00.000Z";

type InitialTeachingRun = "completed" | "none";

export interface TeachingTestState {
  hasRun: boolean;
  requests: {
    consent: TeachingConsentCreateInput | null;
    followUp: TeachingFollowUpRequest | null;
    promotion: TeachingPromotionInput | null;
  };
  teachingRun: TeachingRunResult;
  threads: ThreadWithComments[];
  workflowRun: WorkflowRun;
}

export interface TeachingTestFixture {
  anchor: ThreadAnchor;
  completedRun: TeachingRunResult;
  file: DiffFile;
  profile: Profile;
  repository: Repository;
  review: ReviewPr;
  revision: RevisionSnapshot;
  state: TeachingTestState;
}

export async function setupTeachingTest(
  page: Page,
  { initialRun = "none" }: { initialRun?: InitialTeachingRun } = {},
): Promise<TeachingTestFixture> {
  const review: ReviewPr = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Teaching review",
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: "main" },
      headRef: { kind: "branch", value: "feature/teaching" },
    },
    baseRefDisplay: "main",
    headRefDisplay: "feature/teaching",
    currentRevisionId: "revision_1",
    status: "open",
    spotlightConfig: { autoGenerateSpotlight: false },
    createdAt: teachingNow,
    updatedAt: teachingNow,
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
    createdAt: teachingNow,
    updatedAt: teachingNow,
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
    createdAt: teachingNow,
  };
  const file = createTeachingDiffFile(revision.id);
  const anchor: ThreadAnchor = {
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    filePath: "src/other.ts",
    oldFilePath: null,
    side: "head",
    lineNumber: 1,
    lineType: "addition",
    hunkId: "diff_hunk_2",
    hunkHeader: "@@ -0,0 +1 @@",
    contextBefore: [],
    contextAfter: [],
    originalLineText: "export const other = true;",
  };
  const teachingContext: TeachingContextPack = {
    review,
    repository,
    revision,
    scope: { kind: "full_pr" },
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
    spotlightRegions: [],
    omittedRegions: [],
    approximateTokenCount: 240,
    generatedAt: teachingNow,
  };
  const output = createTeachingOutput(anchor);
  const pendingRun: TeachingRunResult = {
    id: "workflow_run_1",
    reviewDisplayId: "GR-1",
    profileId: "profile_teaching",
    status: "pending_consent",
    context: teachingContext,
    createdAt: teachingNow,
    approvedAt: null,
    completedAt: null,
    errorMessage: null,
    output: null,
  };
  const completedRun: TeachingRunResult = {
    ...pendingRun,
    status: "completed",
    approvedAt: teachingNow,
    completedAt: teachingNow,
    output,
  };
  const baseWorkflowRun = createBaseWorkflowRun();
  const pendingWorkflowRun: WorkflowRun = {
    ...baseWorkflowRun,
    status: "pending_consent",
    phase: "pending_consent",
    finalOutput: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    completedAt: null,
  };
  const completedWorkflowRun: WorkflowRun = {
    ...baseWorkflowRun,
    status: "completed",
    phase: "completed",
    finalOutput: { kind: "teaching_draft", ...output },
    queuedAt: teachingNow,
    startedAt: teachingNow,
    finishedAt: teachingNow,
    completedAt: teachingNow,
  };
  const profile: Profile = {
    id: "profile_teaching",
    name: "Mock teaching",
    workflowType: "teaching",
    provider: "mock",
    model: "mock-teacher",
    description: null,
    systemPrompt: null,
    modelSettings: {},
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode: "two_step" },
    createdAt: teachingNow,
    updatedAt: teachingNow,
  };
  const state: TeachingTestState = {
    hasRun: initialRun === "completed",
    requests: { consent: null, followUp: null, promotion: null },
    teachingRun: initialRun === "completed" ? completedRun : pendingRun,
    threads: [],
    workflowRun: initialRun === "completed" ? completedWorkflowRun : pendingWorkflowRun,
  };

  await page.route("**/api/reviews/GR-1/revisions", async (route) => {
    await route.fulfill({ json: { revisions: [revision] } });
  });
  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    await route.fulfill({ json: { threads: state.threads } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: { reviewDisplayId: "GR-1", revisionId: revision.id, memberships: [] },
    });
  });
  await page.route("**/api/reviews/GR-1/spotlight/views", async (route) => {
    await route.fulfill({ json: { views: [] } });
  });
  await page.route("**/api/reviews/GR-1/workflow-runs", async (route) => {
    await route.fulfill({ json: { runs: state.hasRun ? [state.workflowRun] : [] } });
  });
  await page.route("**/api/reviews/GR-1/diff", async (route) => {
    await route.fulfill({ json: { review, revision, files: [file] } });
  });
  await page.route("**/api/reviews/GR-1", async (route) => {
    await route.fulfill({ json: { review, repository, currentRevision: revision } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [profile] } });
  });
  await page.route("**/api/reviews/GR-1/teaching/consent", async (route) => {
    state.requests.consent = route.request().postDataJSON() as TeachingConsentCreateInput;
    state.hasRun = true;
    state.teachingRun = pendingRun;
    state.workflowRun = pendingWorkflowRun;
    await route.fulfill({ status: 201, json: { run: state.teachingRun } });
  });
  await page.route("**/api/teaching/runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: state.teachingRun } });
  });
  await page.route("**/api/teaching/runs/workflow_run_1/approve", async (route) => {
    state.teachingRun = completedRun;
    state.workflowRun = completedWorkflowRun;
    await route.fulfill({ json: { run: state.teachingRun } });
  });
  await page.route("**/api/teaching/runs/workflow_run_1/follow-up", async (route) => {
    state.requests.followUp = route.request().postDataJSON() as TeachingFollowUpRequest;
    await route.fulfill({
      json: {
        followUp: {
          runId: "workflow_run_1",
          followUpRunId: "workflow_run_2",
          status: "completed",
          answer: "Start with the changed line, then inspect nearby context.",
          createdAt: teachingNow,
        },
      },
    });
  });
  await page.route("**/api/workflow-runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: state.workflowRun } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1/events*", async (route) => {
    await route.fulfill({ json: { events: [] } });
  });
  await page.route("**/api/reviews/GR-1/teaching/promote", async (route) => {
    const input = route.request().postDataJSON() as TeachingPromotionInput;
    state.requests.promotion = input;
    const thread = createPromotedThread(input, anchor);
    state.threads.splice(0, state.threads.length, thread);
    await route.fulfill({ status: 201, json: { thread } });
  });
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });

  return { anchor, completedRun, file, profile, repository, review, revision, state };
}

function createTeachingDiffFile(revisionId: string): DiffFile {
  return {
    id: "diff_file_2",
    revisionId,
    path: "src/other.ts",
    oldPath: null,
    status: "added",
    isBinary: false,
    additions: 1,
    deletions: 0,
    oldMode: null,
    newMode: null,
    renameMetadata: null,
    hunks: [
      {
        id: "diff_hunk_2",
        fileId: "diff_file_2",
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        header: "@@ -0,0 +1 @@",
        sortOrder: 1,
        lines: [
          {
            type: "addition",
            oldLineNumber: null,
            newLineNumber: 1,
            content: "export const other = true;",
          },
        ],
      },
    ],
  };
}

function createTeachingOutput(anchor: ThreadAnchor): StructuredTeachingOutput {
  return {
    changeSummary: "Mock teaching summary for the full PR.",
    architectureExplanation: "The change adds a small exported value.",
    walkthrough: [
      {
        id: "walkthrough-1",
        title: "Review the exported value",
        body: "Check that the new export matches the surrounding module intent.",
        filePath: "src/other.ts",
        lineNumber: 1,
        anchor,
        excerpts: [
          { kind: "lines", filePath: "src/other.ts", side: "head", startLine: 1, endLine: 1 },
          {
            kind: "lines",
            filePath: "src/other.ts",
            side: "head",
            startLine: 900,
            endLine: 901,
          },
        ],
        diagramId: "diagram-1",
      },
    ],
    quiz: [
      {
        id: "quiz-1",
        prompt: "What should you inspect first?",
        choices: [
          { id: "changed-lines", label: "The changed lines and nearby context" },
          { id: "unrelated-files", label: "Unrelated files outside the review" },
        ],
        correctChoiceId: "changed-lines",
        explanation: "Changed lines keep the teaching scope tied to the review.",
        missedConcept: "Start from the scoped diff context.",
        anchor,
        excerpts: [{ kind: "anchor", anchor }],
      },
      {
        id: "quiz-2",
        prompt: "Who consumes the new export?",
        choices: [
          { id: "nobody-yet", label: "Nobody yet inside this diff" },
          { id: "every-module", label: "Every module in the repository" },
        ],
        correctChoiceId: "nobody-yet",
        explanation: "The diff adds the export without wiring up a consumer.",
        missedConcept: "Trace new exports to their consumers.",
        anchor,
        excerpts: [],
      },
    ],
    missedConcepts: ["Exports are part of the module contract."],
    diagrams: [
      {
        id: "diagram-1",
        title: "Export flow",
        mermaidSource: "flowchart TD\n  A[src/other.ts] --> B[consumers]",
      },
      {
        id: "diagram-2",
        title: "Broken diagram",
        mermaidSource: "this is not mermaid syntax",
      },
    ],
  };
}

function createBaseWorkflowRun(): WorkflowRun {
  return {
    id: "workflow_run_1",
    workflowKind: "teaching_generate",
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    profileId: "profile_teaching",
    harnessKind: "mock-teacher",
    status: "pending_consent",
    phase: "pending_consent",
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
      scopeLabel: "Full PR: 1 changed file",
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
    createdAt: teachingNow,
    updatedAt: teachingNow,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    completedAt: null,
    cancelledAt: null,
    metadata: { workflowFamily: "teaching", teachingScopeKind: "full_pr" },
  };
}

function createPromotedThread(
  input: TeachingPromotionInput,
  fallbackAnchor: ThreadAnchor,
): ThreadWithComments {
  const title = input.title ?? "Teaching point";
  const profileId = input.profileId ?? null;
  return {
    reviewDisplayId: "GR-1",
    shortRef: "GT-1",
    status: "open",
    type: "question",
    severity: null,
    source: {
      kind: "teaching",
      displayName: "Teaching",
      profileId,
      metadata: { title },
    },
    anchor: input.anchor ?? fallbackAnchor,
    anchors: [input.anchor ?? fallbackAnchor],
    remapConfidence: null,
    outdated: false,
    createdAt: teachingNow,
    updatedAt: teachingNow,
    comments: [
      {
        id: "comment_1",
        threadRef: "GT-1",
        parentCommentId: null,
        authorKind: "teaching",
        authorDisplayName: "Teaching",
        body: `${title}\n\n${input.body}`,
        sortOrder: 1,
        createdAt: teachingNow,
        editedAt: null,
      },
    ],
  };
}
