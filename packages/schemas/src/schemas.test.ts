import { describe, expect, it } from "vitest";

import {
  agentEventCreateInputSchema,
  createHarnessProfileDefaultInput,
  builtinReviewConsentCreateInputSchema,
  builtinReviewOutputSchema,
  builtinReviewRunIdSchema,
  capabilityTokenCreateInputSchema,
  diffFileSchema,
  getHarnessKindDescriptor,
  greenroomHarnessSkillPackageVersion,
  harnessBridgeHealthResponseSchema,
  harnessModelCatalogSchema,
  harnessSetupSmokeResponseSchema,
  harnessSkillInstallResponseSchema,
  harnessRunRequestSchema,
  harnessRunResponseSchema,
  harnessKindFromProfile,
  harnessProfileSettingsSchema,
  harnessRepositoryAccessModeFromProfile,
  harnessRunJobSchema,
  harnessStatusResponseSchema,
  listKnownHarnessKindDescriptors,
  profileCreateInputSchema,
  repositoryCreateInputSchema,
  reviewPrCreateInputSchema,
  threadRefSchema,
  spotlightRunCreateInputSchema,
  spotlightRunSchema,
  spotlightViewCreateInputSchema,
  spotlightViewRegionCreateInputSchema,
  spotlightViewWithRegionsSchema,
  structuredTeachingOutputSchema,
  teachingConsentCreateInputSchema,
  teachingRunIdSchema,
  teachingRunResultSchema,
  threadCreateInputSchema,
  workflowDraftOutputSchema,
  workflowSpotlightMembershipDraftOutputSchema,
  workflowRunCreateInputSchema,
  workflowRunRepairProgressFromMetadata,
  workflowRunSchema,
  workflowRunStatusTransitionSchema,
} from "./index";

const range = {
  kind: "branch_to_branch",
  baseRef: { kind: "branch", value: "main" },
  headRef: { kind: "branch", value: "feature/review" },
} as const;

const anchor = {
  reviewDisplayId: "GR-1",
  revisionId: "revision_1",
  filePath: "src/index.ts",
  oldFilePath: null,
  side: "head",
  lineNumber: 12,
  lineType: "addition",
  hunkId: null,
  hunkHeader: "@@ -1,1 +1,2 @@",
  contextBefore: ["export function main() {"],
  contextAfter: ["}"],
  originalLineText: "  return true;",
} as const;

