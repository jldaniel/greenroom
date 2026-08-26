import {
  relativePathSchema,
  reviewReferenceSchema,
  revisionIdSchema,
  spotlightViewReferenceSchema,
  threadRefSchema,
  threadReferenceSchema,
  workflowRunIdSchema,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type HandoffRequest,
  type ReviewDisplayId,
  type ReviewReference,
  type RevisionId,
  type SpotlightViewReference,
  type ThreadAnchor,
  type ThreadReference,
  type ThreadWithComments,
  type WorkflowRunId,
} from "@greenroom/schemas";
import { threadAnchorLineKey as anchorLineKey } from "@greenroom/core";

import type { GreenroomHttpClient, ReviewDiffResource, ReviewResource } from "./client";

export interface GreenroomResource {
  uri: string;
  name: string;
  description: string;
  mimeType: "application/json";
}

export interface GreenroomResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: "application/json";
}

export interface GreenroomResourceContent {
  uri: string;
  mimeType: "application/json";
  text: string;
}

const conceptResourceDefinitions = [
  {
    uri: "greenroom://concepts/review-model",
    name: "Greenroom review model",
    description: "Small versioned overview of Greenroom review, revision, diff, and thread terms.",
  },
  {
    uri: "greenroom://concepts/anchors",
    name: "Greenroom anchors",
    description: "Small versioned overview of stable changed-line anchor keys.",
  },
  {
    uri: "greenroom://concepts/spotlight",
    name: "Greenroom Spotlight",
    description: "Small versioned overview of Spotlight Views and coverage.",
  },
  {
    uri: "greenroom://concepts/teaching",
    name: "Greenroom Teaching",
    description: "Small versioned overview of Teaching draft outputs.",
  },
] as const;

export function listGreenroomResources(): GreenroomResource[] {
  return conceptResourceDefinitions.map((resource) => ({
    ...resource,
    mimeType: "application/json",
  }));
}

export function listGreenroomResourceTemplates(): GreenroomResourceTemplate[] {
  return [
    {
      uriTemplate: "greenroom://reviews/{reviewId}/manifest",
      name: "Greenroom review manifest",
      description: "Small review manifest with repository display metadata and resource map.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/diff-summary",
      name: "Greenroom review diff summary",
      description: "Current revision diff summary without inline file hunks.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/files",
      name: "Greenroom changed files",
      description: "Current revision changed-file summaries with path-scoped resource links.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/files/{path}",
      name: "Greenroom changed file diff",
      description: "Current revision structured diff scoped to one changed file path.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/anchors/{path}",
      name: "Greenroom changed file anchors",
      description: "Stable changed-line anchor registry scoped to one file path.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/threads",
      name: "Greenroom existing thread summaries",
      description: "Review thread summaries without direct mutation.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/spotlight/views",
      name: "Greenroom Spotlight Views",
      description: "Spotlight Views with health state and associated files.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/spotlight/coverage",
      name: "Greenroom Spotlight coverage",
      description: "Current revision Spotlight coverage gaps as changed-line anchors.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://runs/{runId}/instructions",
      name: "Greenroom workflow run instructions",
      description: "Run-scoped harness instructions when orchestration endpoints are available.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://runs/{runId}/output-schema",
      name: "Greenroom workflow run output schema",
      description: "Run-scoped expected draft output contract when orchestration endpoints exist.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://runs/{runId}/consent-scope",
      name: "Greenroom workflow run consent scope",
      description: "Run-scoped consent and approved scope when orchestration endpoints exist.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://runs/{runId}/validation-errors",
      name: "Greenroom workflow run validation errors",
      description: "Run-scoped validation issues when orchestration endpoints exist.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://threads/{threadRef}",
      name: "Greenroom thread",
      description: "One thread with comments, addressed by global ref such as GT-12.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://spotlight/views/{viewRef}",
      name: "Greenroom Spotlight View",
      description: "One Spotlight View with lit regions, addressed by global ref such as SV-3.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://spotlight/views/{viewRef}/diff",
      name: "Greenroom Spotlight View diff",
      description: "Current structured diff scoped to one Spotlight View.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "greenroom://reviews/{reviewId}/handoff?threadRefs={threadRefs}",
      name: "Greenroom handoff bundle",
      description: "Selected-thread handoff bundle with anchors, comments, and snippets.",
      mimeType: "application/json",
    },
  ];
}

