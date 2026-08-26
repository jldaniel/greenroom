import * as z from "zod";

import {
  agentEventSourceSchema,
  commentCreateInputSchema,
  handoffRequestSchema,
  relativePathSchema,
  reviewReferenceSchema,
  reviewStateFilterSchema,
  revisionIdSchema,
  spotlightViewReferenceSchema,
  threadRefSchema,
  threadReferenceSchema,
  threadStatusSchema,
  threadCreateInputSchema,
  workflowBuiltinReviewDraftOutputSchema,
  workflowRunIdSchema,
  workflowSpotlightMembershipDraftOutputSchema,
  workflowSpotlightOutlineDraftOutputSchema,
  workflowTeachingDraftOutputSchema,
  workflowValidationIssueSchema,
  type AgentEventCreateInput,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type ReviewDisplayId,
  type RevisionId,
  type ThreadCreateInput,
  type ThreadWithComments,
  type WorkflowValidationIssue,
} from "@greenroom/schemas";

import { GreenroomHttpError, type GreenroomHttpClient } from "./client";
import { anchorsForDiffFile } from "./resources";

export const greenroomToolNames = [
  "greenroom_list_reviews",
  "greenroom_get_review",
  "greenroom_get_diff",
  "greenroom_list_changed_files",
  "greenroom_read_diff_file",
  "greenroom_search_diff",
  "greenroom_get_anchor_registry",
  "greenroom_get_existing_threads",
  "greenroom_get_spotlight_views",
  "greenroom_get_view",
  "greenroom_get_view_diff",
  "greenroom_get_line_membership",
  "greenroom_get_thread",
  "greenroom_create_thread",
  "greenroom_reply_to_thread",
  "greenroom_resolve_thread",
  "greenroom_dismiss_thread",
  "greenroom_create_handoff",
  "greenroom_report_attempted_fix",
  "greenroom_report_progress",
  "greenroom_submit_review_findings_draft",
  "greenroom_submit_spotlight_outline_draft",
  "greenroom_submit_spotlight_membership_draft",
  "greenroom_submit_teaching_draft",
] as const;

export type GreenroomToolName = (typeof greenroomToolNames)[number];

