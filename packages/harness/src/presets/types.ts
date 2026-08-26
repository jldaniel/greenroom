import type {
  HarnessRunRequest,
  HarnessStreamEvent,
  HarnessStreamingCapability,
} from "@greenroom/schemas";

export interface HarnessCommandPreset {
  kind: string;
  label: string;
  streaming: HarnessStreamingCapability;
  buildInvocation: (input: HarnessCommandPresetInput) => HarnessCommandInvocation;
  parseOutput: (input: HarnessCommandOutput) => Promise<unknown>;
  parseStreamEvent?: (line: string) => HarnessStreamEventDraft | null;
}

export interface HarnessCommandPresetInput {
  request: HarnessRunRequest;
  workDir?: string;
  cwd: string;
  schemaPath: string;
  schemaJson: string;
  promptPath: string;
  outputPath: string;
  mcpConfigPath: string | null;
  mcpUrl: string | null;
}

export interface HarnessCommandInvocation {
  command: string;
  args: string[];
  stdin: string;
  env?: Record<string, string | undefined>;
  prepare?: () => Promise<void>;
  interactive?: HarnessInteractiveSession;
}

export interface HarnessInteractiveSessionAction {
  write?: string[];
  close?: boolean;
}

export interface HarnessInteractiveSession {
  start: () => string[];
  onLine: (line: string) => HarnessInteractiveSessionAction;
}

export interface HarnessCommandOutput {
  stdout: string;
  outputPath: string;
}

export type HarnessStreamEventDraft = Omit<HarnessStreamEvent, "sequence" | "timestamp">;
