import {
  builtinReviewOutputSchema,
  commentCreateInputSchema,
  threadCreateInputSchema,
  workflowBuiltinReviewDraftOutputSchema,
  type BuiltinReviewOutput,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type Profile,
  type ThreadRef,
  type ThreadAnchor,
  type ThreadCreateInput,
  type ThreadWithComments,
  type WorkflowBuiltinReviewDraftOutput,
  type WorkflowDraftOutput,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
  type WorkflowValidationIssue,
} from "@greenroom/schemas";
import { threadAnchorLineKey as anchorLineKey } from "@greenroom/core";

import { harnessProfileForRequest } from "../api/harness-client";
import type { GreenroomApiServices } from "../api/services";
import {
  buildMcpFirstHarnessRunRequest,
  createHarnessJobMetadataRecorder,
  recordHarnessExecutionMetadata,
  recordHarnessTimeoutBudgetDiagnostics,
} from "./harness-adapter";
import type { WorkflowDefinition, WorkflowEventSink, WorkflowValidDraftContext } from "./types";
import { createCompositeWorkflowValidator, createDraftKindValidator } from "./validators";

const defaultMcpServerUrl = "http://127.0.0.1:49332";
const defaultMcpServerPath = "/mcp";
const defaultWorkflowTimeoutMs = 60 * 60_000;

export interface BuiltinReviewWorkflowDefinitionOptions {
  getServices: () => GreenroomApiServices;
  mcpServerUrl?: string;
  mcpServerPath?: string;
}

export interface BuiltinReviewThreadCreationResult {
  createdThreadRefs: ThreadRef[];
  createdThreadCount: number;
  findingCount: number;
}

export function createBuiltinReviewWorkflowDefinition(
  options: BuiltinReviewWorkflowDefinitionOptions,
): WorkflowDefinition {
  const mcpServerUrl = options.mcpServerUrl ?? defaultMcpServerUrl;
  const mcpServerPath = options.mcpServerPath ?? defaultMcpServerPath;

  return {
    kind: "builtin_review",
    version: "greenroom.builtin-review.v1",
    defaultTimeoutMs: defaultWorkflowTimeoutMs,
    autoRepair: true,
    validator: createCompositeWorkflowValidator([
      createDraftKindValidator("builtin_review_findings"),
      createBuiltinReviewDraftValidator(options.getServices),
    ]),
    // No repairPolicy: the orchestrator applies the configurable default
    // (workflows.maxRepairAttempts / GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS).
    onValidDraft: {
      handle: (context) => handleValidBuiltinReviewDraft(options.getServices(), context),
    },
    metadata: {
      workflowFamily: "builtin_review",
      persistenceOwner: "greenroom_server",
    },
    steps: [
      {
        id: "builtin-review.launch-harness",
        phase: "launching_harness",
        eventType: "harness_launch",
        summary: "Launch MCP-first built-in review harness.",
        async run(context) {
          const services = options.getServices();
          const run = context.run;
          const profile = requireProfile(services, run.profileId);
          const review = services.reviews.getByDisplayId(run.reviewDisplayId);

          if (review === null) {
            throw new Error(`Review ${run.reviewDisplayId} was not found`);
          }

          const repository = services.repositories.get(review.repositoryId);

          if (repository === null) {
            throw new Error(`Repository ${review.repositoryId} was not found`);
          }

          if (profile.provider !== "harness") {
            throw new Error("Built-in review workflow requires a harness profile");
          }

          if (services.harnessClient === null) {
            throw new Error(
              "Harness bridge is unavailable. Configure GREENROOM_HARNESS_BASE_URL and GREENROOM_HARNESS_TOKEN, then check GET /api/harness/status.",
            );
          }

          context.events.record({
            runId: run.id,
            eventType: "harness_launch",
            summary: "Starting MCP-first built-in review harness.",
            metadata: {
              harnessKind: run.harnessKind,
              profileId: profile.id,
              repairAttemptNumber: repairAttemptNumber(run),
            },
          });
          const recordJobUpdate = createHarnessJobMetadataRecorder({
            readRun: () => services.workflowRunner.readRun(run.id),
            updateRunMetadata(latest, metadata) {
              services.workflows.updateStatus(latest.id, {
                status: latest.status,
                metadata,
              });
            },
          });

          const response = await services.harnessClient.run(
            buildMcpFirstHarnessRunRequest({
              run,
              profile: harnessProfileForRequest(profile),
              cwd: repository.rootPath,
              schema: builtinReviewWorkflowDraftJsonSchema,
              mcpServerUrl,
              mcpServerPath,
              mcpGrant: context.mcpGrant,
              promptId: "greenroom_review_prompt",
              outputCapture: "mcp_draft_tool_or_structured_stdout",
              repairAttemptNumber: repairAttemptNumber(run),
              extraInstructions: builtinReviewHarnessInstructions(profile, run),
            }),
            {
              signal: context.signal,
              onEvent: context.activity.recordHarnessEvent,
              onJobUpdate: recordJobUpdate,
            },
          );

          recordHarnessTimeoutBudgetDiagnostics({
            events: context.events,
            run,
            execution: response.execution,
          });
          recordHarnessExecutionMetadata({
            readRun: () => services.workflowRunner.readRun(run.id),
            updateRunMetadata(latest, metadata) {
              services.workflows.updateStatus(latest.id, {
                status: latest.status,
                metadata,
              });
            },
            execution: response.execution,
          });

          const latest = services.workflowRunner.readRun(run.id);

          if (latest !== null && latest.status !== "running") {
            return;
          }

          if (response.output === undefined) {
            throw new Error(
              "Harness completed without returning structured stdout or submitting a draft through MCP",
            );
          }

          context.events.record({
            runId: run.id,
            eventType: "draft_submission",
            summary: "Harness returned built-in review structured stdout draft.",
            metadata: {
              outputCapture: response.execution.outputCapture,
              harnessKind: run.harnessKind,
            },
          });

          return { draftOutput: normalizeBuiltinReviewDraftOutput(response.output) };
        },
      },
    ],
  };
}

