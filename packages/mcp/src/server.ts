import * as z from "zod";

import type { GreenroomHttpClient } from "./client";
import {
  listGreenroomResources,
  listGreenroomResourceTemplates,
  readGreenroomResource,
} from "./resources";
import { callGreenroomTool, listGreenroomTools } from "./tools";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface GreenroomMcpServerOptions {
  client: GreenroomHttpClient;
  name?: string;
  version?: string;
}

export function createGreenroomMcpServer(options: GreenroomMcpServerOptions) {
  return {
    async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
      const parsed = jsonRpcRequestSchema.parse(message);

      if (parsed.id === undefined) {
        return null;
      }

      const request: JsonRpcRequest = {
        jsonrpc: parsed.jsonrpc,
        id: parsed.id,
        method: parsed.method,
        ...(parsed.params !== undefined ? { params: parsed.params } : {}),
      };

      try {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: await handleRequest(options, request),
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : "Greenroom MCP request failed",
          },
        };
      }
    },
  };
}

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().trim().min(1),
  params: z.unknown().optional(),
});

const toolCallParamsSchema = z.object({
  name: z.string().trim().min(1),
  arguments: z.unknown().optional(),
});

const resourceReadParamsSchema = z.object({
  uri: z.string().trim().min(1),
});
const promptGetParamsSchema = z.object({
  name: z.string().trim().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

async function handleRequest(
  options: GreenroomMcpServerOptions,
  request: JsonRpcRequest,
): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: {
          name: options.name ?? "greenroom",
          version: options.version ?? "0.0.0",
        },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: listGreenroomTools() };
    case "tools/call": {
      const params = toolCallParamsSchema.parse(request.params);
      const result = await callGreenroomTool(options.client, params.name, params.arguments ?? {});

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    case "resources/list":
      return { resources: listGreenroomResources() };
    case "resources/templates/list":
      return { resourceTemplates: listGreenroomResourceTemplates() };
    case "resources/read": {
      const params = resourceReadParamsSchema.parse(request.params);
      return { contents: [await readGreenroomResource(options.client, params.uri)] };
    }
    case "prompts/list":
      return { prompts: listGreenroomPrompts() };
    case "prompts/get": {
      const params = promptGetParamsSchema.parse(request.params);
      return getGreenroomPrompt(params.name, params.arguments ?? {});
    }
    default:
      throw new Error(`Unsupported MCP method: ${request.method}`);
  }
}

const greenroomPromptDefinitions = [
  {
    name: "greenroom_review_prompt",
    description: "Run built-in review draft generation through Greenroom MCP context resources.",
  },
  {
    name: "greenroom_spotlight_plan_prompt",
    description: "Plan Spotlight View outline drafts from scoped Greenroom review context.",
  },
  {
    name: "greenroom_spotlight_membership_prompt",
    description: "Assign anchor keys to approved Spotlight outline view keys.",
  },
  {
    name: "greenroom_teaching_prompt",
    description: "Generate structured Teaching draft output from approved Greenroom scope.",
  },
  {
    name: "greenroom_validation_repair_prompt",
    description: "Repair a prior draft using Greenroom validation errors only.",
  },
] as const;

type GreenroomPromptName = (typeof greenroomPromptDefinitions)[number]["name"];

function listGreenroomPrompts() {
  return greenroomPromptDefinitions.map((prompt) => ({
    ...prompt,
    arguments: [
      {
        name: "runId",
        description: "Optional workflow run id such as workflow_run_1.",
        required: false,
      },
      {
        name: "reviewId",
        description: "Optional review display ID such as GR-1.",
        required: false,
      },
    ],
  }));
}

function getGreenroomPrompt(name: string, args: Record<string, unknown>) {
  const prompt = greenroomPromptDefinitions.find((candidate) => candidate.name === name);

  if (prompt === undefined) {
    throw new Error(`Unknown Greenroom MCP prompt: ${name}`);
  }

  return {
    description: prompt.description,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: promptText(prompt.name, args),
        },
      },
    ],
  };
}

