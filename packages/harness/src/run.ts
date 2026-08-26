import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  harnessRunRequestSchema,
  harnessRunResponseSchema,
  type HarnessExecutionMetadata,
  type HarnessRunRequest,
  type HarnessRunResponse,
} from "@greenroom/schemas";
import {
  cleanupGitWorkspace,
  createGitArchiveWorkspace,
  type GitArchiveWorkspace,
} from "@greenroom/git";

import { buildHarnessSubprocessEnv, mapHarnessCwd, type HarnessBridgeConfig } from "./config";
import { resolveHarnessPreset } from "./presets";
import type {
  HarnessCommandPreset,
  HarnessInteractiveSessionAction,
  HarnessStreamEventDraft,
} from "./presets/types";

export interface RunHarnessCommandInput {
  request: HarnessRunRequest;
  config: HarnessBridgeConfig;
  jobId?: string;
  signal?: AbortSignal;
  onEvent?: (event: HarnessStreamEventDraft) => void;
}

export async function runHarnessCommand(
  input: RunHarnessCommandInput,
): Promise<HarnessRunResponse> {
  const request = harnessRunRequestSchema.parse(input.request);
  const config = input.config;
  const started = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "greenroom-harness-"));
  const secrets = redactionSecrets(request, config);
  const timeout = resolveHarnessRunTimeout(request, config);
  let executionCommand = config.command.length === 0 ? "<not configured>" : config.command;
  let workspace: GitArchiveWorkspace | null = null;
  let workspaceSetupStatus: HarnessExecutionMetadata["workspaceSetupStatus"] = "not_required";
  let workspaceCleanupStatus: HarnessExecutionMetadata["workspaceCleanupStatus"] = "not_required";
  let workspaceErrorMessage: string | null = null;

  try {
    const schemaPath = join(workDir, "schema.json");
    const promptPath = join(workDir, "prompt.txt");
    const outputPath = join(workDir, "output.json");
    const mcpLaunch = await prepareMcpLaunch(request, workDir);
    const schemaJson = JSON.stringify(request.schema);
    await writeFile(schemaPath, `${JSON.stringify(request.schema, null, 2)}\n`, "utf8");
    await writeFile(promptPath, request.prompt, "utf8");
    const executionCwd = await prepareExecutionCwd({
      request,
      config,
      workDir,
      jobId: input.jobId,
      onWorkspacePrepared: (prepared) => {
        workspace = prepared;
        workspaceSetupStatus = "succeeded";
      },
      onWorkspaceSetupFailed: (message) => {
        workspaceSetupStatus = "failed";
        workspaceErrorMessage = message;
      },
    });

    const { preset } = resolveHarnessPreset({
      requestModel: request.profile.model,
      requestHarnessKind: request.profile.harnessKind,
      config,
    });
    const invocation = preset.buildInvocation({
      request,
      workDir,
      cwd: executionCwd,
      schemaPath,
      schemaJson,
      promptPath,
      outputPath,
      mcpConfigPath: mcpLaunch.configPath,
      mcpUrl: mcpLaunch.url,
    });
    await invocation.prepare?.();
    const invocationEnv = { ...mcpLaunch.env, ...(invocation.env ?? {}) };
    executionCommand = commandDisplay(invocation.command, invocation.args, secrets);
    emitHarnessEvent(input.onEvent, {
      kind: "run_started",
      summary: `Harness command started: ${executionCommand}`,
      text: null,
      name: preset.kind,
      data: {
        presetKind: preset.kind,
        streaming: preset.streaming,
        outputCapture: request.outputCapture,
        repositoryAccessMode: request.repositoryAccess.mode,
      },
    });
    const repositoryFingerprintBefore = await readGitFingerprint(executionCwd);
    const result = await spawnHarnessProcess({
      command: invocation.command,
      args: invocation.args,
      commandDisplay: executionCommand,
      cwd: executionCwd,
      stdin: invocation.stdin,
      timeout,
      killGraceMs: config.killGraceMs,
      env: invocationEnv,
      envAllowlist: config.envAllowlist,
      maxStderrChars: config.maxStderrChars,
      maxStdoutChars: config.maxStdoutChars,
      started,
      outputCapture: request.outputCapture,
      secrets,
      preset,
      ...(invocation.interactive === undefined ? {} : { interactive: invocation.interactive }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    });
    const repositoryFingerprintAfter = await readGitFingerprint(executionCwd);
    const repositoryChanged =
      repositoryFingerprintBefore !== null &&
      repositoryFingerprintAfter !== null &&
      repositoryFingerprintBefore !== repositoryFingerprintAfter;
    let execution = withWorkspaceExecutionMetadata(
      {
        ...result.execution,
        repositoryChanged,
        repositoryFingerprintBefore,
        repositoryFingerprintAfter,
      },
      {
        request,
        workspaceSetupStatus,
        workspaceCleanupStatus,
        workspaceErrorMessage,
      },
    );

    const cleanup = await cleanupExecutionWorkspace(workspace);
    workspaceCleanupStatus = cleanup.status;
    workspaceErrorMessage = cleanup.errorMessage ?? workspaceErrorMessage;
    execution = withWorkspaceExecutionMetadata(execution, {
      request,
      workspaceSetupStatus,
      workspaceCleanupStatus,
      workspaceErrorMessage,
    });

    if (result.timedOut) {
      return failedResponse(
        request,
        execution,
        `Harness command timed out after ${timeout.timeoutMs}ms${
          timeout.clamped
            ? ` (configured timeout ${timeout.requestedTimeoutMs}ms was clamped to the API run budget of ${timeout.budgetMs}ms)`
            : ""
        }`,
        secrets,
      );
    }

    if (result.cancelled) {
      return failedResponse(request, execution, "Harness command cancelled.", secrets);
    }

    if (result.exitCode !== 0) {
      return failedResponse(
        request,
        execution,
        `Harness command exited with status ${result.exitCode}`,
        secrets,
      );
    }

    if (repositoryChanged) {
      return failedResponse(
        request,
        execution,
        "Harness modified repository state; output was discarded",
        secrets,
      );
    }

    const output = await parseHarnessOutput({
      preset,
      stdout: result.stdout,
      outputPath,
      outputCapture: request.outputCapture,
    });

    return harnessRunResponseSchema.parse({
      workflow: request.workflow,
      runId: request.runId,
      status: "completed",
      ...(output === undefined ? {} : { output }),
      execution,
    });
  } catch (error) {
    const cleanup = await cleanupExecutionWorkspace(workspace);
    workspaceCleanupStatus = cleanup.status;
    workspaceErrorMessage = cleanup.errorMessage ?? workspaceErrorMessage;
    const execution = withWorkspaceExecutionMetadata(
      {
        command: redactHarnessSecrets(executionCommand, secrets),
        exitCode: null,
        durationMs: Date.now() - started,
        stderrTail: "",
        timeoutMs: timeout.timeoutMs,
        timeoutBudgetMs: timeout.budgetMs,
        timeoutClamped: timeout.clamped,
        timedOut: false,
        repositoryChanged: false,
        repositoryFingerprintBefore: null,
        repositoryFingerprintAfter: null,
        outputCapture: request.outputCapture,
      },
      {
        request,
        workspaceSetupStatus,
        workspaceCleanupStatus,
        workspaceErrorMessage,
      },
    );
    return failedResponse(
      request,
      execution,
      error instanceof Error ? error.message : "Harness command failed",
      secrets,
    );
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

async function prepareExecutionCwd(input: {
  request: ReturnType<typeof harnessRunRequestSchema.parse>;
  config: HarnessBridgeConfig;
  workDir: string;
  jobId: string | undefined;
  onWorkspacePrepared: (workspace: GitArchiveWorkspace) => void;
  onWorkspaceSetupFailed: (message: string) => void;
}): Promise<string> {
  if (input.request.repositoryAccess.mode === "mcp_only") {
    return input.workDir;
  }

  if (input.request.repositoryAccess.workspaceStrategy !== "git_archive") {
    const message = `Workspace strategy ${input.request.repositoryAccess.workspaceStrategy} is not supported by this bridge`;
    input.onWorkspaceSetupFailed(message);
    throw new Error(message);
  }

  if (input.config.workspaceDir === null) {
    const message = "GREENROOM_HARNESS_WORKSPACE_DIR is required for snapshot repository access";
    input.onWorkspaceSetupFailed(message);
    throw new Error(message);
  }

  try {
    const workspace = await createGitArchiveWorkspace({
      workspaceParentDir: input.config.workspaceDir,
      sourceRepositoryPath: mapHarnessCwd(
        input.request.repositoryAccess.sourceRepositoryPath,
        input.config.pathMappings,
      ),
      runId: input.request.runId,
      jobId: input.jobId ?? input.request.runId,
      revisionId: input.request.repositoryAccess.revisionId,
      baseSha: input.request.repositoryAccess.baseSha,
      headSha: input.request.repositoryAccess.headSha,
    });
    input.onWorkspacePrepared(workspace);
    return workspace.repoPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository workspace setup failed";
    input.onWorkspaceSetupFailed(message);
    throw error;
  }
}

async function cleanupExecutionWorkspace(workspace: GitArchiveWorkspace | null): Promise<{
  status: HarnessExecutionMetadata["workspaceCleanupStatus"];
  errorMessage: string | null;
}> {
  if (workspace === null) {
    return { status: "not_required", errorMessage: null };
  }

  const cleanup = await cleanupGitWorkspace(workspace);

  return cleanup.removed
    ? { status: "succeeded", errorMessage: null }
    : { status: "failed", errorMessage: cleanup.errorMessage ?? "Workspace cleanup failed" };
}

type WorkspaceExecutionFields = Pick<
  HarnessExecutionMetadata,
  | "repositoryAccessMode"
  | "repositoryWorkspaceStrategy"
  | "workspaceSetupStatus"
  | "workspaceCleanupStatus"
  | "workspaceErrorMessage"
>;

type HarnessExecutionMetadataBeforeWorkspace = Omit<
  HarnessExecutionMetadata,
  keyof WorkspaceExecutionFields
> &
  Partial<WorkspaceExecutionFields>;

function withWorkspaceExecutionMetadata(
  execution: HarnessExecutionMetadataBeforeWorkspace,
  input: {
    request: ReturnType<typeof harnessRunRequestSchema.parse>;
    workspaceSetupStatus: HarnessExecutionMetadata["workspaceSetupStatus"];
    workspaceCleanupStatus: HarnessExecutionMetadata["workspaceCleanupStatus"];
    workspaceErrorMessage: string | null;
  },
): HarnessExecutionMetadata {
  return {
    ...execution,
    repositoryAccessMode: input.request.repositoryAccess.mode,
    repositoryWorkspaceStrategy:
      input.request.repositoryAccess.mode === "snapshot_readonly"
        ? input.request.repositoryAccess.workspaceStrategy
        : null,
    workspaceSetupStatus: input.workspaceSetupStatus,
    workspaceCleanupStatus: input.workspaceCleanupStatus,
    workspaceErrorMessage: input.workspaceErrorMessage,
  };
}

interface ResolvedHarnessRunTimeout {
  timeoutMs: number;
  requestedTimeoutMs: number;
  budgetMs: number | null;
  clamped: boolean;
}

function resolveHarnessRunTimeout(
  request: Pick<HarnessRunRequest, "timeoutMs" | "timeoutBudgetMs">,
  config: HarnessBridgeConfig,
): ResolvedHarnessRunTimeout {
  const requestedTimeoutMs = request.timeoutMs ?? config.defaultTimeoutMs;
  const budgetMs = request.timeoutBudgetMs ?? null;
  const timeoutMs = budgetMs === null ? requestedTimeoutMs : Math.min(requestedTimeoutMs, budgetMs);

  return { timeoutMs, requestedTimeoutMs, budgetMs, clamped: timeoutMs < requestedTimeoutMs };
}

interface SpawnHarnessProcessInput {
  command: string;
  args: string[];
  commandDisplay: string;
  cwd: string;
  stdin: string;
  timeout: ResolvedHarnessRunTimeout;
  killGraceMs: number;
  env: Record<string, string | undefined>;
  envAllowlist: string[];
  maxStderrChars: number;
  maxStdoutChars: number;
  started: number;
  outputCapture: HarnessExecutionMetadata["outputCapture"];
  secrets: readonly string[];
  preset: HarnessCommandPreset;
  interactive?: NonNullable<ReturnType<HarnessCommandPreset["buildInvocation"]>["interactive"]>;
  signal?: AbortSignal;
  onEvent?: (event: HarnessStreamEventDraft) => void;
}

interface SpawnHarnessProcessResult {
  stdout: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  execution: HarnessExecutionMetadata;
}

// Hard cap on the raw stderr accumulated while a run drains; the redacted tail
// returned to callers is further trimmed to maxStderrChars.
const maxStderrCaptureChars = 65_000;

async function spawnHarnessProcess(
  input: SpawnHarnessProcessInput,
): Promise<SpawnHarnessProcessResult> {
  // detached: the child leads its own process group so timeout signals reach
  // every process the harness spawned, not only the direct child.
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: buildHarnessSubprocessEnv(input.envAllowlist, process.env, input.env),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const stdoutLines = new LineAccumulator();
  const stderrLines = new LineAccumulator();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = tailString(`${stdout}${chunk}`, input.maxStdoutChars);
    for (const line of stdoutLines.push(chunk)) {
      handleInteractiveLine(child, input.interactive, line);
      emitStdoutLine(input, line);
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = tailString(`${stderr}${chunk}`, maxStderrCaptureChars);
    for (const line of stderrLines.push(chunk)) {
      emitHarnessEvent(input.onEvent, {
        kind: "stderr_line",
        summary: summarizeLine(line, "stderr"),
        text: tailString(redactHarnessSecrets(line, input.secrets), 65_000),
        name: null,
        data: {},
      });
    }
  });
  child.stdin.on("error", () => {
    // The child may exit before consuming stdin; ignore broken-pipe writes.
  });
  if (input.interactive === undefined) {
    child.stdin.end(input.stdin);
  } else {
    writeInteractiveLines(child, input.interactive.start());
  }

  let timedOut = false;
  let cancelled = false;
  let terminating = false;
  let escalationTimer: ReturnType<typeof setTimeout> | null = null;
  const terminate = (reason: "timeout" | "cancelled") => {
    if (terminating) {
      return;
    }

    terminating = true;

    if (reason === "timeout") {
      timedOut = true;
    } else {
      cancelled = true;
    }

    killHarnessProcessGroup(child, "SIGTERM");
    escalationTimer = setTimeout(() => {
      killHarnessProcessGroup(child, "SIGKILL");
    }, input.killGraceMs);
  };
  const timeoutTimer = setTimeout(() => {
    terminate("timeout");
  }, input.timeout.timeoutMs);
  const abortHandler = () => {
    terminate("cancelled");
  };

  if (input.signal?.aborted) {
    abortHandler();
  } else {
    input.signal?.addEventListener("abort", abortHandler, { once: true });
  }

  let exitCode: number | null;

  try {
    exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
  } finally {
    clearHarnessTimer(timeoutTimer);
    clearHarnessTimer(escalationTimer);
    input.signal?.removeEventListener("abort", abortHandler);
  }

  for (const line of stdoutLines.flush()) {
    handleInteractiveLine(child, input.interactive, line);
    emitStdoutLine(input, line);
  }

  for (const line of stderrLines.flush()) {
    emitHarnessEvent(input.onEvent, {
      kind: "stderr_line",
      summary: summarizeLine(line, "stderr"),
      text: tailString(redactHarnessSecrets(line, input.secrets), 65_000),
      name: null,
      data: {},
    });
  }

  if (timedOut || cancelled) {
    exitCode = null;
  }

  const stderrTail = tailString(redactHarnessSecrets(stderr, input.secrets), input.maxStderrChars);
  emitHarnessEvent(input.onEvent, {
    kind: "exit",
    summary: timedOut
      ? `Harness command timed out after ${input.timeout.timeoutMs}ms.`
      : cancelled
        ? "Harness command cancelled."
        : `Harness command exited with status ${exitCode === null ? "null" : exitCode}.`,
    text: null,
    name: null,
    data: {
      exitCode,
      timedOut,
      cancelled,
      durationMs: Date.now() - input.started,
    },
  });

  return {
    stdout,
    exitCode,
    timedOut,
    cancelled,
    execution: {
      command: input.commandDisplay,
      exitCode,
      durationMs: Date.now() - input.started,
      stderrTail,
      timeoutMs: input.timeout.timeoutMs,
      timeoutBudgetMs: input.timeout.budgetMs,
      timeoutClamped: input.timeout.clamped,
      timedOut,
      repositoryAccessMode: "mcp_only",
      repositoryWorkspaceStrategy: null,
      workspaceSetupStatus: "not_required",
      workspaceCleanupStatus: "not_required",
      workspaceErrorMessage: null,
      repositoryChanged: false,
      repositoryFingerprintBefore: null,
      repositoryFingerprintAfter: null,
      outputCapture: input.outputCapture,
    },
  };
}

function handleInteractiveLine(
  child: ChildProcess,
  interactive: SpawnHarnessProcessInput["interactive"],
  line: string,
): void {
  if (interactive === undefined) {
    return;
  }

  writeInteractiveAction(child, interactive.onLine(line));
}

function writeInteractiveAction(
  child: ChildProcess,
  action: HarnessInteractiveSessionAction,
): void {
  writeInteractiveLines(child, action.write ?? []);
  const stdin = child.stdin;

  if (action.close === true && stdin !== null && !stdin.destroyed && !stdin.writableEnded) {
    stdin.end();
  }
}

function writeInteractiveLines(child: ChildProcess, lines: readonly string[]): void {
  const stdin = child.stdin;

  if (stdin === null || stdin.destroyed || stdin.writableEnded) {
    return;
  }

  for (const line of lines) {
    stdin.write(`${line}\n`);
  }
}

function emitStdoutLine(input: SpawnHarnessProcessInput, line: string): void {
  if (line.trim().length === 0) {
    return;
  }

  if (input.preset.streaming === "structured" && input.preset.parseStreamEvent !== undefined) {
    const parsed = input.preset.parseStreamEvent(line);

    if (parsed !== null) {
      emitHarnessEvent(input.onEvent, redactHarnessEventDraft(parsed, input.secrets));
    }

    return;
  }

  emitHarnessEvent(input.onEvent, {
    kind: "assistant_text",
    summary: summarizeLine(line, "stdout"),
    text: tailString(redactHarnessSecrets(line, input.secrets), 65_000),
    name: null,
    data: { streaming: input.preset.streaming },
  });
}

function emitHarnessEvent(
  onEvent: ((event: HarnessStreamEventDraft) => void) | undefined,
  event: HarnessStreamEventDraft,
): void {
  onEvent?.(event);
}

function redactHarnessEventDraft(
  event: HarnessStreamEventDraft,
  secrets: readonly string[],
): HarnessStreamEventDraft {
  return {
    ...event,
    summary: redactHarnessSecrets(event.summary, secrets),
    text:
      event.text === null ? null : tailString(redactHarnessSecrets(event.text, secrets), 65_000),
    name: event.name === null ? null : redactHarnessSecrets(event.name, secrets),
    data: redactJsonValue(event.data, secrets),
  };
}

function redactJsonValue(
  value: Record<string, unknown>,
  secrets: readonly string[],
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = redactUnknown(entry, secrets);
  }

  return redacted;
}

