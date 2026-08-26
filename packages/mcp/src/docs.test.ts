import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { GreenroomHttpClient } from "./client";
import { applyGeneratedDocSections, mcpDocPath } from "./docs";
import { createGreenroomMcpServer } from "./server";
import { greenroomToolNames } from "./tools";

const toolNamePattern = /\bgreenroom_[a-z0-9_]+\b/g;

async function listPromptNames(): Promise<string[]> {
  const server = createGreenroomMcpServer({ client: {} as GreenroomHttpClient });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "prompts/list",
  });
  const result = (response as { result: { prompts: Array<{ name: string }> } }).result;

  return result.prompts.map((prompt) => prompt.name);
}

async function getPromptText(name: string): Promise<string> {
  const server = createGreenroomMcpServer({ client: {} as GreenroomHttpClient });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "prompts/get",
    params: { name, arguments: { runId: "workflow_run_1", reviewId: "GR-1" } },
  });
  const result = (
    response as {
      result: { messages: Array<{ content: { text: string } }> };
    }
  ).result;

  return result.messages.map((message) => message.content.text).join("\n");
}

describe("MCP documentation", () => {
  it("keeps docs/MCP.md generated sections in sync with the tool and resource definitions", () => {
    const markdown = readFileSync(mcpDocPath, "utf8");

    expect(applyGeneratedDocSections(markdown)).toBe(markdown);
  });

  it("references only defined tool and prompt names in docs/MCP.md", async () => {
    const markdown = readFileSync(mcpDocPath, "utf8");
    const knownNames = new Set<string>([...greenroomToolNames, ...(await listPromptNames())]);
    const referenced = [...new Set(markdown.match(toolNamePattern) ?? [])];

    expect(referenced.filter((name) => !knownNames.has(name))).toEqual([]);
  });

  it("references only defined tool names inside served MCP prompt texts", async () => {
    const knownNames = new Set<string>(greenroomToolNames);

    for (const promptName of await listPromptNames()) {
      const text = await getPromptText(promptName);
      const referenced = [...new Set(text.match(toolNamePattern) ?? [])];

      expect(referenced.filter((name) => !knownNames.has(name))).toEqual([]);
    }
  });
});
