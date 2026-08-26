import {
  type HarnessStreamEvent,
  workflowSpotlightMembershipDraftOutputSchema,
  workflowSpotlightOutlineDraftOutputSchema,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type Profile,
  type ReviewDisplayId,
  type RevisionId,
  type ThreadAnchor,
  type WorkflowDraftOutput,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
  type WorkflowSpotlightMembershipDraftOutput,
  type WorkflowSpotlightOutlineDraftOutput,
  type WorkflowValidationIssue,
} from "@greenroom/schemas";
import { threadAnchorLineKey as anchorLineKey } from "@greenroom/core";

import {
  createProviderSpotlightMembershipWorkflowDraft,
  createProviderSpotlightOutlineWorkflowDraft,
  markSpotlightOutlineWorkflowReady,
  markSpotlightWorkflowFailed,
  persistSpotlightMembershipWorkflowDraft,
} from "../api/spotlight";
import { harnessProfileForRequest } from "../api/harness-client";
import type { GreenroomApiServices } from "../api/services";
import {
  buildMcpFirstHarnessRunRequest,
  createHarnessJobMetadataRecorder,
  recordHarnessExecutionMetadata,
  recordHarnessTimeoutBudgetDiagnostics,
} from "./harness-adapter";
import type { WorkflowDefinition, WorkflowEventSink, WorkflowValidationContext } from "./types";
import { createCompositeWorkflowValidator, createDraftKindValidator } from "./validators";

const defaultMcpServerUrl = "http://127.0.0.1:49332";
const defaultMcpServerPath = "/mcp";
const defaultWorkflowTimeoutMs = 60 * 60_000;

export interface SpotlightWorkflowDefinitionOptions {
  getServices: () => GreenroomApiServices;
  mcpServerUrl?: string;
  mcpServerPath?: string;
}

export function createSpotlightWorkflowDefinitions(
  options: SpotlightWorkflowDefinitionOptions,
): WorkflowDefinition[] {
  const mcpServerUrl = options.mcpServerUrl ?? defaultMcpServerUrl;
  const mcpServerPath = options.mcpServerPath ?? defaultMcpServerPath;

  return [
    createSpotlightOutlineWorkflowDefinition({
      ...options,
      kind: "spotlight_plan",
      version: "greenroom.spotlight-plan.v1",
      mcpServerUrl,
      mcpServerPath,
    }),
    createSpotlightOutlineWorkflowDefinition({
      ...options,
      kind: "spotlight_refine",
      version: "greenroom.spotlight-refine.v1",
      mcpServerUrl,
      mcpServerPath,
    }),
    {
      kind: "spotlight_membership",
      version: "greenroom.spotlight-membership.v1",
      defaultTimeoutMs: defaultWorkflowTimeoutMs,
      autoRepair: true,
      validator: createCompositeWorkflowValidator([
        createDraftKindValidator("spotlight_membership"),
        createSpotlightMembershipDraftValidator(options.getServices),
      ]),
      onValidDraft: {
        handle(context) {
          if (context.draft.kind !== "spotlight_membership") {
            return { disposition: "complete" as const };
          }

          const result = persistSpotlightMembershipWorkflowDraft(
            options.getServices(),
            context.run,
            context.draft,
          );

          context.events.record({
            runId: context.run.id,
            eventType: "persistence",
            summary: "Spotlight membership persisted to Spotlight views.",
            metadata: {
              spotlightRunId: result.spotlightRunId,
              persistedViewCount: result.viewCount,
              persistedRegionCount: result.regionCount,
            },
          });

          return {
            disposition: "complete" as const,
            finalOutput: context.draft,
            metadata: {
              spotlightRunId: result.spotlightRunId,
              persistedViewCount: result.viewCount,
              persistedRegionCount: result.regionCount,
            },
          };
        },
      },
      onFailure: {
        handle(context) {
          markSpotlightWorkflowFailed(options.getServices(), context.run, context.errorMessage);
        },
      },
      metadata: {
        workflowFamily: "spotlight",
        persistenceOwner: "greenroom_server",
        spotlightStage: "membership",
      },
      steps: [
        {
          id: "spotlight-membership.launch-harness",
          phase: "launching_harness",
          eventType: "harness_launch",
          summary: "Launch MCP-first Spotlight membership harness.",
          async run(context) {
            const services = options.getServices();
            const profile = requireProfile(services, context.run.profileId);

            if (profile.provider !== "harness") {
              return {
                draftOutput: await createProviderSpotlightMembershipWorkflowDraft(
                  services,
                  context.run,
                ),
              };
            }

            return launchSpotlightHarness({
              services,
              run: context.run,
              events: context.events,
              profile,
              mcpServerUrl,
              mcpServerPath,
              mcpGrant: context.mcpGrant,
              signal: context.signal,
              onHarnessEvent: context.activity.recordHarnessEvent,
              schema: spotlightMembershipWorkflowDraftJsonSchema,
              promptId: "greenroom_spotlight_membership_prompt",
              extraInstructions: spotlightMembershipHarnessInstructions(profile, context.run),
              normalize: (payload, run) =>
                normalizeSpotlightMembershipDraftOutput(payload, run, services),
            });
          },
        },
      ],
    },
  ];
}

