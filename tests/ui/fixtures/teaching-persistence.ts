import type {
  DiffFile,
  Profile,
  RevisionSnapshot,
  ThreadAnchor,
  ThreadWithComments,
  WorkflowRun,
  WorkflowRunEvent,
} from "@greenroom/schemas";

import type { Page } from "./playwright";

const now = "2026-07-01T12:00:00.000Z";

export interface TeachingPromotionRequest {
  anchor: ThreadAnchor;
  body: string;
  profileId: string;
  runId: string;
  title: string;
}

export interface TeachingPersistenceState {
  promoteRequest: TeachingPromotionRequest | null;
  threads: ThreadWithComments[];
}

export interface TeachingPersistenceFixture {
  anchor: ThreadAnchor;
  state: TeachingPersistenceState;
}

export async function setupTeachingPersistence(page: Page): Promise<TeachingPersistenceFixture> {
  const longToken = `unbroken-${"teaching".repeat(64)}`;
  const review = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Persisted teaching review",
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: "main" },
      headRef: { kind: "branch", value: "feature/teaching" },
    },
    baseRefDisplay: "main",
    headRefDisplay: "feature/teaching",
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
        id: "diff_hunk_1",
        fileId: "diff_file_1",
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
  const anchor: ThreadAnchor = {
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    filePath: "src/other.ts",
    oldFilePath: null,
    side: "head",
    lineNumber: 1,
    lineType: "addition",
    hunkId: "diff_hunk_1",
    hunkHeader: "@@ -0,0 +1 @@",
    contextBefore: [],
    contextAfter: [],
    originalLineText: "export const other = true;",
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
    privacy: { persistTranscript: false, consentMode: "one_click" },
    createdAt: now,
    updatedAt: now,
  };
  const contextFiles = [
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
  ];
  const teachingOutput = {
    changeSummary: `Persisted teaching summary for the full PR. ${longToken}`,
    architectureExplanation: `The change adds a small exported value. ${longToken}`,
    walkthrough: [
      {
        id: "walkthrough-1",
        title: "Review the exported value",
        body: "Check that the new export matches the surrounding module intent.",
        filePath: "src/other.ts",
        lineNumber: 1,
        anchor,
        excerpts: [],
        diagramId: null,
      },
    ],
    quiz: [
      {
        id: "quiz-1",
        prompt: `What should you inspect first? ${longToken}`,
        choices: [
          {
            id: "changed-lines",
            label: `The changed lines and nearby context ${longToken}`,
          },
          { id: "unrelated-files", label: "Unrelated files outside the review" },
        ],
        correctChoiceId: "changed-lines",
        explanation: `Changed lines keep the teaching scope tied to the review. ${longToken}`,
        missedConcept: `Start from the scoped diff context. ${longToken}`,
        anchor,
        excerpts: [],
      },
    ],
    missedConcepts: [`Exports are part of the module contract. ${longToken}`],
    diagrams: [],
  };
  const teachingContext = {
    review,
    repository,
    revision,
    scope: { kind: "full_pr" },
    files: contextFiles,
    omittedFiles: [],
    spotlightRegions: [],
    omittedRegions: [],
    approximateTokenCount: 240,
    generatedAt: now,
  };
  const teachingRun = {
    id: "workflow_run_1",
    reviewDisplayId: "GR-1",
    profileId: "profile_teaching",
    status: "completed",
    context: teachingContext,
    createdAt: now,
    approvedAt: now,
    completedAt: now,
    errorMessage: null,
    output: teachingOutput,
  };
  const workflowRun: WorkflowRun = {
    id: "workflow_run_1",
    workflowKind: "teaching_generate",
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    profileId: "profile_teaching",
    harnessKind: "mock-teacher",
    status: "completed",
    phase: "completed",
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
        files: [
          {
            path: "src/other.ts",
            oldPath: null,
            status: "added",
            additions: 1,
            deletions: 0,
            isBinary: false,
          },
        ],
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
    finalOutput: { kind: "teaching_draft", ...teachingOutput },
    validationIssues: [],
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    queuedAt: now,
    startedAt: now,
    finishedAt: now,
    completedAt: now,
    cancelledAt: null,
    metadata: { workflowFamily: "teaching", teachingScopeKind: "full_pr" },
  };
  const events: WorkflowRunEvent[] = [
    workflowEvent(1, "lifecycle", "Teaching consent summary created.", {}),
    workflowEvent(2, "persistence", "Teaching draft persisted to workflow output.", {
      walkthroughCount: 1,
      quizQuestionCount: 1,
    }),
    workflowEvent(3, "persistence", "Teaching follow-up answered.", {
      followUpWorkflowRunId: "workflow_run_2",
      question: `Why start there? ${longToken}`,
      answer: `Start with the changed line, then inspect nearby context. ${longToken}`,
    }),
  ];
  const state: TeachingPersistenceState = {
    promoteRequest: null,
    threads: [],
  };

  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });
  await page.route("**/api/reviews/GR-1", async (route) => {
    await route.fulfill({ json: { review, repository, currentRevision: revision } });
  });
  await page.route("**/api/reviews/GR-1/diff", async (route) => {
    await route.fulfill({ json: { review, revision, files: [file] } });
  });
  await page.route("**/api/reviews/GR-1/revisions", async (route) => {
    await route.fulfill({ json: { revisions: [revision] } });
  });
  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    await route.fulfill({ json: { threads: state.threads } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/views", async (route) => {
    await route.fulfill({ json: { views: [] } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: { reviewDisplayId: "GR-1", revisionId: "revision_1", memberships: [] },
    });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [profile] } });
  });
  await page.route(
    (url) => url.pathname.endsWith("/api/workflow-runs") && url.searchParams.has("status"),
    async (route) => {
      await route.fulfill({ json: { runs: [] } });
    },
  );
  await page.route("**/api/reviews/GR-1/workflow-runs", async (route) => {
    await route.fulfill({ json: { runs: [workflowRun] } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: workflowRun } });
  });
  await page.route("**/api/workflow-runs/workflow_run_1/events", async (route) => {
    await route.fulfill({ json: { events } });
  });
  await page.route("**/api/teaching/runs/workflow_run_1", async (route) => {
    await route.fulfill({ json: { run: teachingRun } });
  });
  await page.route("**/api/teaching/runs/workflow_run_1/follow-up", async (route) => {
    const input = route.request().postDataJSON() as { question: string };
    await route.fulfill({
      json: {
        followUp: {
          runId: "workflow_run_1",
          answer: `Post-restart answer to: ${input.question}`,
          createdAt: now,
        },
      },
    });
  });
  await page.route("**/api/reviews/GR-1/teaching/promote", async (route) => {
    const input = route.request().postDataJSON() as TeachingPromotionRequest;
    state.promoteRequest = input;
    const thread: ThreadWithComments = {
      reviewDisplayId: "GR-1",
      shortRef: "GT-1",
      status: "open",
      type: "question",
      severity: null,
      source: {
        kind: "teaching",
        displayName: "Teaching",
        profileId: input.profileId,
        metadata: { title: input.title, teachingRunId: input.runId },
      },
      anchor: input.anchor,
      anchors: [input.anchor],
      remapConfidence: null,
      outdated: false,
      createdAt: now,
      updatedAt: now,
      comments: [
        {
          id: "comment_1",
          threadRef: "GT-1",
          parentCommentId: null,
          authorKind: "teaching",
          authorDisplayName: "Teaching",
          body: `${input.title}\n\n${input.body}`,
          sortOrder: 1,
          createdAt: now,
          editedAt: null,
        },
      ],
    };
    state.threads.splice(0, state.threads.length, thread);
    await route.fulfill({ status: 201, json: { thread } });
  });

  return { anchor, state };
}

function workflowEvent(
  sequenceNumber: number,
  eventType: WorkflowRunEvent["eventType"],
  summary: string,
  metadata: WorkflowRunEvent["metadata"],
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
    metadata,
  };
}