export function normalizeBuiltinReviewDraftOutput(
  payload: unknown,
): WorkflowBuiltinReviewDraftOutput {
  return workflowBuiltinReviewDraftOutputSchema.parse(payload);
}

export function builtinReviewOutputFromDraft(
  draft: WorkflowDraftOutput | null,
): BuiltinReviewOutput | null {
  if (draft === null || draft.kind !== "builtin_review_findings") {
    return null;
  }

  return builtinReviewOutputSchema.parse({
    summary: draft.summary,
    findings: draft.findings,
    nonFindings: draft.nonFindings,
  });
}

export function createBuiltinReviewThreadsForDraft(
  services: GreenroomApiServices,
  run: WorkflowRun,
  draft: WorkflowBuiltinReviewDraftOutput,
): BuiltinReviewThreadCreationResult {
  const profile = requireProfile(services, run.profileId);
  const threadInputs = createThreadInputsForFindings(services, profile, run, draft);
  const createdThreads = threadInputs.map((input) => services.threads.create(input));
  const createdThreadRefs = createdThreads.map((thread) => thread.shortRef);

  return {
    createdThreadRefs,
    createdThreadCount: createdThreadRefs.length,
    findingCount: draft.findings.length,
  };
}

export function recordBuiltinReviewPersistenceEvents(input: {
  services: GreenroomApiServices;
  run: WorkflowRun;
  result: BuiltinReviewThreadCreationResult;
  events?: WorkflowEventSink;
}): void {
  const summary =
    input.result.createdThreadCount === 0
      ? "Built-in review completed with no findings"
      : "Built-in review created review threads";
  const metadata = {
    workflowRunId: input.run.id,
    profileId: input.run.profileId,
    harnessKind: input.run.harnessKind,
    findingCount: input.result.findingCount,
    createdThreadCount: input.result.createdThreadCount,
  };

  input.events?.record({
    runId: input.run.id,
    eventType: "persistence",
    summary,
    metadata,
  });
  input.services.agentEvents.create({
    reviewDisplayId: input.run.reviewDisplayId,
    eventType: "status_update",
    source: {
      kind: "system",
      displayName: "Stage Manager",
      metadata: {
        workflowType: "builtin_review",
        workflowRunId: input.run.id,
      },
    },
    threadRefs: input.result.createdThreadRefs,
    summary,
    metadata,
  });
}

