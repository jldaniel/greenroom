import { readFile } from "node:fs/promises";

import { substituteHarnessArg } from "../config";
import type { HarnessCommandPreset } from "./types";

export function createRawHarnessCommandPreset(input: {
  command: string;
  args: readonly string[];
}): HarnessCommandPreset {
  return {
    kind: "raw",
    label: "Raw command",
    streaming: "line",
    buildInvocation(values) {
      return {
        command: input.command,
        args: input.args.map((arg) =>
          substituteHarnessArg(arg, {
            schemaPath: values.schemaPath,
            schemaJson: values.schemaJson,
            promptPath: values.promptPath,
            cwd: values.cwd,
            outputPath: values.outputPath,
            mcpConfigPath: values.mcpConfigPath,
            mcpUrl: values.mcpUrl,
          }),
        ),
        stdin: values.request.prompt,
        env: mcpInvocationEnv(values.request),
      };
    },
    async parseOutput(values) {
      const rawOutput = await readRawHarnessOutput(values.stdout, values.outputPath);
      return JSON.parse(rawOutput);
    },
  };
}

function mcpInvocationEnv(
  request: Parameters<HarnessCommandPreset["buildInvocation"]>[0]["request"],
): Record<string, string | undefined> {
  if (request.mcp === null || request.mcp === undefined) {
    return {};
  }

  const mcpUrl = fullMcpUrl(request.mcp.serverUrl, request.mcp.serverPath ?? "/mcp");

  return {
    GREENROOM_MCP_SERVER_URL: request.mcp.serverUrl,
    GREENROOM_MCP_SERVER_PATH: request.mcp.serverPath ?? "/mcp",
    GREENROOM_MCP_URL: mcpUrl,
    GREENROOM_MCP_TOKEN: request.mcp.token,
    GREENROOM_API_TOKEN: request.mcp.token,
    GREENROOM_MCP_TOKEN_REF: request.mcp.tokenRef ?? undefined,
    GREENROOM_WORKFLOW_RUN_ID: request.runId,
    GREENROOM_WORKFLOW_OUTPUT_MODE: request.outputMode ?? undefined,
    GREENROOM_HARNESS_PROMPT_ID: request.promptId ?? undefined,
    GREENROOM_HARNESS_REPAIR_ATTEMPT: String(request.repairAttemptNumber ?? 0),
  };
}

function fullMcpUrl(serverUrl: string, serverPath: string): string {
  const base = serverUrl.replace(/\/+$/u, "");
  const path = serverPath.startsWith("/") ? serverPath : `/${serverPath}`;

  return `${base}${path}`;
}

async function readRawHarnessOutput(stdout: string, outputPath: string): Promise<string> {
  const trimmed = stdout.trim();

  if (trimmed.length > 0) {
    return trimmed;
  }

  const outputFile = (await readFile(outputPath, "utf8")).trim();

  if (outputFile.length === 0) {
    throw new Error("Harness command produced no JSON output");
  }

  return outputFile;
}
