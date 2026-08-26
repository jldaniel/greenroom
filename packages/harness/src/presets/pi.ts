import type { HarnessCommandPreset } from "./types";

/**
 * Pi fallback preset.
 *
 * Pi (`@mariozechner/pi-coding-agent`, bin `pi`) is an API-key-driven coding
 * agent CLI. The invocation shape below was verified against pi 0.73.1:
 *
 * - `pi -p` runs non-interactively and reads the prompt from stdin (a piped
 *   stdin becomes the user message).
 * - `--mode json` emits JSONL events on stdout (`session`, `agent_start`,
 *   `message_start`/`message_end`, `turn_end`, `agent_end`); the final
 *   assistant message appears in the `agent_end` event's `messages` array.
 * - Pi exits 0 even when the provider call fails; failures surface as
 *   `stopReason: "error"` with an `errorMessage` on the assistant message, so
 *   {@link parsePiOutput} must inspect the stop reason.
 * - Pi has no `--json-schema` flag; the output schema is appended to the
 *   system prompt via `--append-system-prompt` instead.
 * - Provider API keys come from environment variables (see
 *   {@link piProviderApiKeyEnvVars}); `--provider`/`--model` select the
 *   backend and Pi resolves a per-provider default model when only
 *   `--provider` is given (verified: `--provider anthropic` picked a default
 *   Claude model).
 */
export const piPreset: HarnessCommandPreset = {
  kind: "pi",
  label: "Pi",
  streaming: "line",
  buildInvocation(input) {
    // Pi's built-in tools include edit/write/bash. MCP-only runs execute in a
    // non-repository temp cwd and disable tools entirely; snapshot runs execute
    // in an archive workspace and may use the read-only built-ins.
    const toolArgs =
      input.request.repositoryAccess?.mode === "snapshot_readonly"
        ? ["--tools", piReadOnlyTools]
        : ["--no-tools"];

    return {
      command: "pi",
      args: [
        "-p",
        "--mode",
        "json",
        // Ephemeral run: no session file, and no user extensions/skills that
        // could inject extra context and break the JSON-only reply contract.
        "--no-session",
        "--no-extensions",
        "--no-skills",
        ...toolArgs,
        ...piModelArgs(process.env, input.request.profile),
        ...piReasoningArgs(input.request.profile),
        "--append-system-prompt",
        piSchemaSystemPrompt(input.schemaJson),
      ],
      stdin: input.request.prompt,
      // Forward provider API keys from the bridge environment: the bridge
      // subprocess env is allowlist-based (buildHarnessSubprocessEnv), so the
      // keys Pi reads must be injected explicitly for the spawn.
      env: piProviderEnvPassthrough(process.env),
    };
  },
  async parseOutput(input) {
    return parsePiOutput(input.stdout);
  },
};

/** Read-only subset of Pi's built-in tools (pi 0.73.1 ships read, bash, edit, write, grep, find, ls). */
export const piReadOnlyTools = "read,grep,find,ls";

/**
 * Provider API key environment variables Pi consults (pi-ai `env-api-keys`,
 * verified against 0.73.1). These are forwarded from the bridge environment to
 * the Pi subprocess; users can extend the set with
 * GREENROOM_HARNESS_ENV_ALLOWLIST.
 */
export const piProviderApiKeyEnvVars = [
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "ZAI_API_KEY",
] as const;

/** Maps a detected API key env var to the Pi provider name it selects. */
const piProviderInference: ReadonlyArray<readonly [envVar: string, provider: string]> = [
  ["ANTHROPIC_OAUTH_TOKEN", "anthropic"],
  ["ANTHROPIC_API_KEY", "anthropic"],
  ["OPENAI_API_KEY", "openai"],
  ["GEMINI_API_KEY", "google"],
  ["OPENROUTER_API_KEY", "openrouter"],
  ["GROQ_API_KEY", "groq"],
  ["CEREBRAS_API_KEY", "cerebras"],
  ["XAI_API_KEY", "xai"],
  ["MISTRAL_API_KEY", "mistral"],
  ["DEEPSEEK_API_KEY", "deepseek"],
  ["ZAI_API_KEY", "zai"],
];

