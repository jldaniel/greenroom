import { chmod, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
  HarnessCommandPreset,
  HarnessInteractiveSession,
  HarnessStreamEventDraft,
} from "./types";

const initializeRequestId = 1;
const threadStartRequestId = 2;
const turnStartRequestId = 3;

/**
 * Codex app-server runs with a fresh CODEX_HOME containing only the existing
 * login credential. This prevents user config, rules, plugins, skills, and MCP
 * servers from entering a Greenroom run while preserving subscription auth.
 */
export const codexPreset: HarnessCommandPreset = {
  kind: "codex",
  label: "Codex",
  streaming: "structured",
  buildInvocation(input) {
    const workDir = input.workDir ?? dirname(input.schemaPath);
    const codexHome = join(workDir, "codex-home");

    return {
      command: "codex",
      args: [
        "app-server",
        "--stdio",
        "--disable",
        "plugins",
        "--disable",
        "apps",
        "--disable",
        "remote_plugin",
        "--disable",
        "skill_mcp_dependency_install",
      ],
      stdin: "",
      env: { ...codexAuthEnv(), ...codexMcpEnv(input), CODEX_HOME: codexHome },
      prepare: () => prepareIsolatedCodexHome(codexHome),
      interactive: createCodexAppServerSession(input),
    };
  },
  async parseOutput(input) {
    return parseCodexAppServerOutput(input.stdout);
  },
  parseStreamEvent(line) {
    return parseCodexStreamEvent(line);
  },
};

export async function prepareIsolatedCodexHome(
  codexHome: string,
  sourceCodexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
): Promise<void> {
  const sourceAuth = join(sourceCodexHome, "auth.json");
  const destinationAuth = join(codexHome, "auth.json");
  let copiedAuth = true;
  await mkdir(codexHome, { recursive: true, mode: 0o700 });

  try {
    await copyFile(sourceAuth, destinationAuth);
  } catch (error) {
    // App-server can also authenticate through CODEX_ACCESS_TOKEN or the OS
    // credential store, so a missing file is not itself a setup failure.
    if (isMissingFileError(error)) {
      copiedAuth = false;
    } else {
      throw new Error(`Codex authentication could not be copied from ${sourceAuth}`, {
        cause: error,
      });
    }
  }

  await chmod(codexHome, 0o700);

  if (copiedAuth) {
    await chmod(destinationAuth, 0o600);
  }
}

export function createCodexAppServerSession(
  input: Parameters<HarnessCommandPreset["buildInvocation"]>[0],
): HarnessInteractiveSession {
  let threadId: string | null = null;
  let closed = false;

  return {
    start: () => [
      jsonLine({
        id: initializeRequestId,
        method: "initialize",
        params: {
          clientInfo: { name: "greenroom-harness", title: "Greenroom", version: "1.0.0" },
          capabilities: { experimentalApi: false, requestAttestation: false },
        },
      }),
    ],
    onLine(line) {
      const message = parseJsonRecord(line);

      if (message === null || closed) {
        return {};
      }

      if (message.id === initializeRequestId) {
        if (isRecord(message.error)) {
          closed = true;
          return { close: true };
        }

        return {
          write: [
            jsonLine({ method: "initialized", params: {} }),
            jsonLine({
              id: threadStartRequestId,
              method: "thread/start",
              params: codexThreadStartParams(input),
            }),
          ],
        };
      }

      if (message.id === threadStartRequestId) {
        if (isRecord(message.error)) {
          closed = true;
          return { close: true };
        }

        const result = isRecord(message.result) ? message.result : null;
        const thread = isRecord(result?.thread) ? result.thread : null;
        threadId = stringValue(thread?.id);

        if (threadId === null) {
          closed = true;
          return { close: true };
        }

        return {
          write: [
            jsonLine({
              id: turnStartRequestId,
              method: "turn/start",
              params: codexTurnStartParams(input, threadId),
            }),
          ],
        };
      }

      if (isServerRequest(message)) {
        return { write: [jsonLine(deniedServerRequestResponse(message))] };
      }

      if (message.method === "turn/completed") {
        const params = isRecord(message.params) ? message.params : null;

        if (threadId === null || params?.threadId === threadId) {
          closed = true;
          return { close: true };
        }
      }

      return {};
    },
  };
}

