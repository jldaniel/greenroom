import type { WorkflowValidationIssue } from "@greenroom/schemas";

import type { WorkflowDefinition, WorkflowValidator } from "./types";
import { createCompositeWorkflowValidator, createDraftKindValidator } from "./validators";

const setupSmokeValidator: WorkflowValidator = createCompositeWorkflowValidator([
  createDraftKindValidator("setup_smoke_report"),
  {
    validate(_context, draft) {
      const issues: WorkflowValidationIssue[] = [];

      if (draft.kind === "setup_smoke_report" && draft.status !== "passed") {
        issues.push({
          code: "setup-smoke-failed",
          message: "Setup smoke reports must pass before the workflow can complete.",
          severity: "error",
          path: ["status"],
          recoverable: true,
          metadata: { receivedStatus: draft.status },
        });
      }

      return { issues };
    },
  },
]);

export function createSetupSmokeWorkflowDefinition(): WorkflowDefinition {
  return {
    kind: "setup_smoke",
    version: "greenroom.setup-smoke.v1",
    defaultTimeoutMs: 30_000,
    validator: setupSmokeValidator,
    steps: [
      {
        id: "setup-smoke.check-runtime",
        phase: "drafting",
        eventType: "harness_launch",
        summary: "Run setup smoke checks.",
        run: () => ({
          draftOutput: {
            kind: "setup_smoke_report",
            status: "passed",
            checks: [
              {
                name: "orchestrator",
                status: "passed",
                summary: "In-process workflow runner accepted and executed the run.",
              },
            ],
          },
        }),
      },
    ],
  };
}
