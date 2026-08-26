/**
 * Mock coding-agent CLI for the live-API Playwright suite.
 *
 * The harness bridge launches this script through the claude-code preset via
 * a stub `claude` executable. The workflow prompt lands on stdin (or on disk
 * for raw command templates using `{promptPath}`), the run-scoped MCP grant
 * arrives in the environment, and Claude-style stream-json NDJSON is expected
 * on stdout.
 * Instead of canned context, the script reads the real review back through
 * the API with the run-scoped grant token and emits one deterministic
 * builtin_review finding anchored to an actual changed line (skipping lines
 * that already carry an open thread so validation stays warning-free).
 *
 * Invocation (configured by tests/live/stack.ts):
 *   bun tests/live/mock-harness.ts --stdin
 */
import { readFileSync } from "node:fs";

import { createGreenroomHttpClient } from "../../packages/mcp/src/client";
import { callGreenroomTool } from "../../packages/mcp/src/tools";

import type { ThreadAnchor } from "../../packages/schemas/src/index";

interface AnchorRegistryPayload {
  anchors: Array<{ anchorKey: string; anchor: ThreadAnchor; content: string | null }>;
}

async function main(): Promise<void> {
  const prompt = await readPrompt();

  const workflowKind = matchPromptLine(prompt, "Workflow kind");
  const reviewId = matchPromptLine(prompt, "Review");
  const runId = requireEnv("GREENROOM_WORKFLOW_RUN_ID");

  if (workflowKind !== "builtin_review") {
    throw new Error(`Mock live harness only supports builtin_review, got ${workflowKind ?? "?"}`);
  }

  if (reviewId === null) {
    throw new Error("Prompt did not include a Review line");
  }

  const client = createGreenroomHttpClient({
    baseUrl: requireEnv("GREENROOM_MCP_SERVER_URL"),
    token: requireEnv("GREENROOM_MCP_TOKEN"),
  });

  emitClaudeAssistant("Mock live harness is loading review context.");
  await sleep(500);
  const reviewResource = await client.getReview(reviewId);

  if (reviewResource.review.title.toLowerCase().includes("silent")) {
    emitClaudeAssistant("Mock live harness entered silent mode after initial activity.");
    await sleep(60_000);
    return;
  }

  emitClaudeToolCall("tool_anchor_registry", "greenroom_get_anchor_registry");
  const registry = (await callGreenroomTool(client, "greenroom_get_anchor_registry", {
    reviewId,
  })) as unknown as AnchorRegistryPayload;
  emitClaudeToolResult("tool_anchor_registry", `Loaded ${registry.anchors.length} anchors.`);
  await sleep(700);

  emitClaudeToolCall("tool_progress_1", "greenroom_report_progress");
  await callGreenroomTool(client, "greenroom_report_progress", {
    runId,
    message: "Reviewing changed lines with the live mock harness.",
    completedUnits: 1,
    totalUnits: 2,
    phase: "Reviewing changed lines",
  });
  emitClaudeToolResult("tool_progress_1", "Progress recorded.");
  await sleep(700);

  const { threads } = await client.listThreads(reviewId);
  const occupiedLines = new Set(
    threads
      .filter((thread) => thread.status === "open")
      .flatMap((thread) =>
        thread.anchors.map((anchor) => `${anchor.filePath}:${anchor.lineNumber}`),
      ),
  );
  const target =
    registry.anchors.find(
      (entry) =>
        entry.anchor.lineType === "addition" &&
        !occupiedLines.has(`${entry.anchor.filePath}:${entry.anchor.lineNumber}`),
    ) ?? registry.anchors[0];

  if (target === undefined) {
    throw new Error(`Review ${reviewId} has no anchorable changed lines`);
  }

  await sleep(1_200);
  const draft = {
    kind: "builtin_review_findings",
    summary: "Mock live harness reviewed the changed lines through the real API.",
    findings: [
      {
        id: "live-finding-1",
        title: "Verify the computed answer",
        body:
          "Flagged by the mock live harness: confirm the changed line " +
          `${target.anchor.filePath}:${target.anchor.lineNumber} is intentional.`,
        type: "issue",
        severity: "minor",
        anchorKey: target.anchorKey,
        confidence: 0.9,
      },
    ],
    nonFindings: ["The repository was not modified."],
  };
  emitClaudeResult(draft);
}

async function readPrompt(): Promise<string> {
  if (process.argv.includes("--stdin")) {
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString("utf8");
  }

  const promptPath = process.argv[2];

  if (promptPath === undefined) {
    throw new Error("Usage: mock-harness.ts --stdin");
  }

  return readFileSync(promptPath, "utf8");
}

function matchPromptLine(prompt: string, label: string): string | null {
  const match = new RegExp(`^${label}: (.+)$`, "mu").exec(prompt);
  return match?.[1]?.trim() ?? null;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the mock live harness`);
  }

  return value;
}

function emitClaudeAssistant(text: string): void {
  emitClaudeEvent({
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
    },
  });
}

function emitClaudeToolCall(id: string, name: string): void {
  emitClaudeEvent({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name, input: {} }],
    },
  });
}

function emitClaudeToolResult(toolUseId: string, content: string): void {
  emitClaudeEvent({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  });
}

function emitClaudeResult(result: unknown): void {
  emitClaudeEvent({
    type: "result",
    result: JSON.stringify(result),
  });
}

function emitClaudeEvent(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