function createSpotlightOutlineWorkflowDefinition(input: {
  getServices: () => GreenroomApiServices;
  kind: "spotlight_plan" | "spotlight_refine";
  version: string;
  mcpServerUrl: string;
  mcpServerPath: string;
}): WorkflowDefinition {
  return {
    kind: input.kind,
    version: input.version,
    defaultTimeoutMs: defaultWorkflowTimeoutMs,
    autoRepair: true,
    validator: createCompositeWorkflowValidator([
      createDraftKindValidator("spotlight_outline"),
      createSpotlightOutlineDraftValidator(input.getServices),
    ]),
    onValidDraft: {
      handle(context) {
        if (context.draft.kind !== "spotlight_outline") {
          return { disposition: "complete" as const };
        }

        context.events.record({
          runId: context.run.id,
          eventType: "validation",
          summary: "Spotlight outline draft validated and is awaiting plan approval.",
          metadata: {
            spotlightRunId: stringMetadata(context.run.metadata, "spotlightRunId"),
            outlineCount: context.draft.views.length,
          },
        });
        const spotlightRun = markSpotlightOutlineWorkflowReady(input.getServices(), context.run);

        return {
          disposition: spotlightRun.gated ? ("awaiting_user" as const) : ("complete" as const),
          finalOutput: spotlightRun.gated ? null : context.draft,
          summary: spotlightRun.gated
            ? "Spotlight outline draft validated and is awaiting plan approval."
            : "Spotlight outline draft validated and membership generation started.",
          metadata: {
            spotlightRunId: stringMetadata(context.run.metadata, "spotlightRunId"),
            outlineCount: context.draft.views.length,
            spotlightOutlineKeys: context.draft.views.map((view) => view.key),
            spotlightRunStatus: spotlightRun.status,
          },
        };
      },
    },
    onFailure: {
      handle(context) {
        markSpotlightWorkflowFailed(input.getServices(), context.run, context.errorMessage);
      },
    },
    metadata: {
      workflowFamily: "spotlight",
      persistenceOwner: "greenroom_server",
      spotlightStage: input.kind === "spotlight_plan" ? "plan" : "refine",
    },
    steps: [
      {
        id: `${input.kind}.launch-harness`,
        phase: "launching_harness",
        eventType: "harness_launch",
        summary:
          input.kind === "spotlight_plan"
            ? "Launch MCP-first Spotlight outline harness."
            : "Launch MCP-first Spotlight outline refinement harness.",
        async run(context) {
          const services = input.getServices();
          const profile = requireProfile(services, context.run.profileId);

          if (profile.provider !== "harness") {
            return {
              draftOutput: await createProviderSpotlightOutlineWorkflowDraft(services, context.run),
            };
          }

          return launchSpotlightHarness({
            services,
            run: context.run,
            events: context.events,
            profile,
            mcpServerUrl: input.mcpServerUrl,
            mcpServerPath: input.mcpServerPath,
            mcpGrant: context.mcpGrant,
            signal: context.signal,
            onHarnessEvent: context.activity.recordHarnessEvent,
            schema: spotlightOutlineWorkflowDraftJsonSchema,
            promptId: "greenroom_spotlight_plan_prompt",
            extraInstructions: spotlightOutlineHarnessInstructions(profile, context.run),
            normalize: normalizeSpotlightOutlineDraftOutput,
          });
        },
      },
    ],
  };
}