function createBuiltinReviewDraftValidator(getServices: () => GreenroomApiServices): {
  validate: (
    context: { run: WorkflowRun },
    draft: WorkflowDraftOutput,
  ) => { issues: WorkflowValidationIssue[] };
} {
  return {
    validate(context, draft) {
      if (draft.kind !== "builtin_review_findings") {
        return { issues: [] };
      }

      const services = getServices();
      const issues: WorkflowValidationIssue[] = [];
      const review = services.reviews.getByDisplayId(context.run.reviewDisplayId);
      const revision = services.reviews.getRevision(context.run.revisionId);

      if (review === null || revision === null || revision.reviewDisplayId !== review.displayId) {
        return {
          issues: [
            validationIssue(
              "review-revision-not-found",
              "Built-in review draft targets a review revision that no longer exists.",
              [],
              false,
            ),
          ],
        };
      }

      if (review.currentRevisionId !== revision.id) {
        issues.push(
          validationIssue(
            "stale-revision",
            "Built-in review findings must target the current review revision.",
            ["revisionId"],
            false,
          ),
        );
      }

      const anchorsByKey = anchorsForRevision(services, review.displayId, revision.id);
      const openThreads = services.threads
        .listByReview(review.id)
        .filter((thread) => thread.status === "open");

      draft.findings.forEach((finding, findingIndex) => {
        const keys = uniqueStrings([finding.anchorKey, ...(finding.anchorKeys ?? [])]);
        const anchors = keys.flatMap((key, keyIndex) => {
          const anchor = anchorsByKey.get(key);

          if (anchor === undefined) {
            issues.push(
              validationIssue(
                "unknown-anchor-key",
                `Finding ${finding.id} references unknown anchor key ${key}.`,
                ["findings", String(findingIndex), keyIndex === 0 ? "anchorKey" : "anchorKeys"],
                true,
                { findingId: finding.id, anchorKey: key },
              ),
            );
            return [];
          }

          return [anchor];
        });
        const primaryAnchor = anchorsByKey.get(finding.anchorKey);

        if (primaryAnchor !== undefined) {
          for (const anchor of anchors) {
            if (
              anchor.filePath !== primaryAnchor.filePath ||
              anchor.oldFilePath !== primaryAnchor.oldFilePath
            ) {
              issues.push(
                validationIssue(
                  "multi-file-finding",
                  `Finding ${finding.id} includes anchors from more than one file.`,
                  ["findings", String(findingIndex), "anchorKeys"],
                  true,
                  { findingId: finding.id },
                ),
              );
              break;
            }
          }

          const duplicate = findDuplicateOpenThread(openThreads, primaryAnchor);

          if (duplicate !== null) {
            issues.push(
              validationIssue(
                "duplicate-open-thread-location",
                `Finding ${finding.id} targets a line that already has open thread ${duplicate.shortRef}.`,
                ["findings", String(findingIndex), "anchorKey"],
                true,
                { findingId: finding.id, shortRef: duplicate.shortRef },
                "warning",
              ),
            );
          }
        }
      });

      return { issues };
    },
  };
}

function handleValidBuiltinReviewDraft(
  services: GreenroomApiServices,
  context: WorkflowValidDraftContext,
) {
  if (context.draft.kind !== "builtin_review_findings") {
    return { disposition: "complete" as const };
  }

  if (context.draft.findings.length === 0) {
    const result = {
      createdThreadRefs: [],
      createdThreadCount: 0,
      findingCount: 0,
    };
    recordBuiltinReviewPersistenceEvents({
      services,
      run: context.run,
      result,
      events: context.events,
    });

    return {
      disposition: "complete" as const,
      finalOutput: context.draft,
      metadata: {
        createdThreadRefs: [],
        createdThreadCount: 0,
        validatedFindingCount: 0,
        threadCreationGateMode: "no_findings",
      },
    };
  }

  const profile = requireProfile(services, context.run.profileId);

  if (!shouldAutoCreateBuiltinReviewThreads(profile)) {
    const summary = "Built-in review draft findings validated and are awaiting approval.";

    context.events.record({
      runId: context.run.id,
      eventType: "validation",
      summary,
      metadata: {
        findingCount: context.draft.findings.length,
        threadCreationGateMode: "draft_approval_required",
      },
    });
    services.agentEvents.create({
      reviewDisplayId: context.run.reviewDisplayId,
      eventType: "status_update",
      source: {
        kind: "system",
        displayName: "Stage Manager",
        metadata: {
          workflowType: "builtin_review",
          workflowRunId: context.run.id,
        },
      },
      threadRefs: [],
      summary,
      metadata: {
        workflowRunId: context.run.id,
        profileId: profile.id,
        harnessKind: context.run.harnessKind,
        findingCount: context.draft.findings.length,
      },
    });

    return {
      disposition: "awaiting_user" as const,
      finalOutput: null,
      summary,
      metadata: {
        createdThreadRefs: [],
        createdThreadCount: 0,
        validatedFindingCount: context.draft.findings.length,
        threadCreationGateMode: "draft_approval_required",
      },
    };
  }

  const result = createBuiltinReviewThreadsForDraft(services, context.run, context.draft);
  recordBuiltinReviewPersistenceEvents({
    services,
    run: context.run,
    result,
    events: context.events,
  });

  return {
    disposition: "complete" as const,
    finalOutput: context.draft,
    metadata: {
      createdThreadRefs: result.createdThreadRefs,
      createdThreadCount: result.createdThreadCount,
      validatedFindingCount: context.draft.findings.length,
      threadCreationGateMode: "auto_create_after_validation",
    },
  };
}

