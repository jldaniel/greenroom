import type {
  HarnessExecutionMetadata,
  HarnessRunRequest,
  HarnessStreamEvent,
  Profile,
  ProfileId,
  WorkflowRunId,
} from "@greenroom/schemas";

import type { WorkflowTranscriptPersistenceService } from "../storage/transcripts";
import type { WorkflowPersistenceService } from "../storage/workflows";
import { HarnessRunFailedError, type HarnessClient } from "./harness-client";

export interface TranscriptRecordingHarnessClientOptions {
  transcripts: WorkflowTranscriptPersistenceService;
  workflows: Pick<WorkflowPersistenceService, "readRun">;
  profiles: { get: (id: ProfileId) => Profile | null };
}

/**
 * Wraps a harness client so every bridge run persists a redacted transcript
 * (prompt, harness output, stderr) keyed to the workflow run.
 *
 * Persistence is skipped when transcripts are disabled, when the profile has
 * opted out through `privacy.persistTranscript: false`, or when the run id
 * does not reference a durable workflow run. Transcript persistence failures
 * never interrupt the harness run itself.
 */
export function createTranscriptRecordingHarnessClient(
  client: HarnessClient,
  options: TranscriptRecordingHarnessClientOptions,
): HarnessClient {
  function record(
    request: HarnessRunRequest,
    result: {
      status: "completed" | "failed";
      output: unknown;
      execution: HarnessExecutionMetadata | null;
      message?: string | undefined;
    },
  ): void {
    try {
      if (!options.transcripts.config.enabled) {
        return;
      }

      const run = options.workflows.readRun(request.runId as WorkflowRunId);

      if (run === null) {
        return;
      }

      const profile = options.profiles.get(request.profile.id);

      if (profile !== null && !profile.privacy.persistTranscript) {
        return;
      }

      options.transcripts.save({
        runId: run.id,
        profileId: request.profile.id,
        workflowKind: run.workflowKind,
        attempt: request.repairAttemptNumber ?? 0,
        status: result.status,
        exitCode: result.execution?.exitCode ?? null,
        prompt: request.prompt,
        output: serializeOutput(result.output),
        stderr: stderrForResult(result),
        extraSecrets: request.mcp?.token === undefined ? [] : [request.mcp.token],
      });
    } catch {
      // Transcript persistence is best-effort and must never fail the run.
    }
  }

  function recordEvent(request: HarnessRunRequest, event: HarnessStreamEvent): void {
    try {
      if (!options.transcripts.config.enabled) {
        return;
      }

      const run = options.workflows.readRun(request.runId as WorkflowRunId);

      if (run === null) {
        return;
      }

      const profile = options.profiles.get(request.profile.id);

      if (profile !== null && !profile.privacy.persistTranscript) {
        return;
      }

      options.transcripts.saveEvent({
        runId: run.id,
        profileId: request.profile.id,
        workflowKind: run.workflowKind,
        attempt: request.repairAttemptNumber ?? 0,
        event,
        extraSecrets: request.mcp?.token === undefined ? [] : [request.mcp.token],
      });
    } catch {
      // Incremental transcript persistence is best-effort.
    }
  }

  const health = client.health;
  const detectedHarnesses = client.detectedHarnesses;
  const models = client.models;
  const recordSmoke = client.recordSmoke;

  return {
    ...(client.config === undefined ? {} : { config: client.config }),
    ...(health === undefined ? {} : { health: () => health() }),
    ...(detectedHarnesses === undefined
      ? {}
      : { detectedHarnesses: (options?: { refresh?: boolean }) => detectedHarnesses(options) }),
    ...(models === undefined
      ? {}
      : {
          models: (kind: string, options?: { refresh?: boolean }) => models(kind, options),
        }),
    ...(recordSmoke === undefined ? {} : { recordSmoke: (kind: string) => recordSmoke(kind) }),
    async run(request, runOptions) {
      const onEvent = (event: HarnessStreamEvent) => {
        recordEvent(request, event);
        runOptions?.onEvent?.(event);
      };

      try {
        const response = await client.run(request, { ...runOptions, onEvent });

        record(request, {
          status: response.status,
          output: response.output,
          execution: response.execution,
          message: response.message,
        });

        return response;
      } catch (error) {
        if (error instanceof HarnessRunFailedError) {
          record(request, {
            status: "failed",
            output: error.run.output,
            execution: error.run.execution,
            message: error.run.message,
          });
        } else {
          record(request, {
            status: "failed",
            output: undefined,
            execution: null,
            message: error instanceof Error ? error.message : "Harness run failed",
          });
        }

        throw error;
      }
    },
  };
}

function serializeOutput(output: unknown): string | null {
  if (output === undefined) {
    return null;
  }

  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output) ?? null;
  } catch {
    return null;
  }
}

function stderrForResult(result: {
  execution: HarnessExecutionMetadata | null;
  message?: string | undefined;
}): string {
  const stderrTail = result.execution?.stderrTail ?? "";

  if (stderrTail.length > 0) {
    return stderrTail;
  }

  return result.message ?? "";
}