async function launchSpotlightHarness<TDraft extends WorkflowDraftOutput>(input: {
  services: GreenroomApiServices;
  run: WorkflowRun;
  events: WorkflowEventSink;
  profile: Profile;
  mcpServerUrl: string;
  mcpServerPath: string;
  mcpGrant: Parameters<typeof buildMcpFirstHarnessRunRequest>[0]["mcpGrant"];
  signal: AbortSignal;
  onHarnessEvent: (event: HarnessStreamEvent) => void;
  schema: Record<string, unknown>;
  promptId: string;
  extraInstructions: readonly string[];
  normalize: (payload: unknown, run: WorkflowRun) => TDraft;
}): Promise<{ draftOutput?: TDraft } | void> {
  const review = input.services.reviews.getByDisplayId(input.run.reviewDisplayId);

  if (review === null) {
    throw new Error(`Review ${input.run.reviewDisplayId} was not found`);
  }

  const repository = input.services.repositories.get(review.repositoryId);

  if (repository === null) {
    throw new Error(`Repository ${review.repositoryId} was not found`);
  }

  if (input.services.harnessClient === null) {
    throw new Error(
      "Harness bridge is unavailable. Configure GREENROOM_HARNESS_BASE_URL and GREENROOM_HARNESS_TOKEN, then check GET /api/harness/status.",
    );
  }

  const recordJobUpdate = createHarnessJobMetadataRecorder({
    readRun: () => input.services.workflowRunner.readRun(input.run.id),
    updateRunMetadata(latest, metadata) {
      input.services.workflows.updateStatus(latest.id, {
        status: latest.status,
        metadata,
      });
    },
  });

  const response = await input.services.harnessClient.run(
    buildMcpFirstHarnessRunRequest({
      run: input.run,
      profile: harnessProfileForRequest(input.profile),
      cwd: repository.rootPath,
      schema: input.schema,
      mcpServerUrl: input.mcpServerUrl,
      mcpServerPath: input.mcpServerPath,
      mcpGrant: input.mcpGrant,
      promptId: input.promptId,
      outputCapture: "mcp_draft_tool_or_structured_stdout",
      repairAttemptNumber: repairAttemptNumber(input.run),
      extraInstructions: input.extraInstructions,
    }),
    {
      signal: input.signal,
      onEvent: input.onHarnessEvent,
      onJobUpdate: recordJobUpdate,
    },
  );

  recordHarnessTimeoutBudgetDiagnostics({
    events: input.events,
    run: input.run,
    execution: response.execution,
  });
  recordHarnessExecutionMetadata({
    readRun: () => input.services.workflowRunner.readRun(input.run.id),
    updateRunMetadata(latest, metadata) {
      input.services.workflows.updateStatus(latest.id, {
        status: latest.status,
        metadata,
      });
    },
    execution: response.execution,
  });

  const latest = input.services.workflowRunner.readRun(input.run.id);

  if (latest !== null && latest.status !== "running") {
    return;
  }

  if (response.output === undefined) {
    throw new Error(
      "Harness completed without returning structured stdout or submitting a Spotlight draft through MCP",
    );
  }

  return { draftOutput: input.normalize(response.output, input.run) };
}

export function normalizeSpotlightOutlineDraftOutput(
  payload: unknown,
): WorkflowSpotlightOutlineDraftOutput {
  return workflowSpotlightOutlineDraftOutputSchema.parse(
    normalizeWorkflowSpotlightOutline(payload),
  );
}

export function normalizeSpotlightMembershipDraftOutput(
  payload: unknown,
  run: WorkflowRun,
  services?: GreenroomApiServices,
): WorkflowSpotlightMembershipDraftOutput {
  const anchorKeysByPath = services === undefined ? null : anchorKeysByPathForRun(services, run);
  const approvedOutline = approvedOutlineItemsFromMetadata(run.metadata);

  return workflowSpotlightMembershipDraftOutputSchema.parse(
    normalizeWorkflowSpotlightMembership(payload, anchorKeysByPath, approvedOutline),
  );
}

function createSpotlightOutlineDraftValidator(getServices: () => GreenroomApiServices): {
  validate: (
    context: WorkflowValidationContext,
    draft: WorkflowDraftOutput,
  ) => { issues: WorkflowValidationIssue[] };
} {
  return {
    validate(context, draft) {
      if (draft.kind !== "spotlight_outline") {
        return { issues: [] };
      }

      const services = getServices();
      const issues = validateRunTargetsCurrentRevision(services, context.run);
      const operation = stringMetadata(context.run.metadata, "spotlightOperation");

      if (
        (operation === "refine_view" || context.run.workflowKind === "spotlight_refine") &&
        draft.views.length !== 1
      ) {
        issues.push(
          validationIssue(
            "refine-view-outline-count",
            "Refine-this-View outline drafts must contain exactly one View.",
            ["views"],
            true,
            { outlineCount: draft.views.length },
          ),
        );
      }

      const keys = new Map<string, number>();
      const looseKeys = new Map<string, number>();
      const titles = new Map<string, number>();
      const looseTitles = new Map<string, number>();

      draft.views.forEach((view, index) => {
        if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(view.key)) {
          issues.push(
            validationIssue(
              "unstable-view-key",
              `View key ${view.key} must use lowercase letters, numbers, hyphens, or underscores and start with a letter or number.`,
              ["views", String(index), "key"],
              true,
              { viewKey: view.key },
            ),
          );
        }

        addDuplicateIssue({
          issues,
          seen: keys,
          value: view.key.trim().toLowerCase(),
          code: "duplicate-view-key",
          message: `View key ${view.key} is duplicated.`,
          path: ["views", String(index), "key"],
          metadata: { viewKey: view.key },
        });
        addDuplicateIssue({
          issues,
          seen: looseKeys,
          value: looseMatchText(view.key),
          code: "duplicate-ish-view-key",
          message: `View key ${view.key} is too similar to another key.`,
          path: ["views", String(index), "key"],
          metadata: { viewKey: view.key },
        });
        addDuplicateIssue({
          issues,
          seen: titles,
          value: view.title.trim().toLowerCase(),
          code: "duplicate-view-title",
          message: `View title ${view.title} is duplicated.`,
          path: ["views", String(index), "title"],
          metadata: { title: view.title },
        });
        addDuplicateIssue({
          issues,
          seen: looseTitles,
          value: looseMatchText(view.title),
          code: "duplicate-ish-view-title",
          message: `View title ${view.title} is too similar to another title.`,
          path: ["views", String(index), "title"],
          metadata: { title: view.title },
        });
      });

      return { issues };
    },
  };
}