function codexThreadStartParams(
  input: Parameters<HarnessCommandPreset["buildInvocation"]>[0],
): Record<string, unknown> {
  const model = explicitModel(input.request.profile.model, input.request.profile.harnessKind);

  return {
    cwd: input.cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    experimentalRawEvents: false,
    config: { mcp_servers: codexMcpServers(input) },
    ...(model === null ? {} : { model }),
  };
}

function codexTurnStartParams(
  input: Parameters<HarnessCommandPreset["buildInvocation"]>[0],
  threadId: string,
): Record<string, unknown> {
  const reasoningLevel = input.request.profile.reasoningLevel;

  return {
    threadId,
    input: [{ type: "text", text: input.request.prompt, text_elements: [] }],
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    ...(input.request.outputCapture === "structured_stdout"
      ? { outputSchema: input.request.schema }
      : {}),
    ...(reasoningLevel === null || reasoningLevel === undefined ? {} : { effort: reasoningLevel }),
  };
}

function codexMcpServers(
  input: Parameters<HarnessCommandPreset["buildInvocation"]>[0],
): Record<string, unknown> {
  return input.request.mcp === null || input.request.mcp === undefined || input.mcpUrl === null
    ? {}
    : {
        greenroom: {
          url: input.mcpUrl,
          bearer_token_env_var: "GREENROOM_MCP_TOKEN",
          enabled: true,
          required: true,
          // The MCP endpoint and bearer token are run-scoped and expose only
          // the request's allowedTools, so Codex may execute those tools
          // without an interactive user approval that the bridge cannot show.
          default_tools_approval_mode: "approve",
        },
      };
}

function codexMcpEnv(
  input: Parameters<HarnessCommandPreset["buildInvocation"]>[0],
): Record<string, string | undefined> {
  const mcp = input.request.mcp;

  if (mcp === null || mcp === undefined) {
    return {};
  }

  return {
    GREENROOM_MCP_TOKEN: mcp.token,
    GREENROOM_API_TOKEN: mcp.token,
    GREENROOM_WORKFLOW_RUN_ID: input.request.runId,
    GREENROOM_WORKFLOW_OUTPUT_MODE: input.request.outputMode ?? undefined,
  };
}

function codexAuthEnv(): Record<string, string | undefined> {
  return { CODEX_ACCESS_TOKEN: process.env.CODEX_ACCESS_TOKEN };
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "ENOENT"
  );
}

function isServerRequest(message: Record<string, unknown>): boolean {
  return (
    (typeof message.id === "string" || typeof message.id === "number") &&
    typeof message.method === "string"
  );
}

function deniedServerRequestResponse(message: Record<string, unknown>): Record<string, unknown> {
  const method = stringValue(message.method);
  let result: Record<string, unknown>;

  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      result = { decision: "decline" };
      break;
    case "mcpServer/elicitation/request":
      result = { action: "decline", content: null };
      break;
    case "item/permissions/requestApproval":
      result = { permissions: {}, scope: "turn", strictAutoReview: true };
      break;
    case "item/tool/requestUserInput":
      result = { answers: {} };
      break;
    case "item/tool/call":
      result = { contentItems: [], success: false };
      break;
    case "currentTime/read":
      result = { currentTimeAt: Math.floor(Date.now() / 1000) };
      break;
    case "applyPatchApproval":
    case "execCommandApproval":
      result = { decision: "denied" };
      break;
    default:
      return {
        id: message.id,
        error: { code: -32601, message: `Greenroom does not support ${method ?? "this request"}` },
      };
  }

  return { id: message.id, result };
}

