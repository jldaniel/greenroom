import type { HarnessCommandPreset } from "./types";

export const claudeCodeReadOnlyTools = "Read,Grep,Glob,LS";

export const claudeCodePreset: HarnessCommandPreset = {
  kind: "claude-code",
  label: "Claude Code",
  streaming: "structured",
  buildInvocation(input) {
    const mcpArgs =
      input.request.mcp === null || input.request.mcp === undefined
        ? ["--tools", ""]
        : claudeMcpArgs(input);

    return {
      command: "claude",
      args: [
        "-p",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        ...claudeModelArgs(input.request.profile),
        ...mcpArgs,
        "--output-format",
        "stream-json",
        "--verbose",
        "--json-schema",
        input.schemaJson,
      ],
      stdin: input.request.prompt,
      env: mcpInvocationEnv(input),
    };
  },
  async parseOutput(input) {
    return parseClaudeCodeOutput(input.stdout);
  },
  parseStreamEvent(line) {
    return parseClaudeCodeStreamEvent(line);
  },
};

export function claudeModelArgs(
  profile: Parameters<HarnessCommandPreset["buildInvocation"]>[0]["request"]["profile"],
): string[] {
  const args: string[] = [];
  const model = profile.model.trim();

  if (model !== "claude-code" && model !== profile.harnessKind) {
    args.push("--model", model);
  }

  if (profile.reasoningLevel !== null && profile.reasoningLevel !== undefined) {
    args.push("--effort", profile.reasoningLevel);
  }

  return args;
}

function claudeMcpArgs(input: Parameters<HarnessCommandPreset["buildInvocation"]>[0]): string[] {
  // Built-in tools stay disabled for MCP-only runs: workflow runs must ground
  // reads through the Greenroom MCP tools, not the filesystem. Snapshot runs
  // execute inside an archive workspace and may use read/list/search tools.
  const args: string[] = [
    "--tools",
    input.request.repositoryAccess?.mode === "snapshot_readonly" ? claudeCodeReadOnlyTools : "",
  ];

  // Claude Code can consume a per-run MCP config file. The bridge writes this
  // into a temp directory and deletes it after the process exits; persistent
  // user setup still receives the same run-scoped env vars below.
  if (input.mcpConfigPath !== null) {
    args.push("--mcp-config", input.mcpConfigPath);
  }

  const allowedTools = input.request.mcp?.allowedTools ?? [];

  if (allowedTools.length > 0) {
    // MCP tool permissions use the mcp__<server>__<tool> form; "greenroom"
    // must match the server name in the per-run MCP config file. Without
    // this allowlist, --permission-mode dontAsk denies every MCP call.
    args.push("--allowedTools", allowedTools.map((tool) => `mcp__greenroom__${tool}`).join(","));
  }

  return args;
}

function mcpInvocationEnv(
  input: Parameters<HarnessCommandPreset["buildInvocation"]>[0],
): Record<string, string | undefined> {
  const mcp = input.request.mcp;

  if (mcp === null || mcp === undefined) {
    return {};
  }

  return {
    GREENROOM_MCP_CONFIG: input.mcpConfigPath ?? undefined,
    GREENROOM_MCP_SERVER_URL: mcp.serverUrl,
    GREENROOM_MCP_SERVER_PATH: mcp.serverPath,
    GREENROOM_MCP_URL: input.mcpUrl ?? undefined,
    GREENROOM_MCP_TOKEN: mcp.token,
    GREENROOM_API_TOKEN: mcp.token,
    GREENROOM_MCP_TOKEN_REF: mcp.tokenRef ?? undefined,
    GREENROOM_WORKFLOW_RUN_ID: input.request.runId,
    GREENROOM_WORKFLOW_OUTPUT_MODE: input.request.outputMode ?? undefined,
    GREENROOM_HARNESS_PROMPT_ID: input.request.promptId ?? undefined,
    GREENROOM_HARNESS_REPAIR_ATTEMPT: String(input.request.repairAttemptNumber ?? 0),
  };
}