function createSpotlightMembershipDraftValidator(getServices: () => GreenroomApiServices): {
  validate: (
    context: WorkflowValidationContext,
    draft: WorkflowDraftOutput,
  ) => { issues: WorkflowValidationIssue[] };
} {
  return {
    validate(context, draft) {
      if (draft.kind !== "spotlight_membership") {
        return { issues: [] };
      }

      const services = getServices();
      const issues = validateRunTargetsCurrentRevision(services, context.run);
      const approvedOutline = approvedOutlineItemsFromMetadata(context.run.metadata);
      const approvedKeys = new Set(approvedOutline.map((view) => view.key));
      const revision = services.reviews.getRevision(context.run.revisionId);
      const anchorsByKey =
        revision === null
          ? new Map<string, ThreadAnchor>()
          : anchorsForRevision(services, context.run.reviewDisplayId, revision.id);
      const anchorKeysByPath = anchorKeysByPathFromAnchors(anchorsByKey);

      if (approvedOutline.length === 0) {
        issues.push(
          validationIssue(
            "missing-approved-outline",
            "Spotlight membership drafts require approved outline metadata.",
            ["memberships"],
            false,
          ),
        );
      }

      const membershipViewKeys = new Set<string>();
      let totalAnchorRefs = 0;

      draft.memberships.forEach((membership, membershipIndex) => {
        if (!approvedKeys.has(membership.viewKey)) {
          issues.push(
            validationIssue(
              "unknown-view-key",
              `Membership references unknown View key ${membership.viewKey}.`,
              ["memberships", String(membershipIndex), "viewKey"],
              true,
              { viewKey: membership.viewKey },
            ),
          );
        }

        if (membershipViewKeys.has(membership.viewKey)) {
          issues.push(
            validationIssue(
              "duplicate-membership-view-key",
              `Membership includes View key ${membership.viewKey} more than once.`,
              ["memberships", String(membershipIndex), "viewKey"],
              true,
              { viewKey: membership.viewKey },
            ),
          );
        }
        membershipViewKeys.add(membership.viewKey);

        const seenAnchorKeys = new Set<string>();
        const assignedAnchorKeys = new Set<string>();

        membership.anchorKeys.forEach((anchorKey, anchorIndex) => {
          if (seenAnchorKeys.has(anchorKey)) {
            issues.push(
              validationIssue(
                "duplicate-anchor-key",
                `Membership for View ${membership.viewKey} repeats anchor key ${anchorKey}.`,
                ["memberships", String(membershipIndex), "anchorKeys", String(anchorIndex)],
                true,
                { viewKey: membership.viewKey, anchorKey },
                "warning",
              ),
            );
          }
          seenAnchorKeys.add(anchorKey);
          assignedAnchorKeys.add(anchorKey);

          const anchor = anchorsByKey.get(anchorKey);

          if (anchor === undefined) {
            issues.push(
              validationIssue(
                "unknown-anchor-key",
                `Membership for View ${membership.viewKey} references unknown anchor key ${anchorKey}.`,
                ["memberships", String(membershipIndex), "anchorKeys", String(anchorIndex)],
                true,
                { viewKey: membership.viewKey, anchorKey },
              ),
            );
            return;
          }

          if (anchor.revisionId !== context.run.revisionId) {
            issues.push(
              validationIssue(
                "stale-anchor-revision",
                `Membership anchor ${anchorKey} does not belong to the current revision.`,
                ["memberships", String(membershipIndex), "anchorKeys", String(anchorIndex)],
                true,
                { viewKey: membership.viewKey, anchorKey, anchorRevisionId: anchor.revisionId },
              ),
            );
          }
        });

        membership.filePaths.forEach((filePath, filePathIndex) => {
          const anchorKeys = anchorKeysForPath(anchorKeysByPath, filePath);

          if (anchorKeys.length === 0) {
            issues.push(
              validationIssue(
                "unknown-membership-file-path",
                `Membership for View ${membership.viewKey} references unknown changed file path ${filePath}.`,
                ["memberships", String(membershipIndex), "filePaths", String(filePathIndex)],
                true,
                { viewKey: membership.viewKey, filePath },
              ),
            );
            return;
          }

          for (const anchorKey of anchorKeys) {
            assignedAnchorKeys.add(anchorKey);
          }
        });

        if (assignedAnchorKeys.size === 0) {
          issues.push(
            validationIssue(
              "empty-membership",
              `Membership for View ${membership.viewKey} must include at least one anchor key or changed file path.`,
              ["memberships", String(membershipIndex)],
              true,
              { viewKey: membership.viewKey },
            ),
          );
        }

        totalAnchorRefs += assignedAnchorKeys.size;
      });

      if (totalAnchorRefs > 10_000) {
        issues.push(
          validationIssue(
            "membership-anchor-count-limit",
            "Spotlight membership drafts must stay below 10,000 anchor references.",
            ["memberships"],
            true,
            { totalAnchorRefs },
          ),
        );
      }

      if (totalAnchorRefs === 0) {
        issues.push(
          validationIssue(
            "empty-membership-anchors",
            "Spotlight membership drafts must assign at least one changed-line anchor to an approved View.",
            ["memberships"],
            true,
          ),
        );
      }

      draft.uncoveredAnchorKeys.forEach((anchorKey, index) => {
        if (!anchorsByKey.has(anchorKey)) {
          issues.push(
            validationIssue(
              "unknown-uncovered-anchor-key",
              `Uncovered anchor key ${anchorKey} is not part of the current revision.`,
              ["uncoveredAnchorKeys", String(index)],
              true,
              { anchorKey },
              "warning",
            ),
          );
        }
      });
      draft.uncoveredFiles.forEach((filePath, index) => {
        if (anchorKeysForPath(anchorKeysByPath, filePath).length === 0) {
          issues.push(
            validationIssue(
              "unknown-uncovered-file",
              `Uncovered file ${filePath} is not part of the current revision's changed files.`,
              ["uncoveredFiles", String(index)],
              true,
              { filePath },
              "warning",
            ),
          );
        }
      });

      // Coverage completeness: every changed-line anchor in the registry must
      // be assigned to a View or explicitly listed as uncovered, so a draft
      // that populates only some Views repairs instead of completing.
      const accountedAnchorKeys = new Set<string>([
        ...draft.memberships.flatMap((membership) => membership.anchorKeys),
        ...draft.memberships.flatMap((membership) =>
          membership.filePaths.flatMap((filePath) => anchorKeysForPath(anchorKeysByPath, filePath)),
        ),
        ...draft.uncoveredAnchorKeys,
        ...draft.uncoveredFiles.flatMap((filePath) =>
          anchorKeysForPath(anchorKeysByPath, filePath),
        ),
      ]);
      const unassignedFileCounts = new Map<string, number>();
      let unassignedCount = 0;

      anchorsByKey.forEach((anchor, anchorKey) => {
        if (accountedAnchorKeys.has(anchorKey)) {
          return;
        }
        unassignedCount += 1;
        unassignedFileCounts.set(
          anchor.filePath,
          (unassignedFileCounts.get(anchor.filePath) ?? 0) + 1,
        );
      });

      if (unassignedCount > 0) {
        const unassignedFiles = [...unassignedFileCounts.keys()];
        const sampleFiles = unassignedFiles.slice(0, 8);
        issues.push(
          validationIssue(
            "unassigned-anchor-keys",
            `${unassignedCount} changed-line anchor${unassignedCount === 1 ? "" : "s"} across ${unassignedFiles.length} file${unassignedFiles.length === 1 ? "" : "s"} (${sampleFiles.join(", ")}${unassignedFiles.length > sampleFiles.length ? ", …" : ""}) are neither assigned to a View nor listed as uncovered. Assign remaining anchors with membership.anchorKeys, assign whole files with membership.filePaths, list individual uncovered anchors in uncoveredAnchorKeys, or list whole uncovered files in uncoveredFiles.`,
            ["memberships"],
            true,
            { unassignedCount, unassignedFiles: unassignedFiles.slice(0, 50) },
          ),
        );
      }

      return { issues };
    },
  };
}