export interface GreenroomToolDefinition {
  name: GreenroomToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

const listReviewsInputSchema = z
  .object({
    state: reviewStateFilterSchema.default("open"),
  })
  .strict();
const reviewInputSchema = z.object({ reviewId: reviewReferenceSchema }).strict();
const diffInputSchema = z
  .object({
    reviewId: reviewReferenceSchema,
    revisionId: revisionIdSchema.optional(),
  })
  .strict();
const paginationInputFields = {
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(250).default(50),
};
const changedFilesInputSchema = z
  .object({
    reviewId: reviewReferenceSchema,
    revisionId: revisionIdSchema.optional(),
    ...paginationInputFields,
  })
  .strict();
const readDiffFileInputSchema = z
  .object({
    reviewId: reviewReferenceSchema,
    revisionId: revisionIdSchema.optional(),
    path: relativePathSchema,
    cursor: paginationInputFields.cursor,
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
const searchDiffInputSchema = z
  .object({
    reviewId: reviewReferenceSchema,
    revisionId: revisionIdSchema.optional(),
    query: z.string().trim().min(1).max(1000),
    path: relativePathSchema.optional(),
    ...paginationInputFields,
  })
  .strict();
const anchorRegistryInputSchema = z
  .object({
    reviewId: reviewReferenceSchema,
    revisionId: revisionIdSchema.optional(),
    path: relativePathSchema.optional(),
    ...paginationInputFields,
  })
  .strict();
const existingThreadsInputSchema = z
  .object({
    reviewId: reviewReferenceSchema,
    status: threadStatusSchema.optional(),
    path: relativePathSchema.optional(),
    ...paginationInputFields,
  })
  .strict();
const spotlightViewsReadInputSchema = z
  .object({
    reviewId: reviewReferenceSchema,
    ...paginationInputFields,
  })
  .strict();
const viewDiffReadInputSchema = z
  .object({
    viewRef: spotlightViewReferenceSchema,
    path: relativePathSchema.optional(),
    cursor: paginationInputFields.cursor,
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
const spotlightViewInputSchema = z
  .object({
    viewRef: spotlightViewReferenceSchema,
  })
  .strict();
const threadRefInputSchema = z
  .object({
    threadRef: threadReferenceSchema,
  })
  .strict();
const threadReplyInputSchema = commentCreateInputSchema.strict();
const mcpThreadCreateInputSchema = threadCreateInputSchema.strict();
const mcpHandoffRequestSchema = handoffRequestSchema.strict();
const attemptedFixInputSchema = z
  .object({
    reviewDisplayId: reviewReferenceSchema.nullable().optional(),
    source: agentEventSourceSchema,
    threadRefs: z.array(threadRefSchema).default([]),
    summary: z.string().trim().min(1).max(65_000),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const reviewFindingsDraftInputSchema = z
  .object({
    runId: workflowRunIdSchema,
    draft: workflowBuiltinReviewDraftOutputSchema,
  })
  .strict();
const spotlightOutlineDraftInputSchema = z
  .object({
    runId: workflowRunIdSchema,
    draft: workflowSpotlightOutlineDraftOutputSchema,
  })
  .strict();
const spotlightMembershipDraftInputSchema = z
  .object({
    runId: workflowRunIdSchema,
    draft: workflowSpotlightMembershipDraftOutputSchema,
  })
  .strict();
const teachingDraftInputSchema = z
  .object({
    runId: workflowRunIdSchema,
    draft: workflowTeachingDraftOutputSchema,
  })
  .strict();
const progressReportInputSchema = z
  .object({
    runId: workflowRunIdSchema,
    message: z.string().trim().min(1).max(2000),
    completedUnits: z.number().int().min(0).optional(),
    totalUnits: z.number().int().min(1).optional(),
    phase: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.completedUnits !== undefined &&
      value.totalUnits !== undefined &&
      value.completedUnits > value.totalUnits
    ) {
      context.addIssue({
        code: "custom",
        message: "completedUnits cannot exceed totalUnits",
        path: ["completedUnits"],
      });
    }
  });

export function listGreenroomTools(): GreenroomToolDefinition[] {
  return [
    {
      name: "greenroom_list_reviews",
      description: "List local Greenroom review PR summaries, defaulting to open reviews.",
      inputSchema: objectSchema({
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          default: "open",
          description: "Review state filter; defaults to open.",
        },
      }),
    },
    {
      name: "greenroom_get_review",
      description: "Read review metadata, refs, current revision, and stats.",
      inputSchema: objectSchema({ reviewId: stringSchema("Review display ID such as GR-1") }, [
        "reviewId",
      ]),
    },
    {
      name: "greenroom_get_diff",
      description: "Read the current or selected structured review diff.",
      inputSchema: objectSchema(
        {
          reviewId: stringSchema("Review display ID such as GR-1"),
          revisionId: stringSchema("Optional revision ID such as revision_1"),
        },
        ["reviewId"],
      ),
    },
    {
      name: "greenroom_list_changed_files",
      description: "List changed files for the current review revision with pagination.",
      inputSchema: objectSchema(
        {
          reviewId: stringSchema("Review display ID such as GR-1"),
          revisionId: stringSchema("Optional current revision ID; stale revisions are rejected."),
          cursor: stringSchema("Optional pagination cursor."),
          limit: numberSchema("Maximum files to return, default 50."),
        },
        ["reviewId"],
      ),
    },
    {
      name: "greenroom_read_diff_file",
      description: "Read one changed file diff by repository-relative path with hunk pagination.",
      inputSchema: objectSchema(
        {
          reviewId: stringSchema("Review display ID such as GR-1"),
          path: stringSchema("Repository-relative changed file path."),
          revisionId: stringSchema("Optional current revision ID; stale revisions are rejected."),
          cursor: stringSchema("Optional hunk pagination cursor."),
          limit: numberSchema("Maximum hunks to return, default 25."),
        },
        ["reviewId", "path"],
      ),
    },
    {
      name: "greenroom_search_diff",
      description: "Search current diff paths, hunk headers, and line content with pagination.",
      inputSchema: objectSchema(
        {
          reviewId: stringSchema("Review display ID such as GR-1"),
          query: stringSchema("Case-insensitive search query."),
          path: stringSchema("Optional repository-relative file path to scope the search."),
          revisionId: stringSchema("Optional current revision ID; stale revisions are rejected."),
          cursor: stringSchema("Optional match pagination cursor."),
          limit: numberSchema("Maximum matches to return, default 50."),
        },
        ["reviewId", "query"],
      ),
    },
    {
      name: "greenroom_get_anchor_registry",
      description: "Read stable changed-line anchor keys for the current revision.",
      inputSchema: objectSchema(
        {
          reviewId: stringSchema("Review display ID such as GR-1"),
          path: stringSchema("Optional repository-relative file path to scope anchors."),
          revisionId: stringSchema("Optional current revision ID; stale revisions are rejected."),
          cursor: stringSchema("Optional anchor pagination cursor."),
          limit: numberSchema("Maximum anchors to return, default 50."),
        },
        ["reviewId"],
      ),
    },
    {
      name: "greenroom_get_existing_threads",
      description: "Read summarized existing review threads with optional status and path filters.",
      inputSchema: objectSchema(
        {
          reviewId: stringSchema("Review display ID such as GR-1"),
          status: stringSchema("Optional thread status: open, resolved, or dismissed."),
          path: stringSchema("Optional repository-relative file path."),
          cursor: stringSchema("Optional thread pagination cursor."),
          limit: numberSchema("Maximum threads to return, default 50."),
        },
        ["reviewId"],
      ),
    },
    {
      name: "greenroom_get_spotlight_views",
      description:
        "Read Spotlight View summaries with intent, health, and associated files, with pagination.",
      inputSchema: objectSchema(
        {
          reviewId: stringSchema("Review display ID such as GR-1"),
          cursor: stringSchema("Optional pagination cursor."),
          limit: numberSchema("Maximum views to return, default 50."),
        },
        ["reviewId"],
      ),
    },
    {
      name: "greenroom_get_view_diff",
      description: "Read a Spotlight View diff with file or hunk pagination.",
      inputSchema: objectSchema(
        {
          viewRef: stringSchema("Spotlight View ref such as SV-3"),
          path: stringSchema("Optional repository-relative file path in the view."),
          cursor: stringSchema("Optional pagination cursor."),
          limit: numberSchema("Maximum files or hunks to return, default 25."),
        },
        ["viewRef"],
      ),
    },
    {
      name: "greenroom_get_view",
      description: "Read one Spotlight View with its lit regions by global ref.",
      inputSchema: objectSchema(
        {
          viewRef: stringSchema("Spotlight View ref such as SV-3"),
        },
        ["viewRef"],
      ),
    },
    {
      name: "greenroom_get_line_membership",
      description: "Read Spotlight View membership for every changed line in the current diff.",
      inputSchema: objectSchema({ reviewId: stringSchema("Review display ID such as GR-1") }, [
        "reviewId",
      ]),
    },
    {
      name: "greenroom_get_thread",
      description: "Read one thread with its comments by global ref.",
      inputSchema: objectSchema(
        {
          threadRef: stringSchema("Thread ref such as GT-12"),
        },
        ["threadRef"],
      ),
    },
    {
      name: "greenroom_create_thread",
      description: "Create an attributed anchored thread through the local API.",
      inputSchema: objectSchema(
        {
          reviewDisplayId: stringSchema("Review display ID such as GR-1"),
          type: stringSchema("question, issue, suggestion, or note"),
          severity: stringSchema("Optional blocking, major, minor, or nit"),
          source: { type: "object", additionalProperties: true },
          anchor: { type: "object", additionalProperties: true },
          anchors: { type: "array", items: { type: "object", additionalProperties: true } },
          firstComment: { type: "object", additionalProperties: true },
        },
        ["reviewDisplayId", "type", "source", "anchor", "firstComment"],
      ),
    },
    {
      name: "greenroom_reply_to_thread",
      description: "Reply to an existing Greenroom review thread.",
      inputSchema: objectSchema(
        {
          threadRef: stringSchema("Thread ref such as GT-12"),
          parentCommentId: stringSchema("Optional parent comment ID"),
          authorKind: stringSchema("Participant kind"),
          authorDisplayName: stringSchema("Displayed author name"),
          body: stringSchema("Reply body"),
        },
        ["threadRef", "authorKind", "authorDisplayName", "body"],
      ),
    },
    {
      name: "greenroom_resolve_thread",
      description: "Mark a review thread resolved.",
      inputSchema: objectSchema(
        {
          threadRef: stringSchema("Thread ref such as GT-12"),
        },
        ["threadRef"],
      ),
    },
    {
      name: "greenroom_dismiss_thread",
      description: "Mark a review thread dismissed.",
      inputSchema: objectSchema(
        {
          threadRef: stringSchema("Thread ref such as GT-12"),
        },
        ["threadRef"],
      ),
    },
    {
      name: "greenroom_create_handoff",
      description: "Create a selected-thread handoff bundle with anchors, comments, and snippets.",
      inputSchema: objectSchema(
        {
          reviewDisplayId: stringSchema("Review display ID such as GR-1"),
          threadRefs: { type: "array", items: stringSchema("Thread ref such as GT-12") },
          desiredOutcome: stringSchema("Optional handoff outcome"),
        },
        ["reviewDisplayId", "threadRefs"],
      ),
    },
    {
      name: "greenroom_report_attempted_fix",
      description: "Record an external attempted-fix event without mutating repository files.",
      inputSchema: objectSchema(
        {
          reviewDisplayId: stringSchema("Optional review display ID such as GR-1"),
          source: { type: "object", additionalProperties: true },
          threadRefs: { type: "array", items: stringSchema("Thread ref such as GT-12") },
          summary: stringSchema("Attempt summary"),
          metadata: { type: "object", additionalProperties: true },
        },
        ["source", "summary"],
      ),
    },
    {
      name: "greenroom_report_progress",
      description:
        "Report run-scoped workflow progress during long harness runs; counts as run activity.",
      inputSchema: objectSchema(
        {
          runId: stringSchema("Workflow run id such as workflow_run_1"),
          message: stringSchema("Short progress message"),
          completedUnits: numberSchema("Optional completed unit count"),
          totalUnits: numberSchema("Optional total unit count"),
          phase: stringSchema("Optional current phase label"),
        },
        ["runId", "message"],
      ),
    },
    {
      name: "greenroom_submit_review_findings_draft",
      description:
        "Validate a run-scoped built-in review findings draft without creating durable threads.",
      inputSchema: draftToolInputSchema("workflowBuiltinReviewDraftOutputSchema"),
    },
    {
      name: "greenroom_submit_spotlight_outline_draft",
      description:
        "Validate a run-scoped Spotlight outline draft without creating durable Spotlight records.",
      inputSchema: draftToolInputSchema("workflowSpotlightOutlineDraftOutputSchema"),
    },
    {
      name: "greenroom_submit_spotlight_membership_draft",
      description:
        "Validate a run-scoped Spotlight membership draft without creating durable Spotlight records.",
      inputSchema: draftToolInputSchema("workflowSpotlightMembershipDraftOutputSchema"),
    },
    {
      name: "greenroom_submit_teaching_draft",
      description:
        "Validate a run-scoped Teaching draft without creating durable Teaching records or threads.",
      inputSchema: draftToolInputSchema("workflowTeachingDraftOutputSchema"),
    },
  ];
}

export async function callGreenroomTool(
  client: GreenroomHttpClient,
  name: string,
  input: unknown,
): Promise<unknown> {
  switch (name) {
    case "greenroom_list_reviews":
      return client.listReviews(listReviewsInputSchema.parse(input ?? {}).state);
    case "greenroom_get_review": {
      const parsed = reviewInputSchema.parse(input);
      return client.getReview(parsed.reviewId);
    }
    case "greenroom_get_diff": {
      const parsed = diffInputSchema.parse(input);
      return client.getDiff(parsed.reviewId, parsed.revisionId);
    }
    case "greenroom_list_changed_files": {
      const parsed = changedFilesInputSchema.parse(input);
      return listChangedFilesTool(client, parsed);
    }
    case "greenroom_read_diff_file": {
      const parsed = readDiffFileInputSchema.parse(input);
      return readDiffFileTool(client, parsed);
    }
    case "greenroom_search_diff": {
      const parsed = searchDiffInputSchema.parse(input);
      return searchDiffTool(client, parsed);
    }
    case "greenroom_get_anchor_registry": {
      const parsed = anchorRegistryInputSchema.parse(input);
      return getAnchorRegistryTool(client, parsed);
    }
    case "greenroom_get_existing_threads": {
      const parsed = existingThreadsInputSchema.parse(input);
      return getExistingThreadsTool(client, parsed);
    }
    case "greenroom_get_spotlight_views": {
      const parsed = spotlightViewsReadInputSchema.parse(input);
      return getSpotlightViewsTool(client, parsed);
    }
    case "greenroom_get_view_diff": {
      const parsed = viewDiffReadInputSchema.parse(input);
      return getViewDiffTool(client, parsed);
    }
    case "greenroom_get_view": {
      const parsed = spotlightViewInputSchema.parse(input);
      return client.getSpotlightView(parsed.viewRef);
    }
    case "greenroom_get_line_membership": {
      const parsed = reviewInputSchema.parse(input);
      return client.getSpotlightLineMembership(parsed.reviewId);
    }
    case "greenroom_get_thread": {
      const parsed = threadRefInputSchema.parse(input);
      return client.getThread(parsed.threadRef);
    }
    case "greenroom_create_thread": {
      const parsed = mcpThreadCreateInputSchema.parse(input);
      return client.createThread(normalizeThreadCreateInput(parsed));
    }
    case "greenroom_reply_to_thread": {
      const parsed = threadReplyInputSchema.parse(input);
      return client.replyToThread(parsed.threadRef, {
        parentCommentId: parsed.parentCommentId,
        authorKind: parsed.authorKind,
        authorDisplayName: parsed.authorDisplayName,
        body: parsed.body,
      });
    }
    case "greenroom_resolve_thread": {
      const parsed = threadRefInputSchema.parse(input);
      return client.resolveThread(parsed.threadRef);
    }
    case "greenroom_dismiss_thread": {
      const parsed = threadRefInputSchema.parse(input);
      return client.dismissThread(parsed.threadRef);
    }
    case "greenroom_create_handoff": {
      const parsed = mcpHandoffRequestSchema.parse(input);
      return client.createHandoff(parsed);
    }
    case "greenroom_report_attempted_fix": {
      const parsed = attemptedFixInputSchema.parse(input);
      const normalized: AgentEventCreateInput = {
        ...parsed,
        eventType: "attempted_fix",
      };
      return client.reportAgentEvent(normalized);
    }
    case "greenroom_report_progress": {
      const parsed = progressReportInputSchema.parse(input);
      return client.reportWorkflowProgress({
        runId: parsed.runId,
        message: parsed.message,
        ...(parsed.completedUnits === undefined ? {} : { completedUnits: parsed.completedUnits }),
        ...(parsed.totalUnits === undefined ? {} : { totalUnits: parsed.totalUnits }),
        ...(parsed.phase === undefined ? {} : { phase: parsed.phase }),
      });
    }
    case "greenroom_submit_review_findings_draft":
      return submitDraftTool(
        client,
        reviewFindingsDraftInputSchema.safeParse(input),
        input,
        "builtin_review_findings",
        "workflowBuiltinReviewDraftOutputSchema",
      );
    case "greenroom_submit_spotlight_outline_draft":
      return submitDraftTool(
        client,
        spotlightOutlineDraftInputSchema.safeParse(input),
        input,
        "spotlight_outline",
        "workflowSpotlightOutlineDraftOutputSchema",
      );
    case "greenroom_submit_spotlight_membership_draft":
      return submitDraftTool(
        client,
        spotlightMembershipDraftInputSchema.safeParse(input),
        input,
        "spotlight_membership",
        "workflowSpotlightMembershipDraftOutputSchema",
      );
    case "greenroom_submit_teaching_draft":
      return submitDraftTool(
        client,
        teachingDraftInputSchema.safeParse(input),
        input,
        "teaching_draft",
        "workflowTeachingDraftOutputSchema",
      );
    default:
      throw new Error(`Unknown Greenroom MCP tool: ${name}`);
  }
}

type DraftParseResult =
  | ReturnType<typeof reviewFindingsDraftInputSchema.safeParse>
  | ReturnType<typeof spotlightOutlineDraftInputSchema.safeParse>
  | ReturnType<typeof spotlightMembershipDraftInputSchema.safeParse>
  | ReturnType<typeof teachingDraftInputSchema.safeParse>;

async function listChangedFilesTool(
  client: GreenroomHttpClient,
  input: z.output<typeof changedFilesInputSchema>,
): Promise<Record<string, unknown>> {
  const diff = await readCurrentDiffForHarnessTool(client, input.reviewId, input.revisionId);
  const page = paginate(diff.files.map(diffFileSummary), input.cursor, input.limit);

  return {
    schemaVersion: "greenroom.mcp.changed-files.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    files: page.items,
    pagination: { nextCursor: page.nextCursor },
  };
}

async function readDiffFileTool(
  client: GreenroomHttpClient,
  input: z.output<typeof readDiffFileInputSchema>,
): Promise<Record<string, unknown>> {
  const diff = await client.getDiffFile(input.reviewId, input.path, input.revisionId);
  const file = requireSingleDiffFile(diff, input.path);
  const page = paginate(
    file.hunks.map((hunk) =>
      hunkWithAnchorKeys(diff.review.displayId, diff.revision.id, file, hunk),
    ),
    input.cursor,
    input.limit,
  );

  return {
    schemaVersion: "greenroom.mcp.diff-file.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    file: {
      ...diffFileSummary(file),
      oldMode: file.oldMode,
      newMode: file.newMode,
      renameMetadata: file.renameMetadata,
      hunks: page.items,
    },
    pagination: { nextCursor: page.nextCursor },
  };
}

async function searchDiffTool(
  client: GreenroomHttpClient,
  input: z.output<typeof searchDiffInputSchema>,
): Promise<Record<string, unknown>> {
  const diff =
    input.path === undefined
      ? await readCurrentDiffForHarnessTool(client, input.reviewId, input.revisionId)
      : await client.getDiffFile(input.reviewId, input.path, input.revisionId);
  const files = input.path === undefined ? diff.files : [requireSingleDiffFile(diff, input.path)];
  const query = input.query.toLocaleLowerCase();
  const matches = files.flatMap((file) =>
    searchDiffFile(diff.review.displayId, diff.revision.id, file, query),
  );
  const page = paginate(matches, input.cursor, input.limit);

  return {
    schemaVersion: "greenroom.mcp.diff-search.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    query: input.query,
    matches: page.items,
    pagination: { nextCursor: page.nextCursor },
  };
}

async function getAnchorRegistryTool(
  client: GreenroomHttpClient,
  input: z.output<typeof anchorRegistryInputSchema>,
): Promise<Record<string, unknown>> {
  const diff =
    input.path === undefined
      ? await readCurrentDiffForHarnessTool(client, input.reviewId, input.revisionId)
      : await client.getDiffFile(input.reviewId, input.path, input.revisionId);
  const files = input.path === undefined ? diff.files : [requireSingleDiffFile(diff, input.path)];
  const anchors = files.flatMap((file) =>
    anchorsForDiffFile(diff.review.displayId, diff.revision.id, file),
  );
  const page = paginate(anchors, input.cursor, input.limit);

  return {
    schemaVersion: "greenroom.mcp.anchor-registry.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    path: input.path ?? null,
    anchors: page.items,
    pagination: { nextCursor: page.nextCursor },
  };
}

async function getExistingThreadsTool(
  client: GreenroomHttpClient,
  input: z.output<typeof existingThreadsInputSchema>,
): Promise<Record<string, unknown>> {
  const response = await client.listThreads(input.reviewId);
  const filtered = response.threads.filter((thread) => {
    if (input.status !== undefined && thread.status !== input.status) {
      return false;
    }

    return input.path === undefined || threadTouchesPath(thread, input.path);
  });
  const page = paginate(filtered.map(threadSummary), input.cursor, input.limit);

  return {
    schemaVersion: "greenroom.mcp.thread-summaries.v1",
    reviewDisplayId: input.reviewId,
    status: input.status ?? null,
    path: input.path ?? null,
    threads: page.items,
    pagination: { nextCursor: page.nextCursor },
  };
}

async function getSpotlightViewsTool(
  client: GreenroomHttpClient,
  input: z.output<typeof spotlightViewsReadInputSchema>,
): Promise<Record<string, unknown>> {
  const response = await client.listSpotlightViews(input.reviewId);
  const page = paginate(response.views, input.cursor, input.limit);

  return {
    schemaVersion: "greenroom.mcp.spotlight-views.v1",
    reviewDisplayId: input.reviewId,
    views: page.items,
    pagination: { nextCursor: page.nextCursor },
  };
}

async function getViewDiffTool(
  client: GreenroomHttpClient,
  input: z.output<typeof viewDiffReadInputSchema>,
): Promise<Record<string, unknown>> {
  const diff = await client.getSpotlightViewDiff(input.viewRef);

  if (input.path !== undefined) {
    const file = findDiffFile(diff.files, input.path);
    const page = paginate(
      file.hunks.map((hunk) =>
        hunkWithAnchorKeys(diff.view.reviewDisplayId, diff.revision.id, file, hunk),
      ),
      input.cursor,
      input.limit,
    );

    return {
      schemaVersion: "greenroom.mcp.spotlight-view-diff.v1",
      reviewDisplayId: diff.view.reviewDisplayId,
      view: diff.view,
      revision: diff.revision,
      regions: diff.regions,
      file: {
        ...diffFileSummary(file),
        oldMode: file.oldMode,
        newMode: file.newMode,
        renameMetadata: file.renameMetadata,
        hunks: page.items,
      },
      pagination: { nextCursor: page.nextCursor },
    };
  }

  const page = paginate(diff.files.map(diffFileSummary), input.cursor, input.limit);

  return {
    schemaVersion: "greenroom.mcp.spotlight-view-diff.v1",
    reviewDisplayId: diff.view.reviewDisplayId,
    view: diff.view,
    revision: diff.revision,
    regions: diff.regions,
    files: page.items,
    pagination: { nextCursor: page.nextCursor },
  };
}

async function submitDraftTool(
  client: GreenroomHttpClient,
  parsed: DraftParseResult,
  rawInput: unknown,
  draftKind: string,
  schemaName: string,
): Promise<Record<string, unknown>> {
  if (!parsed.success) {
    return {
      schemaVersion: "greenroom.mcp.draft-submission.v1",
      runId: rawRunId(rawInput),
      draftKind,
      validation: {
        valid: false,
        schemaImport: `${schemaName} from @greenroom/schemas`,
        issues: validationIssuesFromZod(parsed.error),
      },
      persistence: {
        status: "not_available",
        durable: false,
        reason: "Draft failed MCP schema validation; no persistence was attempted.",
      },
    };
  }

  try {
    const submission = await client.submitWorkflowDraft(parsed.data.runId, parsed.data.draft);

    return {
      schemaVersion: "greenroom.mcp.draft-submission.v1",
      runId: parsed.data.runId,
      draftKind,
      validation: {
        valid: submission.valid,
        schemaImport: `${schemaName} from @greenroom/schemas`,
        issues: submission.issues,
        repairContext: submission.repairContext,
      },
      persistence: {
        status: submission.valid ? "submitted" : "submitted_with_validation_issues",
        durable: true,
        runStatus: submission.run.status,
        phase: submission.run.phase,
        draftOutputStored: submission.run.draftOutput !== null,
        finalOutputStored: submission.run.finalOutput !== null,
      },
    };
  } catch (error) {
    if (error instanceof GreenroomHttpError && (error.status === 404 || error.status === 405)) {
      return pendingDraftSubmission(parsed.data.runId, draftKind, schemaName);
    }

    return {
      schemaVersion: "greenroom.mcp.draft-submission.v1",
      runId: parsed.data.runId,
      draftKind,
      validation: {
        valid: true,
        schemaImport: `${schemaName} from @greenroom/schemas`,
        issues: [],
      },
      persistence: {
        status: "not_available",
        durable: false,
        reason:
          error instanceof GreenroomHttpError
            ? `Workflow draft endpoint rejected the submission with status ${error.status}.`
            : "Workflow draft endpoint was not reachable.",
      },
    };
  }
}

function pendingDraftSubmission(
  runId: string,
  draftKind: string,
  schemaName: string,
): Record<string, unknown> {
  return {
    schemaVersion: "greenroom.mcp.draft-submission.v1",
    runId,
    draftKind,
    validation: {
      valid: true,
      schemaImport: `${schemaName} from @greenroom/schemas`,
      issues: [],
    },
    persistence: {
      status: "pending_orchestrator",
      durable: false,
      reason:
        "Workflow draft persistence endpoint was not available; MCP validated schema shape only and did not create durable records.",
    },
  };
}

async function readCurrentDiffForHarnessTool(
  client: GreenroomHttpClient,
  reviewId: z.output<typeof reviewReferenceSchema>,
  requestedRevisionId?: RevisionId,
) {
  const diff = await client.getDiff(reviewId);

  if (requestedRevisionId !== undefined && requestedRevisionId !== diff.revision.id) {
    throw new Error(
      `Greenroom harness read tools only support the current revision ${diff.revision.id}; requested stale revision ${requestedRevisionId}`,
    );
  }

  return diff;
}

function diffFileSummary(file: DiffFile): Record<string, unknown> {
  return {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    isBinary: file.isBinary,
    additions: file.additions,
    deletions: file.deletions,
    hunkCount: file.hunks.length,
    changedLineCount: file.isBinary
      ? 0
      : file.hunks.reduce(
          (sum, hunk) =>
            sum +
            hunk.lines.filter((line) => line.type === "addition" || line.type === "deletion")
              .length,
          0,
        ),
  };
}

function findDiffFile(files: readonly DiffFile[], path: string): DiffFile {
  const file = files.find((candidate) => candidate.path === path || candidate.oldPath === path);

  if (file === undefined) {
    throw new Error(`Changed file not found in current Greenroom revision: ${path}`);
  }

  return file;
}

function requireSingleDiffFile(diff: { files: readonly DiffFile[] }, path: string): DiffFile {
  const file = diff.files[0];

  if (file === undefined || (file.path !== path && file.oldPath !== path)) {
    throw new Error(`Changed file not found in current Greenroom revision: ${path}`);
  }

  return file;
}

function hunkWithAnchorKeys(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  file: DiffFile,
  hunk: DiffHunk,
): DiffHunk & { lines: Array<DiffLine & { anchorKey: string | null }> } {
  const anchorKeysByLine = anchorKeysByLineIdentity(reviewDisplayId, revisionId, file);

  return {
    ...hunk,
    lines: hunk.lines.map((line) => ({
      ...line,
      anchorKey: anchorKeysByLine.get(lineIdentity(hunk, line)) ?? null,
    })),
  };
}

function searchDiffFile(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  file: DiffFile,
  query: string,
): Array<Record<string, unknown>> {
  const matches: Array<Record<string, unknown>> = [];
  const anchorKeysByLine = anchorKeysByLineIdentity(reviewDisplayId, revisionId, file);

  if (
    file.path.toLocaleLowerCase().includes(query) ||
    file.oldPath?.toLocaleLowerCase().includes(query)
  ) {
    matches.push({
      matchType: "path",
      file: diffFileSummary(file),
    });
  }

  for (const hunk of file.hunks) {
    if (hunk.header.toLocaleLowerCase().includes(query)) {
      matches.push({
        matchType: "hunk_header",
        filePath: file.path,
        oldPath: file.oldPath,
        hunkId: hunk.id,
        hunkHeader: hunk.header,
      });
    }

    for (const line of hunk.lines) {
      if (!line.content.toLocaleLowerCase().includes(query)) {
        continue;
      }

      matches.push({
        matchType: "line",
        filePath: file.path,
        oldPath: file.oldPath,
        hunkId: hunk.id,
        hunkHeader: hunk.header,
        line,
        location: lineLocation(line),
        anchorKey: anchorKeysByLine.get(lineIdentity(hunk, line)) ?? null,
      });
    }
  }

  return matches;
}

function anchorKeysByLineIdentity(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  file: DiffFile,
): Map<string, string> {
  return new Map(
    anchorsForDiffFile(reviewDisplayId, revisionId, file).map((entry) => [
      `${entry.anchor.hunkId ?? ""}:${entry.anchor.lineType}:${entry.anchor.lineNumber}`,
      entry.anchorKey,
    ]),
  );
}

function lineIdentity(hunk: DiffHunk, line: DiffLine): string {
  if (line.type === "addition" && line.newLineNumber !== null) {
    return `${hunk.id}:${line.type}:${line.newLineNumber}`;
  }

  if (line.type === "deletion" && line.oldLineNumber !== null) {
    return `${hunk.id}:${line.type}:${line.oldLineNumber}`;
  }

  return `${hunk.id}:${line.type}:`;
}

function lineLocation(line: DiffLine): Record<string, unknown> {
  if (line.type === "addition") {
    return { side: "head", lineNumber: line.newLineNumber };
  }

  if (line.type === "deletion") {
    return { side: "base", lineNumber: line.oldLineNumber };
  }

  return {
    side: line.newLineNumber === null ? "base" : "head",
    lineNumber: line.newLineNumber ?? line.oldLineNumber,
  };
}

function threadTouchesPath(thread: ThreadWithComments, path: string): boolean {
  return thread.anchors.some((anchor) => anchor.filePath === path || anchor.oldFilePath === path);
}

function threadSummary(thread: ThreadWithComments): Record<string, unknown> {
  const firstComment = thread.comments[0] ?? null;
  const lastComment = thread.comments.at(-1) ?? null;

  return {
    shortRef: thread.shortRef,
    status: thread.status,
    type: thread.type,
    severity: thread.severity,
    outdated: thread.outdated,
    anchor: thread.anchor,
    anchors: thread.anchors,
    commentCount: thread.comments.length,
    firstCommentPreview: firstComment?.body.slice(0, 1000) ?? null,
    lastCommentPreview: lastComment?.body.slice(0, 1000) ?? null,
    source: {
      kind: thread.source.kind,
      displayName: thread.source.displayName,
      clientName: thread.source.clientName ?? null,
      toolName: thread.source.toolName ?? null,
      profileId: thread.source.profileId ?? null,
    },
  };
}

function paginate<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const offset = cursor === undefined ? 0 : parseCursor(cursor);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    items: page,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
  };
}

function parseCursor(cursor: string): number {
  const value = Number.parseInt(cursor, 10);

  if (!Number.isInteger(value) || value < 0 || String(value) !== cursor) {
    throw new Error("Pagination cursor must be a non-negative integer offset");
  }

  return value;
}

function validationIssuesFromZod(error: z.ZodError): WorkflowValidationIssue[] {
  return error.issues.map((issue) =>
    workflowValidationIssueSchema.parse({
      code: issue.code.slice(0, 80),
      message: issue.message.slice(0, 2000),
      severity: "error",
      path: issue.path.map((segment) => String(segment).slice(0, 80)).slice(0, 20),
      recoverable: true,
      metadata: {},
    }),
  );
}

function rawRunId(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const value = (input as { runId?: unknown }).runId;

  return typeof value === "string" ? value : null;
}

function normalizeThreadCreateInput(
  input: z.output<typeof mcpThreadCreateInputSchema>,
): ThreadCreateInput {
  const anchor = normalizeMcpThreadAnchor(input.reviewDisplayId, input.anchor);
  const anchors = (input.anchors ?? [input.anchor]).map((candidate) =>
    normalizeMcpThreadAnchor(input.reviewDisplayId, candidate),
  );

  return threadCreateInputSchema.parse({
    ...input,
    anchor,
    anchors,
  });
}

function normalizeMcpThreadAnchor(
  reviewDisplayId: ReviewDisplayId,
  anchor: ThreadCreateInput["anchor"],
): ThreadCreateInput["anchor"] {
  if (anchor.reviewDisplayId !== reviewDisplayId) {
    throw new Error("Thread anchor reviewDisplayId must match the target reviewDisplayId");
  }

  return anchor;
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringSchema(description: string): Record<string, unknown> {
  return {
    type: "string",
    description,
  };
}

function numberSchema(description: string): Record<string, unknown> {
  return {
    type: "number",
    description,
  };
}

function draftToolInputSchema(schemaName: string): Record<string, unknown> {
  return objectSchema(
    {
      runId: stringSchema("Workflow run ID such as workflow_run_1."),
      draft: {
        type: "object",
        additionalProperties: true,
        description: `Draft payload matching ${schemaName} from @greenroom/schemas.`,
      },
    },
    ["runId", "draft"],
  );
}
