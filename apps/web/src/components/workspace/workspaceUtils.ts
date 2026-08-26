import type {
  BuiltinReviewRunId,
  SpotlightRunId,
  ThreadAnchor,
  WorkflowKind,
  WorkflowRun,
} from "@greenroom/schemas";

import type { SpotlightRunResource, SpotlightViewResource } from "../../api/client";
import { threadAnchorKey } from "../threadTriageUtils";
import { isWorkflowRunTerminal } from "../WorkflowPanels";
import type { SpotlightSelection, WorkspaceDrawerSection } from "./workspaceTypes";

export interface WorkspaceDrawerState {
  open: boolean;
  section: WorkspaceDrawerSection;
}

export const defaultWorkspaceDrawerState: WorkspaceDrawerState = {
  open: true,
  section: "threads",
};

const drawerSections: readonly WorkspaceDrawerSection[] = ["threads", "ai_review", "spotlight"];
const drawerStateStorageKey = "greenroom.workspace.drawer";

/**
 * Parses a persisted drawer state, falling back to the default (open on
 * Threads) for anything malformed so a stale or hand-edited value can never
 * break the workspace.
 */
export function parseWorkspaceDrawerState(raw: string | null): WorkspaceDrawerState {
  if (raw === null) {
    return defaultWorkspaceDrawerState;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return defaultWorkspaceDrawerState;
    }

    const { open, section } = parsed as { open?: unknown; section?: unknown };

    if (
      typeof open !== "boolean" ||
      typeof section !== "string" ||
      !drawerSections.includes(section as WorkspaceDrawerSection)
    ) {
      return defaultWorkspaceDrawerState;
    }

    return { open, section: section as WorkspaceDrawerSection };
  } catch {
    return defaultWorkspaceDrawerState;
  }
}

export function readWorkspaceDrawerState(): WorkspaceDrawerState {
  try {
    return parseWorkspaceDrawerState(window.localStorage.getItem(drawerStateStorageKey));
  } catch {
    return defaultWorkspaceDrawerState;
  }
}

export function writeWorkspaceDrawerState(state: WorkspaceDrawerState): void {
  try {
    window.localStorage.setItem(drawerStateStorageKey, JSON.stringify(state));
  } catch {
    // Persistence is best-effort; private windows may reject writes.
  }
}

export function buildWorkspaceStatus(input: {
  isLoading: boolean;
  isRefreshing: boolean;
  isSavingThread: boolean;
  sectionLabel: string;
  selectedFilePath: string | null;
  visibleThreadCount: number;
}): string {
  if (input.isLoading) {
    return "Loading review workspace";
  }

  if (input.isRefreshing) {
    return "Refreshing review";
  }

  if (input.isSavingThread) {
    return "Saving thread changes";
  }

  const file = input.selectedFilePath ?? "No file selected";

  return `${input.sectionLabel}. ${file}. ${input.visibleThreadCount} visible threads.`;
}

export function buildLineMembershipMap(
  memberships: readonly {
    anchor: ThreadAnchor;
    views: readonly SpotlightViewResource[];
  }[],
): Map<string, readonly SpotlightViewResource[]> {
  const mapped = new Map<string, readonly SpotlightViewResource[]>();

  for (const membership of memberships) {
    if (membership.views.length > 0) {
      mapped.set(threadAnchorKey(membership.anchor), membership.views);
    }
  }

  return mapped;
}

export function spotlightViewSelectionIsStale(
  selection: SpotlightSelection | null,
  views: readonly Pick<SpotlightViewResource, "displayRef">[],
): boolean {
  return selection?.kind === "view" && !views.some((view) => view.displayRef === selection.viewRef);
}

export function claimCompletedSpotlightWorkflowRefresh(
  workflowRun: Pick<WorkflowRun, "id" | "status"> | null,
  refreshedWorkflowRunIds: Set<string>,
): boolean {
  if (
    workflowRun === null ||
    workflowRun.status !== "completed" ||
    refreshedWorkflowRunIds.has(workflowRun.id)
  ) {
    return false;
  }

  refreshedWorkflowRunIds.add(workflowRun.id);
  return true;
}