function validateRunTargetsCurrentRevision(
  services: GreenroomApiServices,
  run: WorkflowRun,
): WorkflowValidationIssue[] {
  const review = services.reviews.getByDisplayId(run.reviewDisplayId);
  const revision = services.reviews.getRevision(run.revisionId);

  if (review === null || revision === null || revision.reviewDisplayId !== run.reviewDisplayId) {
    return [
      validationIssue(
        "review-revision-not-found",
        "Spotlight draft targets a review revision that no longer exists.",
        [],
        false,
      ),
    ];
  }

  if (review.currentRevisionId !== revision.id) {
    return [
      validationIssue(
        "stale-revision",
        "Spotlight drafts must target the current review revision.",
        ["revisionId"],
        false,
        { currentRevisionId: review.currentRevisionId, draftRevisionId: revision.id },
      ),
    ];
  }

  return [];
}

function anchorsForRevision(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
): Map<string, ThreadAnchor> {
  const anchors = new Map<string, ThreadAnchor>();

  for (const file of services.reviews.listDiffFiles(revisionId)) {
    for (const anchor of changedLineAnchors(reviewDisplayId, revisionId, file)) {
      anchors.set(anchorLineKey(anchor), anchor);
    }
  }

  return anchors;
}

function anchorKeysByPathFromAnchors(
  anchorsByKey: ReadonlyMap<string, ThreadAnchor>,
): Map<string, string[]> {
  const mapped = new Map<string, string[]>();

  anchorsByKey.forEach((anchor, anchorKey) => {
    addAnchorKeyPathMapping(mapped, anchor.filePath, anchorKey);

    if (anchor.oldFilePath !== null) {
      addAnchorKeyPathMapping(mapped, anchor.oldFilePath, anchorKey);
    }
  });

  return mapped;
}