function createThreadInputsForFindings(
  services: GreenroomApiServices,
  profile: Profile,
  run: WorkflowRun,
  draft: WorkflowBuiltinReviewDraftOutput,
): ThreadCreateInput[] {
  const anchorsByKey = anchorsForRevision(services, run.reviewDisplayId, run.revisionId);

  return draft.findings.map((finding) => {
    const primaryAnchor = requireFindingAnchor(anchorsByKey, finding.anchorKey);
    const anchors = uniqueStrings([finding.anchorKey, ...(finding.anchorKeys ?? [])]).map((key) => {
      const anchor = requireFindingAnchor(anchorsByKey, key);

      if (
        anchor.filePath !== primaryAnchor.filePath ||
        anchor.oldFilePath !== primaryAnchor.oldFilePath
      ) {
        throw new Error(`Finding ${finding.id} included anchor ${key} from a different file`);
      }

      return anchor;
    });

    return threadCreateInputSchema.parse({
      reviewDisplayId: run.reviewDisplayId,
      type: finding.type,
      severity: finding.severity,
      source: {
        kind: "builtin_reviewer",
        displayName: profile.name || "Built-in reviewer",
        profileId: profile.id,
        metadata: {
          workflowRunId: run.id,
          builtinReviewRunId: run.id,
          harnessKind: run.harnessKind,
          profileId: profile.id,
          confidence: finding.confidence,
          findingId: finding.id,
        },
      },
      anchor: primaryAnchor,
      anchors,
      firstComment: commentCreateInputSchema.omit({ threadRef: true }).parse({
        authorKind: "builtin_reviewer",
        authorDisplayName: profile.name || "Built-in reviewer",
        body: `${finding.title}\n\n${finding.body}`,
      }),
    });
  });
}

function anchorsForRevision(
  services: GreenroomApiServices,
  reviewDisplayId: WorkflowRun["reviewDisplayId"],
  revisionId: WorkflowRun["revisionId"],
): Map<string, ThreadAnchor> {
  const anchors = new Map<string, ThreadAnchor>();

  for (const file of services.reviews.listDiffFiles(revisionId)) {
    for (const anchor of anchorsForDiffFile(reviewDisplayId, revisionId, file)) {
      anchors.set(anchorLineKey(anchor), anchor);
    }
  }

  return anchors;
}

function anchorsForDiffFile(
  reviewDisplayId: WorkflowRun["reviewDisplayId"],
  revisionId: WorkflowRun["revisionId"],
  file: DiffFile,
): ThreadAnchor[] {
  if (file.isBinary) {
    return [];
  }

  return file.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line, index) => {
      const anchor = anchorForChangedLine(reviewDisplayId, revisionId, file, hunk, line, index);
      return anchor === null ? [] : [anchor];
    }),
  );
}

function anchorForChangedLine(
  reviewDisplayId: WorkflowRun["reviewDisplayId"],
  revisionId: WorkflowRun["revisionId"],
  file: DiffFile,
  hunk: DiffHunk,
  line: DiffLine,
  lineIndex: number,
): ThreadAnchor | null {
  if (line.type === "addition" && line.newLineNumber !== null) {
    return {
      reviewDisplayId,
      revisionId,
      filePath: file.path,
      oldFilePath: file.oldPath,
      side: "head",
      lineNumber: line.newLineNumber,
      lineType: line.type,
      hunkId: hunk.id,
      hunkHeader: hunk.header,
      contextBefore: nearbyContext(hunk.lines, lineIndex, "before"),
      contextAfter: nearbyContext(hunk.lines, lineIndex, "after"),
      originalLineText: line.content,
    };
  }

  if (line.type === "deletion" && line.oldLineNumber !== null) {
    return {
      reviewDisplayId,
      revisionId,
      filePath: file.path,
      oldFilePath: file.oldPath,
      side: "base",
      lineNumber: line.oldLineNumber,
      lineType: line.type,
      hunkId: hunk.id,
      hunkHeader: hunk.header,
      contextBefore: nearbyContext(hunk.lines, lineIndex, "before"),
      contextAfter: nearbyContext(hunk.lines, lineIndex, "after"),
      originalLineText: line.content,
    };
  }

  return null;
}