export async function readGreenroomResource(
  client: GreenroomHttpClient,
  uri: string,
): Promise<GreenroomResourceContent> {
  const parsed = parseGreenroomUri(uri);
  let payload: unknown;

  switch (parsed.kind) {
    case "concept":
      payload = conceptPayload(parsed.concept);
      break;
    case "review_manifest":
      payload = await reviewManifestPayload(client, parsed.reviewId);
      break;
    case "review_diff_summary":
      payload = diffSummaryPayload(
        await readCurrentDiff(client, parsed.reviewId, parsed.revisionId),
      );
      break;
    case "review_files":
      payload = filesPayload(await readCurrentDiff(client, parsed.reviewId, parsed.revisionId));
      break;
    case "review_file":
      payload = filePayload(
        await readCurrentDiffFile(client, parsed.reviewId, parsed.path, parsed.revisionId),
        parsed.path,
      );
      break;
    case "review_anchors":
      payload = anchorsPayload(
        await readCurrentDiffFile(client, parsed.reviewId, parsed.path, parsed.revisionId),
        parsed.path,
      );
      break;
    case "review_threads": {
      const threads = await client.listThreads(parsed.reviewId);
      payload = threadsPayload(parsed.reviewId, threads.threads);
      break;
    }
    case "thread":
      payload = await client.getThread(parsed.threadRef);
      break;
    case "spotlight_views":
      payload = await client.listSpotlightViews(parsed.reviewId);
      break;
    case "spotlight_coverage":
      payload = await client.getSpotlightCoverage(parsed.reviewId);
      break;
    case "spotlight_view":
      payload = await client.getSpotlightView(parsed.viewRef);
      break;
    case "spotlight_view_diff":
      payload = await client.getSpotlightViewDiff(parsed.viewRef);
      break;
    case "handoff":
      payload = await client.createHandoff({
        reviewDisplayId: parsed.reviewId,
        threadRefs: parsed.threadRefs,
        desiredOutcome: parsed.desiredOutcome,
      });
      break;
    case "run_resource":
      payload = runResourcePayload(parsed.runId, parsed.resource);
      break;
    default:
      assertNever(parsed);
  }

  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(payload, null, 2),
  };
}

type ConceptName = "review-model" | "anchors" | "spotlight" | "teaching";
type RunResourceName = "instructions" | "output-schema" | "consent-scope" | "validation-errors";

type ParsedGreenroomUri =
  | { kind: "concept"; concept: ConceptName }
  | { kind: "review_manifest"; reviewId: ReviewReference }
  | { kind: "review_diff_summary"; reviewId: ReviewReference; revisionId?: RevisionId }
  | { kind: "review_files"; reviewId: ReviewReference; revisionId?: RevisionId }
  | { kind: "review_file"; reviewId: ReviewReference; path: string; revisionId?: RevisionId }
  | { kind: "review_anchors"; reviewId: ReviewReference; path: string; revisionId?: RevisionId }
  | { kind: "review_threads"; reviewId: ReviewReference }
  | { kind: "thread"; threadRef: ThreadReference }
  | { kind: "spotlight_views"; reviewId: ReviewReference }
  | { kind: "spotlight_coverage"; reviewId: ReviewReference }
  | { kind: "spotlight_view"; viewRef: SpotlightViewReference }
  | { kind: "spotlight_view_diff"; viewRef: SpotlightViewReference }
  | {
      kind: "handoff";
      reviewId: ReviewReference;
      threadRefs: HandoffRequest["threadRefs"];
      desiredOutcome: HandoffRequest["desiredOutcome"];
    }
  | { kind: "run_resource"; runId: WorkflowRunId; resource: RunResourceName };