function promptText(name: GreenroomPromptName, args: Record<string, unknown>): string {
  const runLine =
    typeof args.runId === "string" && args.runId.trim().length > 0
      ? `Workflow run: ${args.runId.trim()}`
      : "Workflow run: read the run id from the surrounding harness invocation.";
  const reviewLine =
    typeof args.reviewId === "string" && args.reviewId.trim().length > 0
      ? `Review: ${args.reviewId.trim()}`
      : "Review: read the review id from run resources or the surrounding harness invocation.";

  switch (name) {
    case "greenroom_review_prompt":
      return [
        "You are generating a Greenroom built-in review draft.",
        runLine,
        reviewLine,
        commonPromptRules(),
        "Allowed reads: review manifest, diff-summary, changed files, one file diff at a time, anchor registry, existing threads, Spotlight views, and Spotlight coverage.",
        "Use tools: greenroom_list_changed_files, greenroom_read_diff_file, greenroom_search_diff, greenroom_get_anchor_registry, greenroom_get_existing_threads, greenroom_get_spotlight_views.",
        "Submit exactly one draft with greenroom_submit_review_findings_draft. The draft kind must be builtin_review_findings and every finding must use known anchorKey values.",
      ].join("\n\n");
    case "greenroom_spotlight_plan_prompt":
      return [
        "You are planning Greenroom Spotlight View outline drafts.",
        runLine,
        reviewLine,
        commonPromptRules(),
        "Allowed reads: manifest, diff-summary, changed files, selected file diffs, anchor registry, existing Spotlight views, and coverage.",
        "Use tools: greenroom_list_changed_files, greenroom_read_diff_file, greenroom_search_diff, greenroom_get_anchor_registry, greenroom_get_spotlight_views.",
        "Submit exactly one draft with greenroom_submit_spotlight_outline_draft. The draft kind must be spotlight_outline and view keys must be stable within the draft.",
      ].join("\n\n");
    case "greenroom_spotlight_membership_prompt":
      return [
        "You are assigning changed-line anchors to approved Greenroom Spotlight outline view keys.",
        runLine,
        reviewLine,
        commonPromptRules(),
        "Allowed reads: changed files, path-scoped file diffs, anchor registry, existing Spotlight views, and coverage.",
        "Use tools: greenroom_get_anchor_registry, greenroom_read_diff_file, greenroom_search_diff, greenroom_get_spotlight_views.",
        "Submit exactly one draft with greenroom_submit_spotlight_membership_draft. The draft kind must be spotlight_membership and all anchorKeys must come from Greenroom.",
      ].join("\n\n");
    case "greenroom_teaching_prompt":
      return [
        "You are generating a Greenroom Teaching draft.",
        runLine,
        reviewLine,
        commonPromptRules(),
        "Allowed reads: manifest, diff-summary, changed files, selected file diffs, anchors, Spotlight views, view diffs, and existing threads when relevant.",
        "Use tools: greenroom_list_changed_files, greenroom_read_diff_file, greenroom_search_diff, greenroom_get_anchor_registry, greenroom_get_spotlight_views, greenroom_get_view_diff.",
        "Submit exactly one draft with greenroom_submit_teaching_draft. The draft kind must be teaching_draft and must match the shared Teaching output contract.",
        'Optional teaching blocks: a top-level diagrams array holds Mermaid diagrams as { id, title, mermaidSource } with raw Mermaid text (no code fences); walkthrough points may reference one diagram by diagramId. Walkthrough points and quiz questions may attach excerpts entries that are either { kind: "anchor", anchor: <approved-scope anchor> } or { kind: "lines", filePath, side, startLine, endLine } targeting a changed file in the approved scope.',
      ].join("\n\n");
    case "greenroom_validation_repair_prompt":
      return [
        "You are repairing a previous Greenroom workflow draft.",
        runLine,
        reviewLine,
        commonPromptRules(),
        "Read validation errors from greenroom://runs/{runId}/validation-errors when available and repair only the fields identified by Greenroom validation issues.",
        "Do not broaden scope, add unrelated findings, or invent anchors. Resubmit with the same draft tool used by the original workflow.",
      ].join("\n\n");
  }
}

function commonPromptRules(): string {
  return [
    "Do not modify repository files, apply patches, run formatters that write files, commit, branch, rebase, tag, push, publish, or write repository-local state.",
    "Do not use direct external-write tools such as greenroom_create_thread for built-in workflow output.",
    "Read Greenroom context incrementally. Prefer path-scoped file reads and searches over full diff reads.",
    "Report progress with greenroom_report_progress at natural boundaries such as each file, Spotlight view, or Teaching section.",
    "If validation fails, repair the draft from the returned validation issues and resubmit only the corrected draft.",
  ].join("\n");
}