export function parseClaudeCodeOutput(stdout: string): unknown {
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    throw new Error("Claude Code did not return schema-bound JSON output");
  }

  const parsed = parseClaudeCodeJsonEnvelope(trimmed);
  const result = isRecord(parsed) && "result" in parsed ? parsed.result : parsed;

  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch (error) {
      throw new Error("Claude Code did not return schema-bound JSON output", { cause: error });
    }
  }

  if (isRecord(result) || Array.isArray(result)) {
    return result;
  }

  throw new Error("Claude Code did not return schema-bound JSON output");
}

export function parseClaudeCodeStreamEvent(line: string) {
  const parsed = parseJsonOrNull(line);

  if (!isRecord(parsed)) {
    return null;
  }

  const type = stringField(parsed, "type");

  if (type === "assistant") {
    const text = assistantTextFromClaudeEvent(parsed);

    if (text.length > 0) {
      return {
        kind: "assistant_text" as const,
        summary: summarize(text, "Assistant output"),
        text,
        name: null,
        data: { sourceType: type },
      };
    }

    const tool = toolUseFromClaudeEvent(parsed);

    if (tool !== null) {
      return {
        kind: "tool_call" as const,
        summary: `Tool call: ${tool.name}`,
        text: null,
        name: tool.name,
        data: { id: tool.id, sourceType: type },
      };
    }
  }

  if (type === "user") {
    const toolResult = toolResultFromClaudeEvent(parsed);

    if (toolResult !== null) {
      return {
        kind: "tool_result" as const,
        summary: `Tool result: ${toolResult.id}`,
        text: toolResult.text,
        name: null,
        data: { id: toolResult.id, sourceType: type },
      };
    }
  }

  if (type === "result") {
    return {
      kind: "result" as const,
      summary: "Harness produced final result.",
      text:
        typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? null),
      name: null,
      data: { sourceType: type },
    };
  }

  if (type === "error") {
    const message = stringField(parsed, "message") ?? JSON.stringify(parsed);

    return {
      kind: "stderr_line" as const,
      summary: summarize(message, "Claude Code error"),
      text: message,
      name: null,
      data: { sourceType: type },
    };
  }

  return null;
}

function parseClaudeCodeJsonEnvelope(trimmed: string): unknown {
  const lines = trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return JSON.parse(trimmed);
  }

  for (const line of [...lines].reverse()) {
    const parsed = parseJsonOrNull(line);

    if (isRecord(parsed) && parsed.type === "result") {
      return parsed;
    }
  }

  return JSON.parse(trimmed);
}

function assistantTextFromClaudeEvent(event: Record<string, unknown>): string {
  const message = isRecord(event.message) ? event.message : null;
  const content = Array.isArray(message?.content) ? message.content : [];
  const parts = content.flatMap((entry) => {
    if (!isRecord(entry) || entry.type !== "text" || typeof entry.text !== "string") {
      return [];
    }

    return [entry.text];
  });

  return parts.join("\n").trim();
}

function toolUseFromClaudeEvent(
  event: Record<string, unknown>,
): { id: string | null; name: string } | null {
  const message = isRecord(event.message) ? event.message : null;
  const content = Array.isArray(message?.content) ? message.content : [];

  for (const entry of content) {
    if (!isRecord(entry) || entry.type !== "tool_use") {
      continue;
    }

    const name = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : "unknown";
    const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : null;
    return { id, name };
  }

  return null;
}

function toolResultFromClaudeEvent(
  event: Record<string, unknown>,
): { id: string; text: string | null } | null {
  const message = isRecord(event.message) ? event.message : null;
  const content = Array.isArray(message?.content) ? message.content : [];

  for (const entry of content) {
    if (!isRecord(entry) || entry.type !== "tool_result") {
      continue;
    }

    const id =
      typeof entry.tool_use_id === "string" && entry.tool_use_id.length > 0
        ? entry.tool_use_id
        : "unknown";
    const text = typeof entry.content === "string" ? entry.content : null;
    return { id, text };
  }

  return null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function summarize(value: string, fallback: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();

  if (compact.length === 0) {
    return fallback;
  }

  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function parseJsonOrNull(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
