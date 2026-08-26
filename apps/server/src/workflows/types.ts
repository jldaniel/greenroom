import type {
  CapabilityTokenPublic,
  ReviewPrId,
  WorkflowDraftOutput,
  WorkflowFinalOutput,
  WorkflowKind,
  WorkflowRedactedMetadata,
  WorkflowRepairPromptMetadata,
  WorkflowRun,
  WorkflowRunCreateInput,
  WorkflowRunEvent,
  WorkflowRunEventCreateInput,
  WorkflowRunEventType,
  WorkflowRunPhase,
  WorkflowValidationIssue,
  HarnessStreamEvent,
} from "@greenroom/schemas";

export interface WorkflowDefinition {
  kind: WorkflowKind;
  version: string;
  steps: WorkflowStep[];
  validator?: WorkflowValidator;
  repairPolicy?: WorkflowRepairPolicy;
  autoRepair?: boolean;
  onValidDraft?: WorkflowValidDraftHandler;
  onFailure?: WorkflowFailureHandler;
  defaultTimeoutMs?: number;
  metadata?: WorkflowRedactedMetadata;
}

export interface WorkflowStep {
  id: string;
  phase: WorkflowRunPhase;
  eventType?: WorkflowRunEventType;
  summary: string;
  run: (
    context: WorkflowStepContext,
  ) => Promise<WorkflowStepResult | void> | WorkflowStepResult | void;
}

export interface WorkflowStepContext {
  run: WorkflowRun;
  signal: AbortSignal;
  events: WorkflowEventSink;
  mcpGrant: WorkflowRunMcpGrant | null;
  activity: WorkflowActivityReporter;
}

export interface WorkflowStepResult {
  draftOutput?: WorkflowDraftOutput;
  finalOutput?: WorkflowFinalOutput;
  metadata?: WorkflowRedactedMetadata;
}

export interface WorkflowRunner {
  createRun: (input: WorkflowRunnerCreateRunInput) => WorkflowRun;
  approveRun: (runId: WorkflowRun["id"]) => WorkflowRun;
  cancelRun: (runId: WorkflowRun["id"], reason?: string) => WorkflowRun;
  retryRun: (runId: WorkflowRun["id"]) => WorkflowRun;
  readRun: (runId: WorkflowRun["id"]) => WorkflowRun | null;
  listRunsByReview: (reviewId: ReviewPrId) => WorkflowRun[];
  listActiveRuns: () => WorkflowRun[];
  listEvents: (runId: WorkflowRun["id"]) => WorkflowRunEvent[];
  reportProgress: (input: WorkflowProgressReportInput) => WorkflowRunEvent | null;
  submitDraft: (
    runId: WorkflowRun["id"],
    draft: WorkflowDraftOutput,
  ) => Promise<WorkflowDraftSubmissionResult>;
  enqueueRun: (runId: WorkflowRun["id"]) => void;
}

export interface WorkflowRunnerCreateRunInput {
  run: Omit<WorkflowRunCreateInput, "status" | "phase" | "approvedScope"> & {
    status?: "pending_consent";
  };
}

export interface WorkflowValidator {
  validate: (
    context: WorkflowValidationContext,
    draft: WorkflowDraftOutput,
  ) => Promise<WorkflowValidationResult> | WorkflowValidationResult;
}

export interface WorkflowValidationContext {
  run: WorkflowRun;
  attemptNumber: number;
}

export interface WorkflowValidationResult {
  issues: WorkflowValidationIssue[];
}

export interface WorkflowRepairPolicy {
  maxAttempts: number;
  createRepairContext: (
    context: WorkflowRepairContext,
  ) => WorkflowRepairPromptMetadata | Promise<WorkflowRepairPromptMetadata>;
}

export interface WorkflowRepairContext {
  run: WorkflowRun;
  draft: WorkflowDraftOutput;
  issues: WorkflowValidationIssue[];
  attemptNumber: number;
  createdAt: string;
}

export interface WorkflowValidDraftContext {
  run: WorkflowRun;
  draft: WorkflowDraftOutput;
  events: WorkflowEventSink;
}

export interface WorkflowValidDraftResult {
  disposition?: "complete" | "awaiting_user";
  finalOutput?: WorkflowFinalOutput | null;
  metadata?: WorkflowRedactedMetadata;
  summary?: string;
}

export interface WorkflowValidDraftHandler {
  handle: (
    context: WorkflowValidDraftContext,
  ) => Promise<WorkflowValidDraftResult> | WorkflowValidDraftResult;
}

export interface WorkflowFailureContext {
  run: WorkflowRun;
  errorMessage: string;
  events: WorkflowEventSink;
}

export interface WorkflowFailureHandler {
  handle: (context: WorkflowFailureContext) => Promise<void> | void;
}

export interface WorkflowEventSink {
  record: (input: WorkflowRunEventCreateInput) => WorkflowRunEvent | null;
}

export interface WorkflowProgressReportInput {
  runId: WorkflowRun["id"];
  message: string;
  completedUnits?: number | undefined;
  totalUnits?: number | undefined;
  phase?: string | undefined;
}

export interface WorkflowActivityReporter {
  record: (input: WorkflowActivityInput) => void;
  recordHarnessEvent: (event: HarnessStreamEvent) => void;
}

export interface WorkflowActivityInput {
  runId: WorkflowRun["id"];
  summary: string;
  metadata?: WorkflowRedactedMetadata;
}

export interface WorkflowRunMcpGrant {
  id: CapabilityTokenPublic["id"];
  scopes: CapabilityTokenPublic["scopes"];
  plaintextToken: string;
}

export interface WorkflowDraftSubmissionResult {
  run: WorkflowRun;
  valid: boolean;
  issues: WorkflowValidationIssue[];
  repairContext: WorkflowRepairPromptMetadata | null;
}