export function parseCodexAppServerOutput(stdout: string): unknown | undefined {
  const messages = stdout
    .split(/\r?\n/u)
    .map(parseJsonRecord)
    .filter((message): message is Record<string, unknown> => message !== null);

  for (const message of messages) {
    if (message.id !== undefined && isRecord(message.error)) {
      throw new Error(`Codex app-server request failed: ${errorMessage(message.error)}`);
    }
  }

  const completedTurn = [...messages]
    .reverse()
    .find((message) => message.method === "turn/completed");

  if (completedTurn === undefined) {
    throw new Error("Codex app-server exited before completing the turn");
  }

  const params = isRecord(completedTurn.params) ? completedTurn.params : null;
  const turn = isRecord(params?.turn) ? params.turn : null;

  if (turn?.status !== "completed") {
    const error = isRecord(turn?.error) ? turn.error : null;
    throw new Error(`Codex run ${String(turn?.status ?? "failed")}: ${errorMessage(error)}`);
  }

  const finalText = finalAgentMessage(messages, turn);

  if (finalText === null || finalText.trim().length === 0) {
    return undefined;
  }

  const parsed = parseJsonValue(stripCodeFence(finalText));
  return isRecord(parsed) || Array.isArray(parsed) ? parsed : undefined;
}

function finalAgentMessage(
  messages: readonly Record<string, unknown>[],
  turn: Record<string, unknown>,
): string | null {
  const turnItems = Array.isArray(turn.items) ? turn.items : [];
  const completedItems = messages.flatMap((message) => {
    if (message.method !== "item/completed" || !isRecord(message.params)) {
      return [];
    }

    return isRecord(message.params.item) ? [message.params.item] : [];
  });

  for (const item of [...turnItems, ...completedItems].reverse()) {
    if (isRecord(item) && item.type === "agentMessage" && typeof item.text === "string") {
      return item.text;
    }
  }

  return null;
}

export function parseCodexStreamEvent(line: string): HarnessStreamEventDraft | null {
  const message = parseJsonRecord(line);

  if (message === null || typeof message.method !== "string") {
    return null;
  }

  const params = isRecord(message.params) ? message.params : null;
  const item = isRecord(params?.item) ? params.item : null;

  if (message.method === "item/agentMessage/delta" && typeof params?.delta === "string") {
    return {
      kind: "assistant_text",
      summary: summarize(params.delta, "Codex response"),
      text: params.delta,
      name: null,
      data: { sourceType: message.method },
    };
  }

  if (message.method === "item/started" && item !== null) {
    const type = stringValue(item.type);

    if (type === "commandExecution" || type === "mcpToolCall") {
      const name = codexItemName(item, type);
      return {
        kind: "tool_call",
        summary: `Tool call: ${name}`,
        text: null,
        name,
        data: { sourceType: message.method, id: item.id ?? null },
      };
    }
  }

  if (message.method === "item/completed" && item !== null) {
    const type = stringValue(item.type);

    if (type === "commandExecution" || type === "mcpToolCall") {
      const name = codexItemName(item, type);
      return {
        kind: "tool_result",
        summary: `Tool completed: ${name}`,
        text: null,
        name,
        data: { sourceType: message.method, id: item.id ?? null, status: item.status ?? null },
      };
    }
  }

  if (message.method === "turn/completed") {
    return {
      kind: "result",
      summary: "Codex completed the turn.",
      text: null,
      name: null,
      data: { sourceType: message.method },
    };
  }

  if (message.method === "error") {
    const error = isRecord(params?.error) ? params.error : params;
    const text = errorMessage(error);
    return {
      kind: "stderr_line",
      summary: summarize(text, "Codex error"),
      text,
      name: null,
      data: { sourceType: message.method },
    };
  }

  return null;
}

function codexItemName(item: Record<string, unknown>, fallback: string): string {
  if (item.type === "mcpToolCall" && typeof item.tool === "string") {
    return item.tool;
  }

  if (item.type === "commandExecution" && typeof item.command === "string") {
    return item.command;
  }

  return fallback;
}

function explicitModel(model: string, harnessKind: string | null | undefined): string | null {
  const trimmed = model.trim();
  return trimmed === "codex" || trimmed === harnessKind ? null : trimmed;
}

function errorMessage(error: Record<string, unknown> | null): string {
  if (typeof error?.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }

  return error === null ? "unknown error" : JSON.stringify(error);
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/u.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function summarize(value: string, fallback: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length === 0
    ? fallback
    : compact.length <= 160
      ? compact
      : `${compact.slice(0, 157)}...`;
}

function jsonLine(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