function parseGreenroomUri(uri: string): ParsedGreenroomUri {
  const parsed = new URL(uri);

  if (parsed.protocol !== "greenroom:") {
    throw new Error(`Unsupported Greenroom resource URI: ${uri}`);
  }

  if (parsed.hostname === "concepts") {
    const [concept, extra] = splitPath(parsed.pathname);

    if (extra !== undefined) {
      throw new Error(`Unsupported Greenroom concept resource URI: ${uri}`);
    }

    return { kind: "concept", concept: parseConceptName(concept, uri) };
  }

  if (parsed.hostname === "reviews") {
    return parseReviewUri(parsed, uri);
  }

  if (parsed.hostname === "threads") {
    const [threadRefSegment, extra] = splitPath(parsed.pathname);

    if (threadRefSegment === undefined || extra !== undefined) {
      throw new Error(`Unsupported Greenroom thread resource URI: ${uri}`);
    }

    return { kind: "thread", threadRef: threadReferenceSchema.parse(threadRefSegment) };
  }

  if (parsed.hostname === "spotlight") {
    return parseSpotlightUri(parsed, uri);
  }

  if (parsed.hostname === "runs") {
    return parseRunUri(parsed, uri);
  }

  throw new Error(`Unsupported Greenroom resource URI: ${uri}`);
}

function parseReviewUri(parsed: URL, uri: string): ParsedGreenroomUri {
  const [reviewIdSegment, resourceKind, resourceDetail, resourceId, resourceAction, ...extra] =
    splitPath(parsed.pathname);

  if (reviewIdSegment === undefined || resourceKind === undefined) {
    throw new Error(`Unsupported Greenroom review resource URI: ${uri}`);
  }

  const reviewId = reviewReferenceSchema.parse(reviewIdSegment);
  const revisionId = parseRevisionQuery(parsed.searchParams.get("revisionId"));

  if (resourceKind === "manifest" && resourceDetail === undefined) {
    return { kind: "review_manifest", reviewId };
  }

  if (resourceKind === "diff-summary" && resourceDetail === undefined) {
    return {
      kind: "review_diff_summary",
      reviewId,
      ...(revisionId !== undefined ? { revisionId } : {}),
    };
  }

  if (resourceKind === "files") {
    if (resourceDetail === undefined) {
      return {
        kind: "review_files",
        reviewId,
        ...(revisionId !== undefined ? { revisionId } : {}),
      };
    }

    return {
      kind: "review_file",
      reviewId,
      path: relativePathSchema.parse(
        [resourceDetail, resourceId, resourceAction, ...extra]
          .filter((segment): segment is string => segment !== undefined)
          .join("/"),
      ),
      ...(revisionId !== undefined ? { revisionId } : {}),
    };
  }

  if (resourceKind === "anchors" && resourceDetail !== undefined) {
    return {
      kind: "review_anchors",
      reviewId,
      path: relativePathSchema.parse(
        [resourceDetail, resourceId, resourceAction, ...extra]
          .filter((segment): segment is string => segment !== undefined)
          .join("/"),
      ),
      ...(revisionId !== undefined ? { revisionId } : {}),
    };
  }

  if (resourceKind === "threads" && resourceDetail === undefined) {
    return { kind: "review_threads", reviewId };
  }

  if (resourceKind === "spotlight" && resourceDetail === "views" && resourceId === undefined) {
    return { kind: "spotlight_views", reviewId };
  }

  if (resourceKind === "spotlight" && resourceDetail === "coverage" && resourceId === undefined) {
    return { kind: "spotlight_coverage", reviewId };
  }

  if (resourceKind === "handoff" && resourceDetail === undefined) {
    const threadRefs = parseThreadRefs(parsed.searchParams.get("threadRefs"));
    const desiredOutcome = parsed.searchParams.get("desiredOutcome");

    return {
      kind: "handoff",
      reviewId,
      threadRefs,
      desiredOutcome,
    };
  }

  throw new Error(`Unsupported Greenroom review resource URI: ${uri}`);
}

function parseSpotlightUri(parsed: URL, uri: string): ParsedGreenroomUri {
  const [resourceKind, viewRefSegment, action, ...extra] = splitPath(parsed.pathname);

  if (resourceKind !== "views" || viewRefSegment === undefined || extra.length > 0) {
    throw new Error(`Unsupported Greenroom spotlight resource URI: ${uri}`);
  }

  const viewRef = spotlightViewReferenceSchema.parse(viewRefSegment);

  if (action === undefined) {
    return { kind: "spotlight_view", viewRef };
  }

  if (action === "diff") {
    return { kind: "spotlight_view_diff", viewRef };
  }

  throw new Error(`Unsupported Greenroom spotlight resource URI: ${uri}`);
}