function redactUnknown(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactHarnessSecrets(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry, secrets));
  }

  if (typeof value === "object" && value !== null) {
    return redactJsonValue(value as Record<string, unknown>, secrets);
  }

  return value;
}

function summarizeLine(line: string, fallback: string): string {
  const compact = line.replace(/\s+/gu, " ").trim();

  if (compact.length === 0) {
    return fallback;
  }

  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

class LineAccumulator {
  #buffer = "";

  push(chunk: string): string[] {
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/u);
    this.#buffer = lines.pop() ?? "";
    return lines;
  }

  flush(): string[] {
    if (this.#buffer.length === 0) {
      return [];
    }

    const line = this.#buffer;
    this.#buffer = "";
    return [line];
  }
}

function killHarnessProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;

  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    // Negative pid signals the whole detached process group.
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process exited between the checks above and the signal.
    }
  }
}

function clearHarnessTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer !== null) {
    clearTimeout(timer);
  }
}

interface HarnessMcpLaunch {
  configPath: string | null;
  url: string | null;
  env: Record<string, string | undefined>;
}

async function prepareMcpLaunch(
  request: ReturnType<typeof harnessRunRequestSchema.parse>,
  workDir: string,
): Promise<HarnessMcpLaunch> {
  if (request.mcp === null) {
    return { configPath: null, url: null, env: {} };
  }

  const url = fullMcpUrl(request.mcp.serverUrl, request.mcp.serverPath);
  const configPath = join(workDir, "mcp.json");
  const env = {
    GREENROOM_MCP_CONFIG: configPath,
    GREENROOM_MCP_SERVER_URL: request.mcp.serverUrl,
    GREENROOM_MCP_SERVER_PATH: request.mcp.serverPath,
    GREENROOM_MCP_URL: url,
    GREENROOM_MCP_TOKEN: request.mcp.token,
    GREENROOM_API_TOKEN: request.mcp.token,
    GREENROOM_MCP_TOKEN_REF: request.mcp.tokenRef ?? undefined,
    GREENROOM_WORKFLOW_RUN_ID: request.runId,
    GREENROOM_WORKFLOW_OUTPUT_MODE: request.outputMode ?? undefined,
    GREENROOM_HARNESS_PROMPT_ID: request.promptId ?? undefined,
    GREENROOM_HARNESS_REPAIR_ATTEMPT: String(request.repairAttemptNumber),
  };

  // Per-run MCP config is temporary and deleted after launch. The token is
  // run-scoped and also exposed through env for harnesses whose persistent MCP
  // setup cannot interpolate headers from config files.
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        mcpServers: {
          greenroom: {
            type: "http",
            url,
            ...(request.mcp.token === undefined
              ? {}
              : { headers: { Authorization: `Bearer ${request.mcp.token}` } }),
          },
        },
        greenroom: {
          runId: request.runId,
          tokenRef: request.mcp.tokenRef,
          allowedTools: request.mcp.allowedTools,
          allowedResources: request.mcp.allowedResources,
          outputMode: request.outputMode,
          expectedSkillVersion: request.expectedSkillVersion,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { configPath, url, env };
}

async function parseHarnessOutput(input: {
  preset: ReturnType<typeof resolveHarnessPreset>["preset"];
  stdout: string;
  outputPath: string;
  outputCapture: HarnessExecutionMetadata["outputCapture"];
}): Promise<unknown | undefined> {
  if (input.outputCapture === "mcp_draft_tool") {
    return undefined;
  }

  if (
    input.outputCapture === "mcp_draft_tool_or_structured_stdout" &&
    input.stdout.trim().length === 0 &&
    !(await fileHasContent(input.outputPath))
  ) {
    return undefined;
  }

  return input.preset.parseOutput({ stdout: input.stdout, outputPath: input.outputPath });
}

async function fileHasContent(path: string): Promise<boolean> {
  try {
    return (await readFile(path, "utf8")).trim().length > 0;
  } catch {
    return false;
  }
}

async function readGitFingerprint(cwd: string): Promise<string | null> {
  try {
    const [head, status] = await Promise.all([
      runShortCommand("git", ["rev-parse", "HEAD"], cwd, 5000),
      runShortCommand("git", ["status", "--porcelain=v1", "--branch"], cwd, 5000),
    ]);

    if (head === null || status === null) {
      return null;
    }

    return `${head.trim()}\n${status.trim()}`;
  } catch {
    return null;
  }
}

async function runShortCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string | null> {
  const proc = Bun.spawn({
    cmd: [command, ...args],
    cwd,
    env: buildHarnessSubprocessEnv([]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const exit = await Promise.race([proc.exited, timeout]);

    if (exit === "timeout") {
      proc.kill();
      return null;
    }

    if (exit !== 0) {
      return null;
    }

    return await stdoutPromise;
  } finally {
    clearHarnessTimer(timer);
  }
}

function failedResponse(
  request: { workflow: HarnessRunRequest["workflow"]; runId: string },
  execution: HarnessExecutionMetadata,
  message: string,
  secrets: readonly string[],
): HarnessRunResponse {
  return harnessRunResponseSchema.parse({
    workflow: request.workflow,
    runId: request.runId,
    status: "failed",
    message: tailString(redactHarnessSecrets(message, secrets), 4000),
    execution: {
      ...execution,
      command: redactHarnessSecrets(execution.command, secrets),
      stderrTail: redactHarnessSecrets(execution.stderrTail, secrets),
    },
  });
}

function tailString(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return maxChars <= 0 ? "" : value;
  }

  return value.slice(value.length - maxChars);
}

function fullMcpUrl(serverUrl: string, serverPath: string): string {
  const trimmed = serverUrl.trim();

  try {
    const parsed = new URL(trimmed);

    if (parsed.pathname !== "" && parsed.pathname !== "/") {
      return trimmed.replace(/\/+$/u, "");
    }
  } catch {
    // Fall back to string joining for test and custom local transports.
  }

  const base = trimmed.replace(/\/+$/u, "");
  const path = serverPath.startsWith("/") ? serverPath : `/${serverPath}`;

  return `${base}${path}`;
}

function commandDisplay(
  command: string,
  args: readonly string[],
  secrets: readonly string[],
): string {
  return [command, ...args].map((part) => displayCommandPart(part, secrets)).join(" ");
}

function displayCommandPart(value: string, secrets: readonly string[]): string {
  const redacted = redactHarnessSecrets(value, secrets);

  if (redacted.length > 500) {
    if (redacted.trim().startsWith("{") || redacted.trim().startsWith("[")) {
      return `<json:${redacted.length} chars>`;
    }

    return `<arg:${redacted.length} chars>`;
  }

  return redacted.includes(" ") ? JSON.stringify(redacted) : redacted;
}

function redactionSecrets(
  request: ReturnType<typeof harnessRunRequestSchema.parse>,
  config: HarnessBridgeConfig,
): string[] {
  return [config.token, process.env.GREENROOM_HARNESS_TOKEN, request.mcp?.token]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .sort((left, right) => right.length - left.length);
}

function redactHarnessSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value;

  for (const secret of secrets) {
    redacted = redacted.replaceAll(secret, "[redacted]");
  }

  return redacted.replace(/grt_[A-Za-z0-9_-]{16,}/gu, "[redacted-token]");
}