/**
 * Model selection for Pi runs, in precedence order:
 * 1. GREENROOM_PI_MODEL — full pattern, supports "provider/model-id".
 * 2. GREENROOM_PI_PROVIDER — provider name; Pi picks its default model.
 * 3. The first provider whose API key env var is set (deterministic order
 *    above); Pi picks that provider's default model.
 * 4. Nothing — Pi falls back to its own default provider, which will fail
 *    with a clear error when no key is configured.
 */
export function piModelArgs(
  env: Record<string, string | undefined> = process.env,
  profile?: Parameters<HarnessCommandPreset["buildInvocation"]>[0]["request"]["profile"],
): string[] {
  const profileModel = profile?.model.trim();

  if (
    profileModel !== undefined &&
    profileModel.length > 0 &&
    profileModel !== "pi" &&
    profileModel !== profile?.harnessKind
  ) {
    return ["--model", profileModel];
  }

  const model = nonEmpty(env.GREENROOM_PI_MODEL);

  if (model !== null) {
    return ["--model", model];
  }

  const provider = nonEmpty(env.GREENROOM_PI_PROVIDER) ?? inferPiProvider(env);
  return provider === null ? [] : ["--provider", provider];
}

export function piReasoningArgs(
  profile: Parameters<HarnessCommandPreset["buildInvocation"]>[0]["request"]["profile"],
): string[] {
  return profile.reasoningLevel === null || profile.reasoningLevel === undefined
    ? []
    : ["--thinking", profile.reasoningLevel];
}

/** Picks the entries of {@link piProviderApiKeyEnvVars} present in the bridge env. */
export function piProviderEnvPassthrough(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const forwarded: Record<string, string | undefined> = {};

  for (const name of piProviderApiKeyEnvVars) {
    const value = env[name];

    if (value !== undefined && value.length > 0) {
      forwarded[name] = value;
    }
  }

  return forwarded;
}

function inferPiProvider(env: Record<string, string | undefined>): string | null {
  for (const [envVar, provider] of piProviderInference) {
    if (nonEmpty(env[envVar]) !== null) {
      return provider;
    }
  }

  return null;
}

function piSchemaSystemPrompt(schemaJson: string): string {
  return [
    "Your final reply must be a single JSON document that validates against the JSON Schema below.",
    "Output only the JSON document - no prose, no markdown code fences, no surrounding text.",
    "",
    schemaJson,
  ].join("\n");
}

/**
 * Parses Pi's `--mode json` JSONL stream: finds the final assistant message
 * (preferring the `agent_end` summary event), fails on provider errors
 * (`stopReason: "error"` — Pi still exits 0), and JSON-parses the joined text
 * blocks, tolerating a stray markdown code fence.
 */
export function parsePiOutput(stdout: string): unknown {
  const events = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map(parseJsonOrNull)
    .filter(isRecord);

  if (events.length === 0) {
    throw new Error("Pi did not produce JSON event output");
  }

  const message = finalAssistantMessage(events);

  if (message === null) {
    throw new Error("Pi did not return an assistant message");
  }

  if (message.stopReason === "error") {
    const detail = typeof message.errorMessage === "string" ? `: ${message.errorMessage}` : "";
    throw new Error(`Pi run failed${detail}`);
  }

  const text = assistantText(message);
  const parsed = parseJsonOrNull(stripCodeFence(text));

  if (isRecord(parsed) || Array.isArray(parsed)) {
    return parsed;
  }

  throw new Error("Pi did not return schema-bound JSON output");
}

function finalAssistantMessage(
  events: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  for (const event of [...events].reverse()) {
    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      const assistant = [...event.messages]
        .reverse()
        .find((entry): entry is Record<string, unknown> => isAssistantMessage(entry));

      if (assistant !== undefined) {
        return assistant;
      }
    }

    if (
      (event.type === "turn_end" || event.type === "message_end") &&
      isAssistantMessage(event.message)
    ) {
      return event.message;
    }
  }

  return null;
}

function isAssistantMessage(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.role === "assistant";
}

function assistantText(message: Record<string, unknown>): string {
  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/u.exec(trimmed);
  return fenced?.[1] ?? trimmed;
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

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}
