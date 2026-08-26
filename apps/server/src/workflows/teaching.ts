import * as z from "zod";

import {
  type HarnessStreamEvent,
  structuredTeachingOutputSchema,
  workflowTeachingDraftOutputSchema,
  workflowTeachingFollowUpAnswerOutputSchema,
  type Profile,
  type ReviewDisplayId,
  type RevisionId,
  type StructuredTeachingOutput,
  type TeachingContextPack,
  type TeachingExcerptRef,
  type ThreadAnchor,
  type WorkflowDraftOutput,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
  type WorkflowRunId,
  type WorkflowTeachingDraftOutput,
  type WorkflowTeachingFollowUpAnswerOutput,
  type WorkflowValidationIssue,
} from "@greenroom/schemas";
import { threadAnchorLineKey as anchorLineKey } from "@greenroom/core";

import {
  buildTeachingContextPackForWorkflowRun,
  structuredTeachingOutputJsonSchema,
  teachingFollowUpJsonSchema,
} from "../api/teaching";
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

export interface TeachingWorkflowDefinitionOptions {
  getServices: () => GreenroomApiServices;
  mcpServerUrl?: string;
  mcpServerPath?: string;
}

export function createTeachingWorkflowDefinitions(
  options: TeachingWorkflowDefinitionOptions,
): WorkflowDefinition[] {
  const mcpServerUrl = options.mcpServerUrl ?? defaultMcpServerUrl;
  const mcpServerPath = options.mcpServerPath ?? defaultMcpServerPath;

  return [
    {
      kind: "teaching_generate",
      version: "greenroom.teaching-generate.v1",
      defaultTimeoutMs: defaultWorkflowTimeoutMs,
      autoRepair: true,
      validator: createCompositeWorkflowValidator([
        createDraftKindValidator("teaching_draft"),
        createTeachingDraftValidator(options.getServices),
      ]),
      onValidDraft: {
        handle(context) {
          if (context.draft.kind !== "teaching_draft") {
            return { disposition: "complete" as const };
          }

          const services = options.getServices();

          context.events.record({
            runId: context.run.id,
            eventType: "persistence",
            summary: "Teaching draft persisted to workflow output.",
            metadata: {
              walkthroughCount: context.draft.walkthrough.length,
              quizQuestionCount: context.draft.quiz.length,
              missedConceptCount: context.draft.missedConcepts.length,
            },
          });

          return {
            disposition: "complete" as const,
            finalOutput: context.draft,
            metadata: {
              teachingOutputStoredAt: services.clock(),
              walkthroughCount: context.draft.walkthrough.length,
              quizQuestionCount: context.draft.quiz.length,
            },
          };
        },
      },
      metadata: {
        workflowFamily: "teaching",
        persistenceOwner: "greenroom_server",
        teachingStage: "generate",
      },
      steps: [
        {
          id: "teaching-generate.launch-provider",
          phase: "launching_harness",
          eventType: "harness_launch",
          summary: "Launch Teaching generator.",
          async run(context) {
            const services = options.getServices();
            const run = context.run;
            const profile = requireTeachingProfile(services, run.profileId);

            context.events.record({
              runId: run.id,
              eventType: "mcp_resource_read",
              summary: "Teaching run using approved MCP-scoped context.",
              metadata: {
                scopeLabel: run.consentSummary.scopeLabel,
                allowedMcpCapabilities: run.consentSummary.allowedMcpCapabilities,
                expectedMcpResources: run.consentSummary.expectedMcpResources,
                teachingScopeKind: stringMetadata(run.metadata, "teachingScopeKind"),
                spotlightViewId: stringMetadata(run.metadata, "spotlightViewId"),
              },
            });

            if (profile.provider !== "harness") {
              return {
                draftOutput: await createProviderTeachingWorkflowDraft(services, run, profile),
              };
            }

            return launchTeachingHarness({
              services,
              run,
              events: context.events,
              profile,
              mcpServerUrl,
              mcpServerPath,
              mcpGrant: context.mcpGrant,
              signal: context.signal,
              onHarnessEvent: context.activity.recordHarnessEvent,
              schema: teachingDraftWorkflowJsonSchema,
              promptId: "greenroom_teaching_prompt",
              outputCapture: "mcp_draft_tool_or_structured_stdout",
              extraInstructions: teachingGenerateHarnessInstructions(profile, run),
              normalize: normalizeTeachingDraftOutput,
            });
          },
        },
      ],
    },
    {
      kind: "teaching_follow_up",
      version: "greenroom.teaching-follow-up.v1",
      defaultTimeoutMs: defaultWorkflowTimeoutMs,
      autoRepair: true,
      validator: createCompositeWorkflowValidator([
        createDraftKindValidator("teaching_follow_up_answer"),
        createTeachingFollowUpAnswerValidator(),
      ]),
      onValidDraft: {
        handle(context) {
          if (context.draft.kind !== "teaching_follow_up_answer") {
            return { disposition: "complete" as const };
          }

          const originalRunId = stringMetadata(context.run.metadata, "originalTeachingRunId");
          const question = stringMetadata(context.run.metadata, "teachingFollowUpQuestion");

          if (originalRunId !== null) {
            options.getServices().workflows.recordEvent({
              runId: originalRunId as WorkflowRunId,
              eventType: "persistence",
              summary: "Teaching follow-up answered.",
              metadata: {
                followUpWorkflowRunId: context.run.id,
                question: question ?? "",
                answer: context.draft.answer,
              },
            });
          }

          context.events.record({
            runId: context.run.id,
            eventType: "persistence",
            summary: "Teaching follow-up answer persisted.",
            metadata: {
              originalTeachingRunId: originalRunId,
              answerLength: context.draft.answer.length,
            },
          });

          return {
            disposition: "complete" as const,
            finalOutput: context.draft,
            metadata: {
              answeredAt: options.getServices().clock(),
              originalTeachingRunId: originalRunId,
              answerLength: context.draft.answer.length,
            },
          };
        },
      },
      metadata: {
        workflowFamily: "teaching",
        persistenceOwner: "greenroom_server",
        teachingStage: "follow_up",
      },
      steps: [
        {
          id: "teaching-follow-up.launch-provider",
          phase: "launching_harness",
          eventType: "harness_launch",
          summary: "Launch Teaching follow-up responder.",
          async run(context) {
            const services = options.getServices();
            const run = context.run;
            const profile = requireTeachingProfile(services, run.profileId);
            const originalRun = requireOriginalTeachingRun(services, run);
            const originalOutput = requireTeachingOutput(originalRun);
            const question = requireStringMetadata(run.metadata, "teachingFollowUpQuestion");
            const teachingContext = buildTeachingContextPackForWorkflowRun(services, originalRun);

            context.events.record({
              runId: run.id,
              eventType: "mcp_resource_read",
              summary: "Teaching follow-up reusing original approved scope.",
              metadata: {
                originalTeachingRunId: originalRun.id,
                scopeLabel: originalRun.consentSummary.scopeLabel,
                teachingScopeKind: stringMetadata(originalRun.metadata, "teachingScopeKind"),
                spotlightViewId: stringMetadata(originalRun.metadata, "spotlightViewId"),
              },
            });

            if (profile.provider !== "harness") {
              return {
                draftOutput: await createProviderTeachingFollowUpAnswer({
                  services,
                  run,
                  profile,
                  context: teachingContext,
                  output: originalOutput,
                  question,
                }),
              };
            }

            return launchTeachingHarness({
              services,
              run,
              events: context.events,
              profile,
              mcpServerUrl,
              mcpServerPath,
              mcpGrant: context.mcpGrant,
              signal: context.signal,
              onHarnessEvent: context.activity.recordHarnessEvent,
              schema: teachingFollowUpWorkflowJsonSchema,
              promptId: "greenroom_teaching_prompt",
              outputCapture: "structured_stdout",
              extraInstructions: teachingFollowUpHarnessInstructions(
                profile,
                run,
                originalRun,
                originalOutput,
                question,
              ),
              normalize: normalizeTeachingFollowUpAnswerOutput,
            });
          },
        },
      ],
    },
  ];
}