export function anchorFileKey(anchor: ThreadAnchor): string {
  return fileKey(anchor.filePath, anchor.oldFilePath);
}

export function diffFileKey(file: { path: string; oldPath: string | null }): string {
  return fileKey(file.path, file.oldPath);
}

function fileKey(path: string, oldPath: string | null): string {
  return `${path}\0${oldPath ?? ""}`;
}

export function profileBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function latestSpotlightRun(
  candidates: readonly (SpotlightRunResource | undefined)[],
  runId: SpotlightRunId | null,
): SpotlightRunResource | null {
  const matching = candidates.filter(
    (candidate): candidate is SpotlightRunResource =>
      candidate !== undefined && (runId === null || candidate.id === runId),
  );

  return matching.reduce<SpotlightRunResource | null>((latest, candidate) => {
    if (latest === null) {
      return candidate;
    }

    return candidate.updatedAt >= latest.updatedAt ? candidate : latest;
  }, null);
}

const spotlightWorkflowKinds: readonly WorkflowKind[] = [
  "spotlight_plan",
  "spotlight_membership",
  "spotlight_refine",
];

/**
 * The review's most recently updated non-terminal workflow run of the given
 * kinds — the run a freshly mounted workspace should resume tracking after a
 * page reload. Terminal runs (completed/failed/cancelled) are never
 * resurrected; ties on `updatedAt` break to the larger run id so selection
 * stays deterministic across refetches.
 */
export function resumableWorkflowRun(
  runs: readonly WorkflowRun[],
  kinds: readonly WorkflowKind[],
): WorkflowRun | null {
  return runs
    .filter((run) => kinds.includes(run.workflowKind) && !isWorkflowRunTerminal(run.status))
    .reduce<WorkflowRun | null>((latest, candidate) => {
      if (latest === null) {
        return candidate;
      }

      return resumeSortKey(candidate) >= resumeSortKey(latest) ? candidate : latest;
    }, null);
}

function resumeSortKey(run: WorkflowRun): string {
  return `${run.updatedAt} ${run.id}`;
}

/**
 * Seed id for `useAiReviewRuns` after a reload: built-in review workflow run
 * ids double as built-in review run ids (both use the workflow_run_ prefix),
 * so the resumable run's own id is the one to track.
 */
export function resumableBuiltinReviewRunId(
  runs: readonly WorkflowRun[],
): BuiltinReviewRunId | null {
  const run = resumableWorkflowRun(runs, ["builtin_review"]);

  return run === null ? null : (run.id as BuiltinReviewRunId);
}

/**
 * Seed id for `useSpotlightRuns` after a reload: Spotlight workflow runs link
 * back to their spotlight run via `metadata.spotlightRunId`, so only runs
 * carrying a well-formed link are considered.
 */
export function resumableSpotlightRunId(runs: readonly WorkflowRun[]): SpotlightRunId | null {
  const linked = runs.filter((run) => linkedSpotlightRunId(run) !== null);
  const run = resumableWorkflowRun(linked, spotlightWorkflowKinds);

  return run === null ? null : linkedSpotlightRunId(run);
}

function linkedSpotlightRunId(run: WorkflowRun): SpotlightRunId | null {
  const value = run.metadata.spotlightRunId;

  return typeof value === "string" && value.startsWith("spotlight_run_")
    ? (value as SpotlightRunId)
    : null;
}

export function latestLinkedWorkflowRun(
  runs: readonly WorkflowRun[],
  metadataKey: string,
  linkedId: string | null,
): WorkflowRun | null {
  if (linkedId === null) {
    return null;
  }

  return runs
    .filter((run) => run.metadata[metadataKey] === linkedId)
    .reduce<WorkflowRun | null>((latest, candidate) => {
      if (latest === null) {
        return candidate;
      }

      return candidate.updatedAt >= latest.updatedAt ? candidate : latest;
    }, null);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