function anchorKeysForPath(
  anchorKeysByPath: ReadonlyMap<string, readonly string[]>,
  filePath: string,
): readonly string[] {
  return anchorKeysByPath.get(normalizeAnchorPath(filePath)) ?? [];
}

function changedLineAnchors(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
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
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
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

function stableKeyBase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72);
}

function approvedOutlineItemsFromMetadata(
  metadata: WorkflowRedactedMetadata,
): WorkflowSpotlightOutlineDraftOutput["views"] {
  const value = metadata.approvedOutlineItems;
  const parsed = workflowSpotlightOutlineDraftOutputSchema.shape.views.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function addDuplicateIssue(input: {
  issues: WorkflowValidationIssue[];
  seen: Map<string, number>;
  value: string;
  code: string;
  message: string;
  path: string[];
  metadata?: WorkflowRedactedMetadata;
}): void {
  if (input.value.length === 0) {
    return;
  }

  const previousIndex = input.seen.get(input.value);

  if (previousIndex !== undefined) {
    input.issues.push(
      validationIssue(input.code, input.message, input.path, true, {
        ...(input.metadata ?? {}),
        previousIndex,
      }),
    );
    return;
  }

  input.seen.set(input.value, Number(input.path[1] ?? 0));
}

function looseMatchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function stringMetadata(metadata: WorkflowRedactedMetadata, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
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

function repairAttemptNumber(run: WorkflowRun): number {
  const value = run.metadata.repairAttemptCount;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
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

function spotlightOutlineHarnessInstructions(profile: Profile, run: WorkflowRun): string[] {
  const instructions = [
    "Read the review manifest, changed-file list, existing threads, existing Spotlight Views, coverage, and path-scoped diffs through MCP before submitting the outline.",
    "Return stable View keys using lowercase letters, numbers, hyphens, or underscores. Keep the same key for the same conceptual View within a run.",
    "Do not include full diff content in the prompt or response; use MCP resources and tools for incremental context.",
    profile.systemPrompt ??
      "Group the approved review scope into intent-coherent Spotlight View outlines.",
  ];
  const instruction = stringMetadata(run.metadata, "spotlightRefineInstruction");

  if (instruction !== null) {
    instructions.push(`Reviewer refinement instruction: ${instruction}`);
  }

  const currentOutline = run.metadata.currentOutlineItems;

  if (Array.isArray(currentOutline)) {
    instructions.push(`Current outline items: ${JSON.stringify(currentOutline)}`);
  }

  const repairContext = run.metadata.lastRepairContext;

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

function spotlightMembershipHarnessInstructions(profile: Profile, run: WorkflowRun): string[] {
  const approvedOutline = approvedOutlineItemsFromMetadata(run.metadata);
  const instructions = [
    "Read the approved outline, relevant path-scoped diffs, coverage, existing Spotlight Views, and anchor registries through MCP before submitting membership.",
    "Use only anchor keys returned by Greenroom MCP anchor resources or tools.",
    "Use membership.filePaths to assign every changed-line anchor in a file to a View without enumerating them.",
    "Use uncoveredFiles to intentionally leave entire changed files out of Spotlight Views.",
    "Do not put file paths in anchorKeys. anchorKeys are only for individual changed-line anchor keys.",
    "Submit membership by approved View key. Greenroom will group anchors by file and persist final Views after validation.",
    `Approved outline items: ${JSON.stringify(approvedOutline)}`,
    profile.systemPrompt ??
      "Assign changed-line anchors to the approved Spotlight Views with concise rationale.",
  ];
  const repairContext = run.metadata.lastRepairContext;

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

export const spotlightOutlineWorkflowDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "views"],
  properties: {
    kind: { type: "string", enum: ["spotlight_outline"] },
    views: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "intent", "description"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 80 },
          title: { type: "string", minLength: 1, maxLength: 160 },
          intent: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: "string", minLength: 1, maxLength: 1000 },
          rationale: { type: ["string", "null"], maxLength: 2000 },
          anchorKeyHints: {
            type: "array",
            maxItems: 200,
            items: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
    },
  },
};

function normalizeWorkflowSpotlightOutline(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || !("views" in payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.views)) {
    return payload;
  }

  return {
    ...record,
    kind: "spotlight_outline",
    views: record.views.map((view, index) => normalizeWorkflowOutlineView(view, index)),
  };
}