function parseRunUri(parsed: URL, uri: string): ParsedGreenroomUri {
  const [runIdSegment, resource, extra] = splitPath(parsed.pathname);

  if (runIdSegment === undefined || resource === undefined || extra !== undefined) {
    throw new Error(`Unsupported Greenroom run resource URI: ${uri}`);
  }

  if (
    resource !== "instructions" &&
    resource !== "output-schema" &&
    resource !== "consent-scope" &&
    resource !== "validation-errors"
  ) {
    throw new Error(`Unsupported Greenroom run resource URI: ${uri}`);
  }

  return {
    kind: "run_resource",
    runId: workflowRunIdSchema.parse(runIdSegment),
    resource,
  };
}

function splitPath(pathname: string): string[] {
  return pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

function parseConceptName(value: string | undefined, uri: string): ConceptName {
  if (
    value === "review-model" ||
    value === "anchors" ||
    value === "spotlight" ||
    value === "teaching"
  ) {
    return value;
  }

  throw new Error(`Unsupported Greenroom concept resource URI: ${uri}`);
}

function parseRevisionQuery(value: string | null): RevisionId | undefined {
  return value === null || value.trim().length === 0 ? undefined : revisionIdSchema.parse(value);
}

function parseThreadRefs(value: string | null): HandoffRequest["threadRefs"] {
  if (value === null || value.trim().length === 0) {
    throw new Error("Greenroom handoff resources require at least one threadRefs query value");
  }

  return value.split(",").map((threadRef) => threadRefSchema.parse(threadRef.trim()));
}

function conceptPayload(concept: ConceptName): Record<string, unknown> {
  const base = {
    schemaVersion: "greenroom.mcp.concept.v1",
    concept,
  };

  switch (concept) {
    case "review-model":
      return {
        ...base,
        summary:
          "A Greenroom review points at one repository range and has a current revision. Harnesses should read scoped resources instead of requesting the full diff inline.",
        terms: {
          reviewId: "Review display ID such as GR-1; the only accepted review reference.",
          revisionId: "Immutable snapshot id. Harness resources default to the current revision.",
          changedFile: "One file entry from the current structured diff.",
          thread: "A user-visible review discussion anchored to changed lines.",
        },
      };
    case "anchors":
      return {
        ...base,
        summary:
          "Anchor keys identify changed lines and are the only durable references draft outputs should use for review findings and Spotlight membership.",
        keyFormat: "reviewDisplayId:revisionId:filePath:oldFilePath:side:lineType:lineNumber",
        rules: [
          "Use anchor keys exactly as returned by Greenroom resources or tools.",
          "Do not invent paths, line numbers, or anchor keys.",
          "Use head/addition anchors for added lines and base/deletion anchors for deleted lines.",
        ],
      };
    case "spotlight":
      return {
        ...base,
        summary:
          "Spotlight Views are named slices of the current diff. Each view groups changed-line anchors by intent and may overlap other views.",
        rules: [
          "Plan draft outputs propose view keys, titles, intents, and rationale.",
          "Membership draft outputs assign known anchor keys to proposed view keys.",
          "Some changed lines may remain uncovered.",
        ],
      };
    case "teaching":
      return {
        ...base,
        summary:
          "Teaching draft outputs explain the approved review scope and produce walkthrough and quiz material without creating review threads.",
        rules: [
          "Teaching drafts may reference anchors but must not promote comments directly.",
          "Explain the actual changed code and avoid repository mutation.",
          "Return structured teaching output for Greenroom validation.",
          "Optional diagrams: a top-level diagrams array of { id, title, mermaidSource } with raw Mermaid text; walkthrough points may reference one diagram by diagramId.",
          "Optional excerpts: walkthrough points and quiz questions may attach excerpt references of kind anchor (an approved-scope anchor) or kind lines (filePath, side, startLine, endLine within the approved scope).",
        ],
      };
  }
}

async function reviewManifestPayload(
  client: GreenroomHttpClient,
  reviewId: ReviewReference,
): Promise<Record<string, unknown>> {
  const resource = await client.getReview(reviewId);

  return {
    schemaVersion: "greenroom.mcp.review-manifest.v1",
    currentRevisionOnly: true,
    review: {
      displayId: resource.review.displayId,
      title: resource.review.title,
      status: resource.review.status,
      baseRefDisplay: resource.review.baseRefDisplay,
      headRefDisplay: resource.review.headRefDisplay,
      currentRevisionId: resource.review.currentRevisionId,
      createdAt: resource.review.createdAt,
      updatedAt: resource.review.updatedAt,
    },
    repository: sanitizeRepository(resource),
    currentRevision: resource.currentRevision,
    resources: {
      diffSummary: `greenroom://reviews/${encodeURIComponent(resource.review.displayId)}/diff-summary`,
      files: `greenroom://reviews/${encodeURIComponent(resource.review.displayId)}/files`,
      threads: `greenroom://reviews/${encodeURIComponent(resource.review.displayId)}/threads`,
      spotlightViews: `greenroom://reviews/${encodeURIComponent(resource.review.displayId)}/spotlight/views`,
      spotlightCoverage: `greenroom://reviews/${encodeURIComponent(resource.review.displayId)}/spotlight/coverage`,
    },
    readTools: [
      "greenroom_list_changed_files",
      "greenroom_read_diff_file",
      "greenroom_search_diff",
      "greenroom_get_anchor_registry",
      "greenroom_get_existing_threads",
      "greenroom_get_spotlight_views",
      "greenroom_get_view_diff",
    ],
    progressTools: ["greenroom_report_progress"],
    draftTools: [
      "greenroom_submit_review_findings_draft",
      "greenroom_submit_spotlight_outline_draft",
      "greenroom_submit_spotlight_membership_draft",
      "greenroom_submit_teaching_draft",
    ],
  };
}

function sanitizeRepository(resource: ReviewResource): Record<string, unknown> {
  return {
    id: resource.repository.id,
    displayName: resource.repository.displayName,
    defaultBranchCandidate: resource.repository.defaultBranchCandidate,
    spotlightConfig: resource.repository.spotlightConfig,
  };
}

async function readCurrentDiff(
  client: GreenroomHttpClient,
  reviewId: ReviewReference,
  requestedRevisionId?: RevisionId,
): Promise<ReviewDiffResource> {
  const diff = await client.getDiff(reviewId);

  if (requestedRevisionId !== undefined && requestedRevisionId !== diff.revision.id) {
    throw new Error(
      `Greenroom MCP review resources only support the current revision ${diff.revision.id}; requested stale revision ${requestedRevisionId}`,
    );
  }

  return diff;
}

async function readCurrentDiffFile(
  client: GreenroomHttpClient,
  reviewId: ReviewReference,
  path: string,
  requestedRevisionId?: RevisionId,
): Promise<ReviewDiffResource> {
  return client.getDiffFile(reviewId, path, requestedRevisionId);
}

function diffSummaryPayload(diff: ReviewDiffResource): Record<string, unknown> {
  return {
    schemaVersion: "greenroom.mcp.diff-summary.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    diffSummary: diff.revision.diffSummary,
  };
}

function filesPayload(diff: ReviewDiffResource): Record<string, unknown> {
  return {
    schemaVersion: "greenroom.mcp.changed-files.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    files: diff.files.map((file) => ({
      ...diffFileSummary(file),
      resourceUri: `greenroom://reviews/${encodeURIComponent(
        diff.review.displayId,
      )}/files/${encodeResourcePath(file.path)}`,
      anchorsUri: `greenroom://reviews/${encodeURIComponent(
        diff.review.displayId,
      )}/anchors/${encodeResourcePath(file.path)}`,
    })),
  };
}