describe("shared schemas", () => {
  it("validates repository payloads", () => {
    expect(
      repositoryCreateInputSchema.parse({
        rootPath: "/work/project",
        gitCommonDir: "/work/project/.git",
      }),
    ).toMatchObject({ rootPath: "/work/project" });
  });

  it("validates review PR creation payloads", () => {
    expect(
      reviewPrCreateInputSchema.parse({
        repositoryId: "repo_1",
        title: "Feature review",
        range,
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
      }),
    ).toMatchObject({ title: "Feature review" });

    expect(
      reviewPrCreateInputSchema.parse({
        repositoryId: "repo_1",
        title: "Whole repository review",
        range: {
          kind: "whole_repository",
          baseRef: {
            kind: "empty_tree",
            value: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            displayName: "empty repository",
          },
          headRef: { kind: "branch", value: "main" },
        },
        baseRefDisplay: "empty repository",
        headRefDisplay: "main",
      }),
    ).toMatchObject({
      range: {
        kind: "whole_repository",
        baseRef: { kind: "empty_tree" },
      },
    });
  });

  it("represents textual, renamed, and binary diff files", () => {
    const parsed = diffFileSchema.parse({
      id: "diff_file_1",
      revisionId: "revision_1",
      path: "src/new.ts",
      oldPath: "src/old.ts",
      status: "renamed",
      isBinary: false,
      additions: 1,
      deletions: 1,
      oldMode: null,
      newMode: null,
      renameMetadata: {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        similarity: 92,
      },
      hunks: [
        {
          id: "diff_hunk_1",
          fileId: "diff_file_1",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          header: "@@ -1 +1 @@",
          sortOrder: 1,
          lines: [{ type: "addition", oldLineNumber: null, newLineNumber: 1, content: "new" }],
        },
      ],
    });

    expect(parsed.renameMetadata?.similarity).toBe(92);
  });

  it("validates anchored thread creation and global thread refs", () => {
    expect(threadRefSchema.parse("GT-12")).toBe("GT-12");
    expect(() => threadRefSchema.parse("gt-12")).toThrow();
    expect(() => threadRefSchema.parse("GR-12")).toThrow();

    expect(
      threadCreateInputSchema.parse({
        reviewDisplayId: "GR-1",
        type: "issue",
        severity: "major",
        source: { kind: "human", displayName: "Reviewer" },
        anchor,
        anchors: [anchor, { ...anchor, lineNumber: 13, originalLineText: "  return false;" }],
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "This branch misses error handling.",
        },
      }),
    ).toMatchObject({ type: "issue", anchors: [{ lineNumber: 12 }, { lineNumber: 13 }] });
  });

  it("validates profile and agent-event payloads", () => {
    expect(
      profileCreateInputSchema.parse({
        name: "Spotlight",
        workflowType: "spotlight",
        provider: "mock",
        model: "mock-spotlight",
      }),
    ).toMatchObject({ privacy: { persistTranscript: true, consentMode: "one_click" } });

    expect(() =>
      profileCreateInputSchema.parse({
        name: "Removed provider",
        workflowType: "spotlight",
        provider: "openai",
        model: "gpt-5",
      }),
    ).toThrow();

    expect(
      agentEventCreateInputSchema.parse({
        eventType: "attempted_fix",
        source: { kind: "external_agent", displayName: "Codex" },
        threadRefs: ["GT-1"],
        summary: "Attempted to address the requested change.",
      }),
    ).toMatchObject({ metadata: {} });

    expect(
      profileCreateInputSchema.parse({
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "codex",
      }),
    ).toMatchObject({ provider: "harness" });
    const harnessDefault = profileCreateInputSchema.parse(
      createHarnessProfileDefaultInput({
        name: "Default AI review",
        workflowType: "builtin_review",
        kind: "claude-code",
      }),
    );

    expect(harnessDefault).toMatchObject({
      provider: "harness",
      model: "claude-code",
      modelSettings: {
        harness: {
          kind: "claude-code",
          repositoryAccessMode: "mcp_only",
          workspaceStrategy: "git_archive",
        },
      },
    });
    expect(harnessProfileSettingsSchema.parse(harnessDefault.modelSettings.harness)).toMatchObject({
      kind: "claude-code",
      repositoryAccessMode: "mcp_only",
    });
    expect(harnessProfileSettingsSchema.parse({ kind: "claude-code" }).repositoryAccessMode).toBe(
      "mcp_only",
    );
    expect(
      harnessKindFromProfile({
        provider: "harness",
        model: "claude-code",
        modelSettings: harnessDefault.modelSettings,
      }),
    ).toBe("claude-code");
    expect(
      harnessRepositoryAccessModeFromProfile({
        provider: "harness",
        modelSettings: harnessDefault.modelSettings,
      }),
    ).toBe("mcp_only");
  });

  it("describes harness setup capabilities and setup responses", () => {
    const descriptors = listKnownHarnessKindDescriptors();
    const codex = getHarnessKindDescriptor("codex");

    expect(descriptors.map((descriptor) => descriptor.kind)).toEqual([
      "claude-code",
      "codex",
      "pi",
    ]);
    expect(getHarnessKindDescriptor("pi")).toMatchObject({
      label: "Pi",
      supportsStructuredOutput: true,
      cli: { commands: ["pi"], versionArgs: ["--version"] },
      skillSupport: { mode: "inline_prompt", packageName: null },
      mcp: { expectation: "not_supported" },
      smokeTest: { supported: true, mode: "bridge_run", workflowKind: "setup_smoke" },
    });
    expect(codex).toMatchObject({
      label: "Codex",
      defaultModelDisplay: "Codex CLI default",
      supportsStructuredOutput: true,
      supportsStreaming: true,
      supportedWorkflows: ["teaching", "spotlight", "builtin_review"],
      skillSupport: {
        mode: "managed_package",
        expectedVersion: greenroomHarnessSkillPackageVersion,
      },
      mcp: { expectation: "required" },
      smokeTest: { supported: true, workflowKind: "setup_smoke" },
    });

    if (codex === null) {
      throw new Error("Codex descriptor is missing");
    }

    const codexAvailable = {
      kind: codex.kind,
      label: codex.label,
      defaultModel: codex.defaultModel,
      defaultModelDisplay: codex.defaultModelDisplay,
      supportedWorkflows: codex.supportedWorkflows,
      skillSupport: codex.skillSupport,
      mcp: codex.mcp,
      smokeTest: codex.smokeTest,
    };

    expect(
      harnessBridgeHealthResponseSchema.parse({
        status: "ok",
        runtimeMode: "bridge",
        defaultKind: "codex",
        commandConfigured: true,
        availableKinds: [{ kind: "codex", label: "Codex", commandConfigured: true }],
        pathMappings: 1,
        capabilities: ["run_jobs", "heartbeat", "repository_snapshot_git_archive"],
      }),
    ).toMatchObject({
      capabilities: ["run_jobs", "heartbeat", "repository_snapshot_git_archive"],
    });
    expect(
      harnessBridgeHealthResponseSchema.parse({
        status: "ok",
        runtimeMode: "bridge",
        defaultKind: null,
        commandConfigured: false,
        availableKinds: [],
        pathMappings: 0,
      }).capabilities,
    ).toEqual([]);

    expect(
      harnessStatusResponseSchema.parse({
        configured: false,
        baseUrl: null,
        healthy: false,
        runtimeMode: "disabled",
        availableKinds: [],
        harnesses: [
          {
            ...codexAvailable,
            cli: {
              status: "missing",
              path: null,
              version: null,
              message: "Codex CLI was not found on PATH.",
            },
            bridge: { configured: false, commandConfigured: false },
            skill: {
              skillMode: "managed_package",
              status: "missing",
              packageName: "greenroom",
              expectedVersion: greenroomHarnessSkillPackageVersion,
              installedVersion: null,
              path: "/tmp/greenroom",
              diagnostics: ["Greenroom skill is missing."],
            },
            mcpSetup: {
              status: "unknown",
              smokeResource: "greenroom://setup/smoke",
              diagnostics: ["Install Codex before checking Greenroom MCP visibility."],
            },
          },
        ],
        errorMessage: "Harness bridge is not configured",
      }),
    ).toMatchObject({
      harnesses: [{ kind: "codex", skill: { status: "missing" } }],
    });

    expect(
      harnessSkillInstallResponseSchema.parse({
        kind: "codex",
        installed: true,
        skill: {
          skillMode: "managed_package",
          status: "current",
          packageName: "greenroom",
          expectedVersion: greenroomHarnessSkillPackageVersion,
          installedVersion: greenroomHarnessSkillPackageVersion,
          path: "/tmp/greenroom",
          diagnostics: ["Greenroom skill is current."],
        },
      }),
    ).toMatchObject({ installed: true });

    expect(
      harnessSetupSmokeResponseSchema.parse({
        workflowKind: "setup_smoke",
        harnessKind: "codex",
        status: "failed",
        message: "Harness bridge is not configured.",
        checks: [{ name: "harness", status: "failed", summary: "Bridge not configured." }],
        diagnostics: ["No credentials were read or stored."],
      }),
    ).toMatchObject({ status: "failed" });
  });

  it("validates harness model catalogs and reasoning selections", () => {
    expect(
      harnessModelCatalogSchema.parse({
        kind: "codex",
        source: "live",
        refreshedAt: "2026-07-18T12:00:00.000Z",
        models: [
          {
            id: "gpt-5",
            label: "GPT-5",
            isDefault: true,
            reasoningLevels: [{ id: "high", label: "High" }],
          },
        ],
      }),
    ).toMatchObject({ diagnostics: [], models: [{ reasoningLevels: [{ id: "high" }] }] });
    expect(
      harnessProfileSettingsSchema.parse({ kind: "codex", reasoningLevel: "high" }),
    ).toMatchObject({ kind: "codex", reasoningLevel: "high" });
  });

  it("validates harness bridge and built-in review payloads", () => {
    const request = harnessRunRequestSchema.parse({
      workflow: "builtin_review",
      runId: "workflow_run_1",
      profile: {
        id: "profile_1",
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "codex",
      },
      cwd: "/work/project",
      prompt: "Approved context",
      schema: { type: "object" },
    });

    expect(request.metadata).toEqual({});
    expect(request.mcp).toBeNull();
    expect(request.outputCapture).toBe("structured_stdout");
    expect(request.repositoryAccess).toEqual({ mode: "mcp_only" });
    expect(
      harnessRunRequestSchema.parse({
        ...request,
        runId: "workflow_run_1",
        mcp: {
          serverUrl: "http://127.0.0.1:49332",
          tokenRef: "token_1",
          token: "grt_test_schema_run_token_123456789",
          allowedTools: ["greenroom_submit_review_findings_draft"],
          allowedResources: ["greenroom://runs/workflow_run_1/output-schema"],
        },
        outputMode: "builtin_review_findings",
        outputCapture: "mcp_draft_tool_or_structured_stdout",
        expectedSkillVersion: greenroomHarnessSkillPackageVersion,
        promptId: "greenroom_review_prompt",
        repairAttemptNumber: 1,
      }),
    ).toMatchObject({
      mcp: { serverPath: "/mcp", tokenRef: "token_1" },
      outputMode: "builtin_review_findings",
      outputCapture: "mcp_draft_tool_or_structured_stdout",
      repairAttemptNumber: 1,
    });
    expect(
      harnessRunRequestSchema.parse({
        ...request,
        repositoryAccess: {
          mode: "snapshot_readonly",
          sourceRepositoryPath: "/work/project",
          revisionId: "revision_1",
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
        },
      }),
    ).toMatchObject({
      repositoryAccess: {
        mode: "snapshot_readonly",
        workspaceStrategy: "git_archive",
      },
    });
    expect(
      harnessRunResponseSchema.parse({
        workflow: "builtin_review",
        runId: "workflow_run_1",
        status: "completed",
        output: { summary: "Done", findings: [] },
        execution: {
          command: "codex",
          exitCode: 0,
          durationMs: 10,
        },
      }),
    ).toMatchObject({ execution: { repositoryChanged: false } });
    const mcpDraftResponse = harnessRunResponseSchema.parse({
      workflow: "builtin_review",
      runId: "workflow_run_1",
      status: "completed",
      execution: {
        command: "claude --mcp-config /tmp/mcp.json",
        exitCode: 0,
        durationMs: 10,
        outputCapture: "mcp_draft_tool",
      },
    });
    expect(mcpDraftResponse.status).toBe("completed");
    expect(mcpDraftResponse.output).toBeUndefined();
    expect(
      harnessRunJobSchema.parse({
        id: "harness_job_1",
        runId: "workflow_run_1",
        workflow: "builtin_review",
        status: "running",
        streaming: "structured",
        submittedAt: "2026-06-25T12:00:00.000Z",
        startedAt: "2026-06-25T12:00:00.000Z",
        finishedAt: null,
        lastEventSequence: 0,
        result: null,
        errorMessage: null,
      }),
    ).toMatchObject({
      lastHeartbeatAt: null,
      lastProcessSeenAt: null,
      heartbeatIntervalMs: null,
      cancelRequestedAt: null,
    });
    expect(
      builtinReviewConsentCreateInputSchema.parse({
        profileId: "profile_1",
      }),
    ).toMatchObject({ maxApproximateTokens: 24000 });
    expect(
      builtinReviewOutputSchema.parse({
        summary: "No findings.",
        findings: [],
      }),
    ).toMatchObject({ findings: [] });
  });

  it("validates teaching consent, run, and structured output payloads", () => {
    const output = structuredTeachingOutputSchema.parse({
      changeSummary: "This review adds a small feature.",
      architectureExplanation: "The change is isolated to the API layer.",
      walkthrough: [
        {
          id: "walkthrough-1",
          title: "API route",
          body: "Start by reading the changed handler.",
          filePath: "src/index.ts",
          lineNumber: 12,
          anchor,
        },
      ],
      quiz: [
        {
          id: "quiz-1",
          prompt: "Where should you start?",
          choices: [
            { id: "diff", label: "The changed diff line" },
            { id: "global", label: "Unrelated global files" },
          ],
          correctChoiceId: "diff",
          explanation: "The changed line anchors the review.",
          missedConcept: "Scope review context first.",
          anchor,
        },
      ],
      missedConcepts: ["Scope review context first."],
    });

    // Older persisted outputs lack diagrams/excerpts/diagramId and
    // must keep parsing with defaults.
    expect(output.diagrams).toEqual([]);
    expect(output.walkthrough[0]).toMatchObject({ excerpts: [], diagramId: null });
    expect(output.quiz[0]).toMatchObject({ excerpts: [] });

    const extended = structuredTeachingOutputSchema.parse({
      changeSummary: "This review adds a small feature.",
      architectureExplanation: "The change is isolated to the API layer.",
      walkthrough: [
        {
          id: "walkthrough-1",
          title: "API route",
          body: "Start by reading the changed handler.",
          filePath: "src/index.ts",
          lineNumber: 12,
          anchor: null,
          diagramId: "diagram-1",
          excerpts: [
            { kind: "anchor", anchor },
            { kind: "lines", filePath: "src/index.ts", startLine: 10, endLine: 24 },
          ],
        },
      ],
      quiz: [
        {
          id: "quiz-1",
          prompt: "Where should you start?",
          choices: [
            { id: "diff", label: "The changed diff line" },
            { id: "global", label: "Unrelated global files" },
          ],
          correctChoiceId: "diff",
          explanation: "The changed line anchors the review.",
          missedConcept: "Scope review context first.",
          anchor: null,
          excerpts: [
            { kind: "lines", filePath: "src/index.ts", side: "base", startLine: 3, endLine: 3 },
          ],
        },
      ],
      missedConcepts: ["Scope review context first."],
      diagrams: [
        {
          id: "diagram-1",
          title: "Request flow",
          mermaidSource: "graph TD; A[Request] --> B[Handler];",
        },
      ],
    });

    expect(extended.diagrams[0]).toMatchObject({ id: "diagram-1", title: "Request flow" });
    expect(extended.walkthrough[0]?.diagramId).toBe("diagram-1");
    // Line excerpts default side to head.
    expect(extended.walkthrough[0]?.excerpts[1]).toMatchObject({ kind: "lines", side: "head" });
    expect(extended.quiz[0]?.excerpts[0]).toMatchObject({ kind: "lines", side: "base" });

    const withExcerpts = (excerpt: unknown) => ({
      ...extended,
      walkthrough: [{ ...extended.walkthrough[0], excerpts: [excerpt] }],
    });

    // Line excerpts must be ordered, bounded ranges on known-shape paths.
    expect(() =>
      structuredTeachingOutputSchema.parse(
        withExcerpts({ kind: "lines", filePath: "src/index.ts", startLine: 24, endLine: 10 }),
      ),
    ).toThrow(/endLine >= startLine/);
    expect(() =>
      structuredTeachingOutputSchema.parse(
        withExcerpts({ kind: "lines", filePath: "src/index.ts", startLine: 1, endLine: 300 }),
      ),
    ).toThrow(/at most 200 lines/);
    expect(() =>
      structuredTeachingOutputSchema.parse(
        withExcerpts({ kind: "snippet", filePath: "src/index.ts" }),
      ),
    ).toThrow();
    // Excerpt counts are capped (4 per walkthrough point, 2 per quiz question).
    expect(() =>
      structuredTeachingOutputSchema.parse({
        ...extended,
        walkthrough: [
          {
            ...extended.walkthrough[0],
            excerpts: Array.from({ length: 5 }, () => ({
              kind: "lines",
              filePath: "src/index.ts",
              startLine: 1,
              endLine: 2,
            })),
          },
        ],
      }),
    ).toThrow();
    // Mermaid source is size-capped.
    expect(() =>
      structuredTeachingOutputSchema.parse({
        ...extended,
        diagrams: [{ id: "diagram-1", title: "Too big", mermaidSource: "a".repeat(6001) }],
      }),
    ).toThrow();

    expect(
      teachingConsentCreateInputSchema.parse({
        profileId: "profile_1",
        revisionId: "revision_1",
        scope: { kind: "spotlight_view", viewRef: "SV-1" },
      }),
    ).toMatchObject({
      scope: { kind: "spotlight_view", viewRef: "SV-1" },
      maxApproximateTokens: 16000,
    });
    expect(
      teachingRunResultSchema.parse({
        id: "workflow_run_1",
        reviewDisplayId: "GR-1",
        profileId: "profile_1",
        status: "completed",
        context: {
          review: {
            displayId: "GR-1",
            repositoryId: "repo_1",
            title: "Teaching review",
            range,
            baseRefDisplay: "main",
            headRefDisplay: "feature/review",
            currentRevisionId: "revision_1",
            status: "open",
            createdAt: "2026-06-25T12:00:00.000Z",
            updatedAt: "2026-06-25T12:00:00.000Z",
          },
          repository: {
            id: "repo_1",
            rootPath: "/work/project",
            gitCommonDir: "/work/project/.git",
            identityKey: "/work/project/.git",
            displayName: "project",
            defaultBranchCandidate: null,
            lastOpenedAt: null,
            createdAt: "2026-06-25T12:00:00.000Z",
            updatedAt: "2026-06-25T12:00:00.000Z",
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
            createdAt: "2026-06-25T12:00:00.000Z",
          },
          files: [
            {
              path: "src/index.ts",
              oldPath: null,
              status: "modified",
              isBinary: false,
              additions: 1,
              deletions: 0,
              hunks: [
                {
                  header: "@@ -1,1 +1,2 @@",
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 2,
                  lines: [
                    {
                      type: "addition",
                      oldLineNumber: null,
                      newLineNumber: 12,
                      content: "  return true;",
                    },
                  ],
                },
              ],
              approximateTokenCount: 24,
            },
          ],
          omittedFiles: [],
          approximateTokenCount: 100,
          generatedAt: "2026-06-25T12:00:00.000Z",
        },
        createdAt: "2026-06-25T12:00:00.000Z",
        approvedAt: "2026-06-25T12:01:00.000Z",
        completedAt: "2026-06-25T12:02:00.000Z",
        errorMessage: null,
        output,
      }),
    ).toMatchObject({ status: "completed" });
  });

  it("rejects non-workflow run id prefixes", () => {
    expect(teachingRunIdSchema.safeParse("teach_run_1").success).toBe(false);
    expect(builtinReviewRunIdSchema.safeParse("review_run_1").success).toBe(false);
    expect(teachingRunIdSchema.safeParse("workflow_run_1").success).toBe(true);
    expect(builtinReviewRunIdSchema.safeParse("workflow_run_1").success).toBe(true);
  });

  it("validates Spotlight view, region, and run contracts", () => {
    const runInput = spotlightRunCreateInputSchema.parse({
      reviewDisplayId: "GR-1",
      type: "generate",
      trigger: "manual",
      gated: true,
      revisionId: "revision_1",
      profileId: "profile_1",
    });
    const viewInput = spotlightViewCreateInputSchema.parse({
      reviewDisplayId: "GR-1",
      title: "API contract",
      description: "Groups the API schema changes that define the feature surface.",
      intent: "feature",
      orderIndex: 0,
      originRunId: "spotlight_run_1",
      lastReconciledRevisionId: "revision_1",
    });
    const regionInput = spotlightViewRegionCreateInputSchema.parse({
      viewRef: "SV-1",
      filePath: "src/index.ts",
      oldPath: null,
      anchors: [anchor],
      remapConfidence: 0.98,
    });

    expect(runInput).toMatchObject({
      status: "pending_consent",
      approvedOutline: null,
      errorMessage: null,
    });
    expect(viewInput).toMatchObject({ health: "current" });
    expect(regionInput).toMatchObject({ stale: false });
    expect(
      spotlightRunSchema.parse({
        ...runInput,
        id: "spotlight_run_1",
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:00.000Z",
        completedAt: null,
      }),
    ).toMatchObject({ id: "spotlight_run_1" });
    expect(
      spotlightViewWithRegionsSchema.parse({
        ...viewInput,
        displayRef: "SV-1",
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:00.000Z",
        regions: [
          {
            ...regionInput,
            id: "spotlight_region_1",
          },
        ],
      }),
    ).toMatchObject({ regions: [{ anchors: [{ lineNumber: 12 }] }] });
    expect(
      workflowSpotlightMembershipDraftOutputSchema.parse({
        kind: "spotlight_membership",
        memberships: [
          {
            viewKey: "implementation",
            filePaths: ["src/index.ts"],
          },
        ],
      }),
    ).toMatchObject({
      memberships: [{ viewKey: "implementation", anchorKeys: [], filePaths: ["src/index.ts"] }],
      uncoveredAnchorKeys: [],
      uncoveredFiles: [],
    });
    expect(() =>
      spotlightViewRegionCreateInputSchema.parse({
        viewRef: "SV-1",
        filePath: "src/other.ts",
        oldPath: null,
        anchors: [anchor],
      }),
    ).toThrow();
  });

  it("validates capability token payloads", () => {
    expect(
      capabilityTokenCreateInputSchema.parse({
        name: "Read token",
        scopes: ["read", "comment:write"],
      }),
    ).toMatchObject({ scopes: ["read", "comment:write"] });

    expect(() =>
      capabilityTokenCreateInputSchema.parse({
        name: "Duplicate scopes",
        scopes: ["read", "read"],
      }),
    ).toThrow();
  });

  it("validates workflow run contracts and rejects malformed workflow payloads", () => {
    const consentSummary = {
      workflowKind: "builtin_review",
      selectedHarness: "claude-code",
      profile: {
        id: "profile_1",
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
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
          },
        ],
      },
      allowedMcpCapabilities: ["review:read", "diff:read", "draft:submit"],
      expectedOutputMode: "builtin_review_findings",
    } as const;

    const runInput = workflowRunCreateInputSchema.parse({
      workflowKind: "builtin_review",
      revisionId: "revision_1",
      profileId: "profile_1",
      harnessKind: "claude-code",
      consentSummary,
    });
    const draft = workflowDraftOutputSchema.parse({
      kind: "builtin_review_findings",
      summary: "Reviewed one changed file.",
      findings: [
        {
          id: "finding-1",
          title: "Missing null handling",
          body: "The changed branch returns before validating this nullable value.",
          type: "issue",
          severity: "major",
          anchorKey: "src/index.ts:head:12",
          confidence: 0.9,
        },
      ],
    });

    expect(runInput).toMatchObject({
      status: "pending_consent",
      phase: "pending_consent",
      metadata: {},
      consentSummary: {
        repositoryAccess: {
          mode: "mcp_only",
          readScopeLabel: "Greenroom MCP context only",
        },
      },
    });
    expect(draft).toMatchObject({ findings: [{ anchorKey: "src/index.ts:head:12" }] });
    expect(
      workflowRunSchema.parse({
        ...runInput,
        id: "workflow_run_1",
        reviewDisplayId: "GR-1",
        approvedScope: null,
        draftOutput: draft,
        finalOutput: null,
        validationIssues: [],
        errorMessage: null,
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:00.000Z",
        queuedAt: null,
        startedAt: null,
        finishedAt: null,
        completedAt: null,
        cancelledAt: null,
      }),
    ).toMatchObject({ id: "workflow_run_1", draftOutput: { kind: "builtin_review_findings" } });

    expect(() =>
      workflowRunStatusTransitionSchema.parse({ from: "completed", to: "running" }),
    ).toThrow();
    expect(() =>
      workflowRunCreateInputSchema.parse({
        workflowKind: "unknown_workflow",
        revisionId: "revision_1",
        profileId: "profile_1",
        harnessKind: "claude-code",
        consentSummary,
      }),
    ).toThrow();
    expect(() =>
      workflowRunSchema.parse({
        ...runInput,
        id: "workflow_run_1",
        reviewDisplayId: "GR-1",
        approvedScope: null,
        draftOutput: null,
        finalOutput: null,
        validationIssues: [],
        errorMessage: "x".repeat(4001),
        createdAt: "2026-06-25T12:00:00.000Z",
        updatedAt: "2026-06-25T12:00:00.000Z",
        queuedAt: null,
        startedAt: null,
        finishedAt: null,
        completedAt: null,
        cancelledAt: null,
      }),
    ).toThrow();
    expect(() =>
      workflowDraftOutputSchema.parse({
        kind: "spotlight_membership",
        memberships: [
          {
            viewKey: "api-contract",
            anchorKeys: Array.from(
              { length: 501 },
              (_, index) => `GR-1:revision_1:src/index.ts::head:addition:${index + 1}`,
            ),
          },
        ],
      }),
    ).toThrow();
  });

  it("derives repair attempt N of M progress from run metadata", () => {
    expect(workflowRunRepairProgressFromMetadata({})).toBeNull();
    expect(workflowRunRepairProgressFromMetadata({ repairAttemptCount: 1 })).toBeNull();
    expect(
      workflowRunRepairProgressFromMetadata({ repairAttemptCount: 0, maxRepairAttempts: 2 }),
    ).toBeNull();

    expect(
      workflowRunRepairProgressFromMetadata({
        repairAttemptCount: 1,
        maxRepairAttempts: 2,
        repairAttempts: [
          {
            attemptNumber: 1,
            issueCodes: ["unknown-anchor-key"],
            createdAt: "2026-06-25T12:00:00.000Z",
          },
          { malformed: true },
        ],
      }),
    ).toEqual({
      attemptNumber: 1,
      maxAttempts: 2,
      attempts: [
        {
          attemptNumber: 1,
          issueCodes: ["unknown-anchor-key"],
          createdAt: "2026-06-25T12:00:00.000Z",
        },
      ],
    });
  });
});