function normalizeWorkflowOutlineView(value: unknown, index: number): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const view = value as Record<string, unknown>;
  const title = compactString(stringOrFallback(view.title, `View ${index + 1}`), 160);
  const intent = compactString(stringOrFallback(view.intent, title), 80);
  const key =
    stableKeyBase(stringOrFallback(view.key, "")) ||
    stableKeyBase(intent) ||
    stableKeyBase(title) ||
    `view-${index + 1}`;
  const description = compactString(stringOrFallback(view.description, title), 1000);

  return {
    key,
    title,
    intent,
    description,
    rationale: typeof view.rationale === "string" ? compactString(view.rationale, 2000) : null,
    anchorKeyHints: Array.isArray(view.anchorKeyHints)
      ? view.anchorKeyHints
          .filter((hint): hint is string => typeof hint === "string")
          .map((hint) => hint.trim())
          .filter((hint) => hint.length > 0 && hint.length <= 240)
          .slice(0, 200)
      : [],
  };
}

function stringOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

function compactString(value: string, maxLength: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  if (maxLength <= 3) {
    return trimmed.slice(0, maxLength);
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

export const spotlightMembershipWorkflowDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "memberships"],
  properties: {
    kind: { type: "string", enum: ["spotlight_membership"] },
    memberships: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["viewKey"],
        properties: {
          viewKey: { type: "string" },
          anchorKeys: {
            type: "array",
            maxItems: 500,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 240,
              description:
                "A full changed-line anchor key returned by Greenroom MCP anchor registry resources or tools; not a file path.",
            },
          },
          filePaths: {
            type: "array",
            maxItems: 200,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              description:
                "A changed file path from Greenroom MCP. Use this to assign every changed-line anchor in that file to the View without enumerating them.",
            },
          },
          rationale: { type: ["string", "null"] },
        },
      },
    },
    uncoveredAnchorKeys: {
      type: "array",
      maxItems: 500,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 240,
        description:
          "A full changed-line anchor key returned by Greenroom MCP anchor registry resources or tools; not a file path.",
      },
    },
    uncoveredFiles: {
      type: "array",
      maxItems: 500,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        description:
          "A changed file path from Greenroom MCP whose changed-line anchors are intentionally left out of all Spotlight Views.",
      },
    },
  },
};

function normalizeWorkflowSpotlightMembership(
  payload: unknown,
  anchorKeysByPath: Map<string, readonly string[]> | null,
  approvedOutline: readonly WorkflowSpotlightOutlineDraftOutput["views"][number][],
): unknown {
  if (typeof payload !== "object" || payload === null || !("memberships" in payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.memberships)) {
    return payload;
  }

  const memberships = record.memberships.map((membership) =>
    normalizeWorkflowMembershipItem(membership, anchorKeysByPath, approvedOutline),
  );
  const membershipViewKeys = new Set(
    memberships.flatMap((membership) =>
      typeof membership === "object" &&
      membership !== null &&
      "viewKey" in membership &&
      typeof membership.viewKey === "string"
        ? [membership.viewKey]
        : [],
    ),
  );
  const fallbackMemberships = approvedOutline
    .filter((outline) => !membershipViewKeys.has(outline.key))
    .flatMap((outline) => {
      const membership = membershipForOutlineItem(outline, anchorKeysByPath);

      if (membership.anchorKeys.length === 0 && membership.filePaths.length === 0) {
        return [];
      }

      return [
        {
          viewKey: outline.key,
          anchorKeys: membership.anchorKeys,
          filePaths: membership.filePaths,
          rationale: "Recovered from changed file paths mentioned in the approved outline.",
        },
      ];
    });
  const uncovered = partitionAnchorKeyShorthands(
    Array.isArray(record.uncoveredAnchorKeys)
      ? record.uncoveredAnchorKeys.filter((key): key is string => typeof key === "string")
      : [],
    anchorKeysByPath,
  );
  const explicitUncoveredFiles = Array.isArray(record.uncoveredFiles)
    ? record.uncoveredFiles.filter((path): path is string => typeof path === "string")
    : [];

  return {
    ...record,
    kind: "spotlight_membership",
    memberships: [...memberships, ...fallbackMemberships],
    uncoveredAnchorKeys: uncovered.anchorKeys,
    uncoveredFiles: uniqueStrings([...uncovered.filePaths, ...explicitUncoveredFiles]),
  };
}