export function normalizeTeachingDraftOutput(payload: unknown): WorkflowTeachingDraftOutput {
  if (typeof payload === "object" && payload !== null && "kind" in payload) {
    return workflowTeachingDraftOutputSchema.parse(payload);
  }

  return workflowTeachingDraftOutputSchema.parse({
    kind: "teaching_draft",
    ...structuredTeachingOutputSchema.parse(payload),
  });
}

export function teachingOutputFromWorkflowDraft(
  draft: WorkflowDraftOutput | null,
): StructuredTeachingOutput | null {
  if (draft === null || draft.kind !== "teaching_draft") {
    return null;
  }

  return structuredTeachingOutputSchema.parse(draft);
}

function normalizeTeachingFollowUpAnswerOutput(
  payload: unknown,
): WorkflowTeachingFollowUpAnswerOutput {
  if (typeof payload === "object" && payload !== null && "kind" in payload) {
    return workflowTeachingFollowUpAnswerOutputSchema.parse(payload);
  }

  return workflowTeachingFollowUpAnswerOutputSchema.parse({
    kind: "teaching_follow_up_answer",
    ...teachingFollowUpAnswerPayloadSchema.parse(payload),
  });
}

async function launchTeachingHarness<TDraft extends WorkflowDraftOutput>(input: {
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
  outputCapture: NonNullable<Parameters<typeof buildMcpFirstHarnessRunRequest>[0]["outputCapture"]>;
  extraInstructions: readonly string[];
  normalize: (payload: unknown) => TDraft;
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
      outputCapture: input.outputCapture,
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
      "Harness completed without returning structured stdout or submitting a Teaching draft through MCP",
    );
  }

  return { draftOutput: input.normalize(response.output) };
}