function filePayload(diff: ReviewDiffResource, path: string): Record<string, unknown> {
  const file = findDiffFile(diff.files, path);

  return {
    schemaVersion: "greenroom.mcp.diff-file.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    file: fileWithAnchorKeys(diff.review.displayId, diff.revision.id, file),
    anchorCount: anchorsForDiffFile(diff.review.displayId, diff.revision.id, file).length,
  };
}

function anchorsPayload(diff: ReviewDiffResource, path: string): Record<string, unknown> {
  const file = findDiffFile(diff.files, path);

  return {
    schemaVersion: "greenroom.mcp.anchor-registry.v1",
    reviewDisplayId: diff.review.displayId,
    revisionId: diff.revision.id,
    currentRevisionOnly: true,
    path: file.path,
    oldPath: file.oldPath,
    anchors: anchorsForDiffFile(diff.review.displayId, diff.revision.id, file),
  };
}

function threadsPayload(
  reviewId: ReviewReference,
  threads: ThreadWithComments[],
): Record<string, unknown> {
  return {
    schemaVersion: "greenroom.mcp.thread-summaries.v1",
    reviewDisplayId: reviewId,
    threads: threads.map(threadSummary),
  };
}

function runResourcePayload(
  runId: WorkflowRunId,
  resource: RunResourceName,
): Record<string, unknown> {
  const base = {
    schemaVersion: "greenroom.mcp.run-resource.v1",
    runId,
    resource,
    status: "not_available",
    reason:
      "Workflow orchestration read endpoints are not available until Epic E5. MCP is exposing the contract surface without implementing workflow lifecycle.",
  };

  if (resource === "output-schema") {
    return {
      ...base,
      outputContracts: [
        {
          draftTool: "greenroom_submit_review_findings_draft",
          kind: "builtin_review_findings",
          schemaImport: "workflowBuiltinReviewDraftOutputSchema from @greenroom/schemas",
        },
        {
          draftTool: "greenroom_submit_spotlight_outline_draft",
          kind: "spotlight_outline",
          schemaImport: "workflowSpotlightOutlineDraftOutputSchema from @greenroom/schemas",
        },
        {
          draftTool: "greenroom_submit_spotlight_membership_draft",
          kind: "spotlight_membership",
          schemaImport: "workflowSpotlightMembershipDraftOutputSchema from @greenroom/schemas",
        },
        {
          draftTool: "greenroom_submit_teaching_draft",
          kind: "teaching_draft",
          schemaImport: "workflowTeachingDraftOutputSchema from @greenroom/schemas",
        },
        {
          draftTool: null,
          kind: "teaching_follow_up_answer",
          schemaImport: "workflowTeachingFollowUpAnswerOutputSchema from @greenroom/schemas",
          submission: "structured_stdout_only",
        },
      ],
    };
  }

  if (resource === "instructions") {
    return {
      ...base,
      promptNames: [
        "greenroom_review_prompt",
        "greenroom_spotlight_plan_prompt",
        "greenroom_spotlight_membership_prompt",
        "greenroom_teaching_prompt",
        "greenroom_validation_repair_prompt",
      ],
      noRepoMutationRule:
        "Harness workflows may inspect repository state but must not write files, apply patches, commit, branch, rebase, tag, push, or publish.",
    };
  }

  if (resource === "validation-errors") {
    return {
      ...base,
      validationIssues: [],
      note: "Draft tools return immediate schema validation issues even before durable run validation exists.",
    };
  }

  return base;
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

function fileWithAnchorKeys(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  file: DiffFile,
): DiffFile & {
  hunks: Array<DiffHunk & { lines: Array<DiffLine & { anchorKey: string | null }> }>;
} {
  return {
    ...file,
    hunks: file.hunks.map((hunk) => ({
      ...hunk,
      lines: hunk.lines.map((line, index) => {
        const anchor = anchorForChangedLine(reviewDisplayId, revisionId, file, hunk, line, index);

        return {
          ...line,
          anchorKey: anchor === null ? null : anchorLineKey(anchor),
        };
      }),
    })),
  };
}

export function anchorsForDiffFile(
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  file: DiffFile,
): Array<{
  anchorKey: string;
  anchor: ThreadAnchor;
  content: string | null;
}> {
  if (file.isBinary) {
    return [];
  }

  return file.hunks
    .flatMap((hunk) =>
      hunk.lines.flatMap((line, index) => {
        const anchor = anchorForChangedLine(reviewDisplayId, revisionId, file, hunk, line, index);

        if (anchor === null) {
          return [];
        }

        return [
          {
            anchorKey: anchorLineKey(anchor),
            anchor,
            content: anchor.originalLineText,
          },
        ];
      }),
    )
    .sort((left, right) => left.anchorKey.localeCompare(right.anchorKey));
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

function encodeResourcePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Greenroom resource kind: ${JSON.stringify(value)}`);
}