function normalizeWorkflowMembershipItem(
  value: unknown,
  anchorKeysByPath: Map<string, readonly string[]> | null,
  approvedOutline: readonly WorkflowSpotlightOutlineDraftOutput["views"][number][],
): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const membership = value as Record<string, unknown>;
  const outline =
    typeof membership.viewKey === "string"
      ? (approvedOutline.find((candidate) => candidate.key === membership.viewKey) ?? null)
      : null;
  const explicit = partitionAnchorKeyShorthands(
    Array.isArray(membership.anchorKeys)
      ? membership.anchorKeys.filter((key): key is string => typeof key === "string")
      : [],
    anchorKeysByPath,
  );
  const explicitFilePaths = Array.isArray(membership.filePaths)
    ? membership.filePaths.filter((path): path is string => typeof path === "string")
    : [];
  const fallback =
    explicit.anchorKeys.length > 0 || explicit.filePaths.length > 0 || explicitFilePaths.length > 0
      ? {
          anchorKeys: explicit.anchorKeys,
          filePaths: uniqueStrings([...explicit.filePaths, ...explicitFilePaths]),
        }
      : outline === null
        ? { anchorKeys: explicit.anchorKeys, filePaths: explicitFilePaths }
        : membershipForOutlineItem(outline, anchorKeysByPath);

  return {
    ...membership,
    anchorKeys: fallback.anchorKeys,
    filePaths: fallback.filePaths,
  };
}

function anchorKeysByPathForRun(
  services: GreenroomApiServices,
  run: WorkflowRun,
): Map<string, readonly string[]> {
  const mapped = new Map<string, string[]>();
  const revision = services.reviews.getRevision(run.revisionId);

  if (revision === null) {
    return mapped;
  }

  for (const [anchorKey, anchor] of anchorsForRevision(
    services,
    run.reviewDisplayId,
    revision.id,
  )) {
    addAnchorKeyPathMapping(mapped, anchor.filePath, anchorKey);

    if (anchor.oldFilePath !== null) {
      addAnchorKeyPathMapping(mapped, anchor.oldFilePath, anchorKey);
    }
  }

  return mapped;
}

function addAnchorKeyPathMapping(
  mapped: Map<string, string[]>,
  filePath: string,
  anchorKey: string,
): void {
  const normalized = normalizeAnchorPath(filePath);
  const keys = mapped.get(normalized) ?? [];

  if (!keys.includes(anchorKey)) {
    keys.push(anchorKey);
  }

  mapped.set(normalized, keys);
}

function partitionAnchorKeyShorthands(
  values: readonly string[],
  anchorKeysByPath: Map<string, readonly string[]> | null,
): { anchorKeys: string[]; filePaths: string[] } {
  const anchorKeys: string[] = [];
  const filePaths: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const normalizedPath = normalizeAnchorPath(trimmed);
    const pathAnchors = anchorKeysByPath?.get(normalizedPath);

    if (pathAnchors !== undefined && pathAnchors.length > 0) {
      filePaths.push(normalizedPath);
      continue;
    }

    anchorKeys.push(trimmed);
  }

  return {
    anchorKeys: uniqueStrings(anchorKeys),
    filePaths: uniqueStrings(filePaths),
  };
}

function membershipForOutlineItem(
  outline: WorkflowSpotlightOutlineDraftOutput["views"][number],
  anchorKeysByPath: Map<string, readonly string[]> | null,
): { anchorKeys: string[]; filePaths: string[] } {
  if (anchorKeysByPath === null) {
    return { anchorKeys: [], filePaths: [] };
  }

  const text = [
    outline.key,
    outline.title,
    outline.intent,
    outline.description,
    outline.rationale ?? "",
    ...outline.anchorKeyHints,
  ].join("\n");
  const fromHints = partitionAnchorKeyShorthands(outline.anchorKeyHints, anchorKeysByPath);
  const fromMentionedPaths = Array.from(anchorKeysByPath.keys()).filter((path) =>
    text.includes(path),
  );

  return {
    anchorKeys: fromHints.anchorKeys,
    filePaths: uniqueStrings([...fromHints.filePaths, ...fromMentionedPaths]),
  };
}

function normalizeAnchorPath(value: string): string {
  return value.trim().replace(/^\.\/+/u, "");
}