async function createProviderTeachingWorkflowDraft(
  services: GreenroomApiServices,
  run: WorkflowRun,
  profile: Profile,
): Promise<WorkflowTeachingDraftOutput> {
  const provider = requireTeachingProvider(services, profile);
  const context = buildTeachingContextPackForWorkflowRun(services, run);
  const output = await provider.generateTeaching({ runId: run.id, profile, context });
  return normalizeTeachingDraftOutput(output);
}

async function createProviderTeachingFollowUpAnswer(input: {
  services: GreenroomApiServices;
  run: WorkflowRun;
  profile: Profile;
  context: TeachingContextPack;
  output: StructuredTeachingOutput;
  question: string;
}): Promise<WorkflowTeachingFollowUpAnswerOutput> {
  const provider = requireTeachingProvider(input.services, input.profile);
  const answer = await provider.answerFollowUp({
    runId: input.run.id,
    profile: input.profile,
    context: input.context,
    output: input.output,
    question: input.question,
  });

  return workflowTeachingFollowUpAnswerOutputSchema.parse({
    kind: "teaching_follow_up_answer",
    answer,
  });
}

function createTeachingDraftValidator(getServices: () => GreenroomApiServices): {
  validate: (
    context: WorkflowValidationContext,
    draft: WorkflowDraftOutput,
  ) => { issues: WorkflowValidationIssue[] };
} {
  return {
    validate(context, draft) {
      if (draft.kind !== "teaching_draft") {
        return { issues: [] };
      }

      const services = getServices();
      const issues = validateRunTargetsCurrentRevision(services, context.run);
      const allowedAnchors = allowedTeachingAnchorsForRun(services, context.run);
      const allowedExcerptFiles = allowedTeachingExcerptFilesForRun(services, context.run);
      const outputSize = JSON.stringify(draft).length;

      if (outputSize > 200_000) {
        issues.push(
          validationIssue(
            "teaching-output-size-limit",
            "Teaching drafts must stay below 200KB.",
            [],
            true,
            { outputSize },
          ),
        );
      }

      const diagramIds = new Set<string>();

      draft.diagrams.forEach((diagram, index) => {
        if (diagramIds.has(diagram.id)) {
          issues.push(
            validationIssue(
              "duplicate-diagram-id",
              `Teaching diagram id ${diagram.id} is duplicated.`,
              ["diagrams", String(index), "id"],
              true,
              { diagramId: diagram.id },
            ),
          );
        }
        diagramIds.add(diagram.id);
      });

      const pointIds = new Set<string>();

      draft.walkthrough.forEach((point, index) => {
        if (pointIds.has(point.id)) {
          issues.push(
            validationIssue(
              "duplicate-walkthrough-id",
              `Teaching walkthrough id ${point.id} is duplicated.`,
              ["walkthrough", String(index), "id"],
              true,
              { pointId: point.id },
            ),
          );
        }
        pointIds.add(point.id);

        if (point.diagramId !== null && !diagramIds.has(point.diagramId)) {
          issues.push(
            validationIssue(
              "unknown-diagram-id",
              `Teaching walkthrough point ${point.id} references diagramId ${point.diagramId} that is not in diagrams.`,
              ["walkthrough", String(index), "diagramId"],
              true,
              { pointId: point.id, diagramId: point.diagramId },
            ),
          );
        }

        validateTeachingAnchor({
          issues,
          allowedAnchors,
          anchor: point.anchor,
          path: ["walkthrough", String(index), "anchor"],
        });

        validateTeachingExcerpts({
          issues,
          allowedAnchors,
          allowedExcerptFiles,
          excerpts: point.excerpts,
          path: ["walkthrough", String(index), "excerpts"],
        });
      });

      const quizIds = new Set<string>();

      draft.quiz.forEach((question, questionIndex) => {
        if (quizIds.has(question.id)) {
          issues.push(
            validationIssue(
              "duplicate-quiz-id",
              `Teaching quiz id ${question.id} is duplicated.`,
              ["quiz", String(questionIndex), "id"],
              true,
              { questionId: question.id },
            ),
          );
        }
        quizIds.add(question.id);

        const choiceIds = new Set(question.choices.map((choice) => choice.id));

        if (!choiceIds.has(question.correctChoiceId)) {
          issues.push(
            validationIssue(
              "unknown-correct-choice",
              `Quiz question ${question.id} references a correctChoiceId that is not in choices.`,
              ["quiz", String(questionIndex), "correctChoiceId"],
              true,
              { questionId: question.id, correctChoiceId: question.correctChoiceId },
            ),
          );
        }

        if (choiceIds.size !== question.choices.length) {
          issues.push(
            validationIssue(
              "duplicate-quiz-choice-id",
              `Quiz question ${question.id} includes duplicate choice ids.`,
              ["quiz", String(questionIndex), "choices"],
              true,
              { questionId: question.id },
            ),
          );
        }

        validateTeachingAnchor({
          issues,
          allowedAnchors,
          anchor: question.anchor,
          path: ["quiz", String(questionIndex), "anchor"],
        });

        validateTeachingExcerpts({
          issues,
          allowedAnchors,
          allowedExcerptFiles,
          excerpts: question.excerpts,
          path: ["quiz", String(questionIndex), "excerpts"],
        });
      });

      return { issues };
    },
  };
}