function nearbyContext(
  lines: readonly DiffLine[],
  lineIndex: number,
  direction: "after" | "before",
): string[] {
  const windowSize = 3;

  if (direction === "before") {
    return lines
      .slice(Math.max(0, lineIndex - windowSize), lineIndex)
      .map((candidate) => candidate.content);
  }

  return lines
    .slice(lineIndex + 1, lineIndex + 1 + windowSize)
    .map((candidate) => candidate.content);
}

function requireFindingAnchor(
  anchorsByKey: ReadonlyMap<string, ThreadAnchor>,
  key: string,
): ThreadAnchor {
  const anchor = anchorsByKey.get(key);

  if (anchor === undefined) {
    throw new Error(`Built-in review provider returned unknown anchor key ${key}`);
  }

  return anchor;
}

function findDuplicateOpenThread(
  threads: readonly ThreadWithComments[],
  anchor: ThreadAnchor,
): ThreadWithComments | null {
  return (
    threads.find((thread) =>
      thread.anchors.some(
        (candidate) =>
          candidate.revisionId === anchor.revisionId &&
          candidate.filePath === anchor.filePath &&
          candidate.oldFilePath === anchor.oldFilePath &&
          candidate.side === anchor.side &&
          candidate.lineType === anchor.lineType &&
          candidate.lineNumber === anchor.lineNumber,
      ),
    ) ?? null
  );
}

function validationIssue(
  code: string,
  message: string,
  path: string[],
  recoverable: boolean,
  metadata: WorkflowRedactedMetadata = {},
  severity: WorkflowValidationIssue["severity"] = "error",
): WorkflowValidationIssue {
  return {
    code,
    message,
    severity,
    path,
    recoverable,
    metadata,
  };
}

function builtinReviewHarnessInstructions(profile: Profile, run: WorkflowRun): string[] {
  const repairContext = run.metadata.lastRepairContext;
  const instructions = [
    "Read the review manifest, changed-file list, existing open threads, anchor registries, and path-scoped file diffs through MCP before submitting findings.",
    "Use only anchor keys returned by Greenroom MCP anchor resources or tools.",
    "Do not call direct thread-write tools such as greenroom_create_thread; Greenroom will create threads only after validation and approval.",
    profile.systemPrompt ??
      "Review the approved diff scope and return concise, actionable findings anchored to changed lines.",
  ];

  if (
    typeof repairContext === "object" &&
    repairContext !== null &&
    "promptSummary" in repairContext &&
    typeof repairContext.promptSummary === "string"
  ) {
    instructions.push(repairContext.promptSummary);
  }

  return instructions;
}

function repairAttemptNumber(run: WorkflowRun): number {
  const value = run.metadata.repairAttemptCount;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Trusted profiles auto-create threads from validated findings; other
 * profiles only do so when they explicitly opt in through profile settings.
 * Invalid findings never reach this gate — they follow the usual repair/fail
 * path without creating threads.
 */
export function shouldAutoCreateBuiltinReviewThreads(profile: Profile): boolean {
  return (
    profile.privacy.consentMode === "trusted" ||
    booleanSetting(profile.contextPreferences, "autoCreateThreads") === true ||
    booleanSetting(profile.contextPreferences, "autoCreateBuiltinReviewThreads") === true ||
    booleanSetting(profile.contextPreferences.builtinReview, "autoCreateThreads") === true ||
    booleanSetting(profile.modelSettings.builtinReview, "autoCreateThreads") === true ||
    booleanSetting(profile.modelSettings.workflow, "autoCreateThreads") === true
  );
}

function booleanSetting(value: unknown, key: string): boolean | null {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "boolean" ? candidate : null;
}

function requireProfile(
  services: GreenroomApiServices,
  profileId: WorkflowRun["profileId"],
): Profile {
  const profile = services.profiles.get(profileId);

  if (profile === null) {
    throw new Error(`Profile ${profileId} was not found`);
  }

  return profile;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export const builtinReviewWorkflowDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "summary", "findings"],
  properties: {
    kind: { type: "string", enum: ["builtin_review_findings"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "body", "type", "severity", "anchorKey", "confidence"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          type: { type: "string", enum: ["question", "issue", "suggestion", "note"] },
          severity: {
            type: ["string", "null"],
            enum: ["blocking", "major", "minor", "nit", null],
          },
          anchorKey: { type: "string" },
          anchorKeys: {
            type: "array",
            maxItems: 200,
            items: { type: "string" },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    nonFindings: {
      type: "array",
      maxItems: 50,
      items: { type: "string" },
    },
  },
};
