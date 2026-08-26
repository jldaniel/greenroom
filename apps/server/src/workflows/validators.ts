import { workflowRepairPromptMetadataSchema, type WorkflowDraftOutput } from "@greenroom/schemas";

import { defaultWorkflowMaxRepairAttempts } from "../config";
import type {
  WorkflowRepairContext,
  WorkflowRepairPolicy,
  WorkflowValidationContext,
  WorkflowValidationResult,
  WorkflowValidator,
} from "./types";

export const acceptingWorkflowValidator: WorkflowValidator = {
  validate: () => ({ issues: [] }),
};

export function createDraftKindValidator(
  expectedKind: WorkflowDraftOutput["kind"],
): WorkflowValidator {
  return {
    validate(context, draft) {
      const issues: WorkflowValidationResult["issues"] = [];

      if (draft.kind !== expectedKind) {
        issues.push({
          code: "unexpected-draft-kind",
          message: `Workflow ${context.run.workflowKind} expected ${expectedKind} but received ${draft.kind}.`,
          severity: "error",
          path: ["kind"],
          recoverable: true,
          metadata: { expectedKind, receivedKind: draft.kind },
        });
      }

      return { issues };
    },
  };
}

export function createCompositeWorkflowValidator(
  validators: readonly WorkflowValidator[],
): WorkflowValidator {
  return {
    async validate(context: WorkflowValidationContext, draft: WorkflowDraftOutput) {
      const issueGroups = await Promise.all(
        validators.map(async (validator) => (await validator.validate(context, draft)).issues),
      );

      return { issues: issueGroups.flat() };
    },
  };
}

export function createDefaultWorkflowRepairPolicy(
  maxAttempts = defaultWorkflowMaxRepairAttempts,
): WorkflowRepairPolicy {
  return {
    maxAttempts,
    createRepairContext(context: WorkflowRepairContext) {
      return workflowRepairPromptMetadataSchema.parse({
        attemptNumber: context.attemptNumber,
        issueCodes: context.issues.map((issue) => issue.code),
        promptSummary: repairPromptSummary(context),
        createdAt: context.createdAt,
        metadata: {
          workflowKind: context.run.workflowKind,
          runId: context.run.id,
          draftKind: context.draft.kind,
        },
      });
    },
  };
}

function repairPromptSummary(context: WorkflowRepairContext): string {
  const issueSummary = context.issues
    .slice(0, 5)
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join("; ");

  return `Repair attempt ${context.attemptNumber} for ${context.run.workflowKind}. Address validation issues without broadening approved scope. ${issueSummary}`;
}