function createTeachingFollowUpAnswerValidator(): {
  validate: (
    context: WorkflowValidationContext,
    draft: WorkflowDraftOutput,
  ) => { issues: WorkflowValidationIssue[] };
} {
  return {
    validate(_context, draft) {
      if (draft.kind !== "teaching_follow_up_answer") {
        return { issues: [] };
      }

      const issues: WorkflowValidationIssue[] = [];

      if (draft.answer.length > 16_000) {
        issues.push(
          validationIssue(
            "teaching-follow-up-size-limit",
            "Teaching follow-up answers must stay below 16,000 characters.",
            ["answer"],
            true,
            { answerLength: draft.answer.length },
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
        "Teaching draft targets a review revision that no longer exists.",
        [],
        false,
      ),
    ];
  }

  if (review.currentRevisionId !== revision.id) {
    return [
      validationIssue(
        "stale-revision",
        "Teaching drafts must target the current review revision.",
        ["revisionId"],
        false,
        { currentRevisionId: review.currentRevisionId, draftRevisionId: revision.id },
      ),
    ];
  }

  return [];
}

function allowedTeachingAnchorsForRun(
  services: GreenroomApiServices,
  run: WorkflowRun,
): Map<string, ThreadAnchor> {
  const scopeKind = stringMetadata(run.metadata, "teachingScopeKind");

  if (scopeKind === "spotlight_view") {
    const viewRef = requireStringMetadata(run.metadata, "spotlightViewRef");
    const view = services.spotlight.getViewWithRegionsByRef(viewRef);
    const anchors = new Map<string, ThreadAnchor>();

    if (view === null || view.reviewDisplayId !== run.reviewDisplayId) {
      return anchors;
    }

    for (const region of view.regions) {
      for (const anchor of region.anchors) {
        if (anchor.revisionId === run.revisionId) {
          anchors.set(anchorLineKey(anchor), anchor);
        }
      }
    }

    return anchors;
  }

  return anchorsForRevision(services, run.reviewDisplayId, run.revisionId);
}

function allowedTeachingExcerptFilesForRun(
  services: GreenroomApiServices,
  run: WorkflowRun,
): Set<string> {
  const files = new Set<string>();
  const scopeKind = stringMetadata(run.metadata, "teachingScopeKind");

  if (scopeKind === "spotlight_view") {
    const viewRef = requireStringMetadata(run.metadata, "spotlightViewRef");
    const view = services.spotlight.getViewWithRegionsByRef(viewRef);

    if (view === null || view.reviewDisplayId !== run.reviewDisplayId) {
      return files;
    }

    for (const region of view.regions) {
      files.add(region.filePath);

      if (region.oldPath !== null) {
        files.add(region.oldPath);
      }
    }

    return files;
  }

  for (const file of services.reviews.listDiffFiles(run.revisionId)) {
    files.add(file.path);

    if (file.oldPath !== null) {
      files.add(file.oldPath);
    }
  }

  return files;
}

function validateTeachingExcerpts(input: {
  issues: WorkflowValidationIssue[];
  allowedAnchors: ReadonlyMap<string, ThreadAnchor>;
  allowedExcerptFiles: ReadonlySet<string>;
  excerpts: readonly TeachingExcerptRef[];
  path: string[];
}): void {
  input.excerpts.forEach((excerpt, index) => {
    if (excerpt.kind === "anchor") {
      validateTeachingAnchor({
        issues: input.issues,
        allowedAnchors: input.allowedAnchors,
        anchor: excerpt.anchor,
        path: [...input.path, String(index), "anchor"],
      });
      return;
    }

    if (!input.allowedExcerptFiles.has(excerpt.filePath)) {
      input.issues.push(
        validationIssue(
          "excerpt-file-outside-scope",
          "Teaching excerpt references a file outside the approved Teaching scope.",
          [...input.path, String(index), "filePath"],
          true,
          { filePath: excerpt.filePath },
        ),
      );
    }
  });
}

function validateTeachingAnchor(input: {
  issues: WorkflowValidationIssue[];
  allowedAnchors: ReadonlyMap<string, ThreadAnchor>;
  anchor: ThreadAnchor | null;
  path: string[];
}): void {
  if (input.anchor === null) {
    return;
  }

  const key = anchorLineKey(input.anchor);

  if (!input.allowedAnchors.has(key)) {
    input.issues.push(
      validationIssue(
        "anchor-outside-approved-scope",
        "Teaching draft anchor is outside the approved Teaching scope.",
        input.path,
        true,
        { anchorKey: key },
      ),
    );
  }
}

function anchorsForRevision(
  services: GreenroomApiServices,
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
): Map<string, ThreadAnchor> {
  const anchors = new Map<string, ThreadAnchor>();

  for (const file of services.reviews.listDiffFiles(revisionId)) {
    if (file.isBinary) {
      continue;
    }

    for (const hunk of file.hunks) {
      hunk.lines.forEach((line, index) => {
        if (line.type === "addition" && line.newLineNumber !== null) {
          const anchor = {
            reviewDisplayId,
            revisionId,
            filePath: file.path,
            oldFilePath: file.oldPath,
            side: "head" as const,
            lineNumber: line.newLineNumber,
            lineType: line.type,
            hunkId: hunk.id,
            hunkHeader: hunk.header,
            contextBefore: hunk.lines
              .slice(Math.max(0, index - 3), index)
              .map((candidate) => candidate.content),
            contextAfter: hunk.lines
              .slice(index + 1, index + 4)
              .map((candidate) => candidate.content),
            originalLineText: line.content,
          };
          anchors.set(anchorLineKey(anchor), anchor);
        }

        if (line.type === "deletion" && line.oldLineNumber !== null) {
          const anchor = {
            reviewDisplayId,
            revisionId,
            filePath: file.path,
            oldFilePath: file.oldPath,
            side: "base" as const,
            lineNumber: line.oldLineNumber,
            lineType: line.type,
            hunkId: hunk.id,
            hunkHeader: hunk.header,
            contextBefore: hunk.lines
              .slice(Math.max(0, index - 3), index)
              .map((candidate) => candidate.content),
            contextAfter: hunk.lines
              .slice(index + 1, index + 4)
              .map((candidate) => candidate.content),
            originalLineText: line.content,
          };
          anchors.set(anchorLineKey(anchor), anchor);
        }
      });
    }
  }

  return anchors;
}

function requireOriginalTeachingRun(services: GreenroomApiServices, run: WorkflowRun): WorkflowRun {
  const originalRunId = requireStringMetadata(run.metadata, "originalTeachingRunId");
  const originalRun = services.workflowRunner.readRun(originalRunId as WorkflowRunId);

  if (originalRun === null || originalRun.workflowKind !== "teaching_generate") {
    throw new Error(`Original Teaching run ${originalRunId} was not found`);
  }

  if (originalRun.status !== "completed") {
    throw new Error("Teaching follow-ups require a completed Teaching run");
  }

  return originalRun;
}

function requireTeachingOutput(run: WorkflowRun): StructuredTeachingOutput {
  const draft = run.finalOutput ?? run.draftOutput;
  const output = teachingOutputFromWorkflowDraft(draft);

  if (output === null) {
    throw new Error(`Teaching run ${run.id} did not produce Teaching output`);
  }

  return output;
}

function requireTeachingProvider(services: GreenroomApiServices, profile: Profile) {
  const provider = services.providers[profile.provider];

  if (provider === undefined) {
    throw new Error(`Provider ${profile.provider} is not configured`);
  }

  return provider;
}

function requireTeachingProfile(
  services: GreenroomApiServices,
  profileId: WorkflowRun["profileId"],
): Profile {
  const profile = services.profiles.get(profileId);

  if (profile === null) {
    throw new Error(`Profile ${profileId} was not found`);
  }

  if (profile.workflowType !== "teaching") {
    throw new Error("Teaching workflows require a teaching profile");
  }

  return profile;
}

function teachingGenerateHarnessInstructions(profile: Profile, run: WorkflowRun): string[] {
  const instructions = [
    "Read the review manifest, changed-file list, selected path-scoped diffs, and anchor registries through MCP before submitting the Teaching draft.",
    "Do not embed the full diff in the response. Use MCP resources and tools for incremental context.",
    "Use anchors only from the approved Teaching scope. For Spotlight View scope, use only anchors from the selected View's lit regions.",
    'Optional Mermaid diagrams: the top-level "diagrams" field is an array (at most 8) of { "id": string, "title": string, "mermaidSource": string } objects. mermaidSource is raw Mermaid text without code fences (at most 6000 characters). A walkthrough point may reference one diagram by setting "diagramId" to a diagram id; otherwise set "diagramId" to null. Include diagrams only when they clarify structure or flow.',
    'Optional code/diff excerpt references: each walkthrough point has an "excerpts" array (at most 4) and each quiz question has an "excerpts" array (at most 2); use [] when none apply. Each excerpt is either { "kind": "anchor", "anchor": <exact anchor object from the approved scope> } or { "kind": "lines", "filePath": <changed-file path from the approved scope>, "side": "base" | "head", "startLine": <integer>, "endLine": <integer> } where startLine <= endLine and the range spans at most 200 lines.',
    profile.systemPrompt ??
      "Explain the approved review scope with a change summary, architecture explanation, walkthrough, quiz, and missed concepts.",
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

function teachingFollowUpHarnessInstructions(
  profile: Profile,
  run: WorkflowRun,
  originalRun: WorkflowRun,
  output: StructuredTeachingOutput,
  question: string,
): string[] {
  const instructions = [
    "Answer the Teaching follow-up within the original approved Teaching scope.",
    "Do not expand to files, repository state, or Spotlight Views outside the original run. If the question asks for wider scope, say a new Teaching run is needed.",
    "Return structured stdout JSON only. Do not submit a Teaching draft tool for follow-up answers.",
    `Original Teaching workflow run id: ${originalRun.id}`,
    `Question: ${question}`,
    `Prior Teaching output summary: ${JSON.stringify({
      changeSummary: output.changeSummary,
      walkthroughTitles: output.walkthrough.map((point) => point.title),
      missedConcepts: output.missedConcepts,
    })}`,
    profile.systemPrompt ??
      "Answer follow-up questions clearly while staying within the approved Teaching context.",
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

function requireStringMetadata(metadata: WorkflowRedactedMetadata, key: string): string {
  const value = stringMetadata(metadata, key);

  if (value === null) {
    throw new Error(`Workflow metadata ${key} is required`);
  }

  return value;
}

function stringMetadata(metadata: WorkflowRedactedMetadata, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const teachingFollowUpAnswerPayloadSchema = z
  .object({
    answer: z.string().trim().min(1).max(16_000),
  })
  .strict();

const teachingDraftWorkflowJsonSchema = {
  ...structuredTeachingOutputJsonSchema,
  required: ["kind", ...((structuredTeachingOutputJsonSchema.required as string[]) ?? [])],
  properties: {
    kind: { type: "string", enum: ["teaching_draft"] },
    ...structuredTeachingOutputJsonSchema.properties,
  },
};

const teachingFollowUpWorkflowJsonSchema = {
  ...teachingFollowUpJsonSchema,
  required: ["kind", "answer"],
  properties: {
    kind: { type: "string", enum: ["teaching_follow_up_answer"] },
    answer: { type: "string" },
  },
};
