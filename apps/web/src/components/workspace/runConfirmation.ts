import type { DiffFile, Profile, RevisionId } from "@greenroom/schemas";

import type { SpotlightViewResource } from "../../api/client";
import type { RunConsentDetail } from "../RunConsentDialog";
import { compactSha } from "../../utils";
import { worktreeDirtyWarning, type PendingRunConfirmation } from "./workspaceTypes";

/**
 * Detail rows for the shared one-click RunConsentDialog: what scope
 * the run will see, summarized from client-known state.
 */
export function pendingRunConfirmationDetails({
  currentWorktreeHeadSha,
  files,
  pendingRunConfirmation,
  profile,
  reviewDisplayId,
  revisionId,
  selectedSpotlightView,
}: {
  currentWorktreeHeadSha: string | null;
  files: readonly DiffFile[];
  pendingRunConfirmation: PendingRunConfirmation;
  profile: Profile | null;
  reviewDisplayId: string;
  revisionId: RevisionId | null;
  selectedSpotlightView: SpotlightViewResource | null;
}): RunConsentDetail[] {
  const fileScope = `All changed files (${files.length} ${files.length === 1 ? "file" : "files"})`;
  const scope =
    pendingRunConfirmation.kind !== "spotlight"
      ? fileScope
      : pendingRunConfirmation.type === "refine_view"
        ? `Refine View - ${selectedSpotlightView?.title ?? "Unknown"}`
        : pendingRunConfirmation.type === "update"
          ? `Update existing Views from ${fileScope.toLowerCase()}`
          : pendingRunConfirmation.type === "regenerate"
            ? `Regenerate fresh Views from ${fileScope.toLowerCase()}`
            : fileScope;

  return [
    { label: "Profile", value: profile?.name ?? "None" },
    {
      label: "Provider",
      value: profile === null ? "None" : `${profile.provider} / ${profile.model}`,
    },
    { label: "Review", value: reviewDisplayId },
    {
      label: "Revision",
      value:
        pendingRunConfirmation.kind === "fingerprint_recovery"
          ? "New snapshot of the current worktree (created on confirm)"
          : (revisionId ?? "None"),
    },
    ...(pendingRunConfirmation.kind === "fingerprint_recovery"
      ? [
          {
            label: "Worktree",
            value:
              currentWorktreeHeadSha === null
                ? "Current worktree state"
                : `HEAD ${compactSha(currentWorktreeHeadSha)} plus staged and unstaged changes`,
          },
        ]
      : []),
    { label: "Scope", value: scope },
  ];
}

export function pendingRunConfirmationDescription(
  pendingRunConfirmation: PendingRunConfirmation,
  worktreeDirty: boolean,
): string | null {
  if (pendingRunConfirmation.kind === "fingerprint_recovery") {
    return "The review will be refreshed to a new revision snapshot of the current worktree before the run starts.";
  }

  if (pendingRunConfirmation.kind === "spotlight" && pendingRunConfirmation.type === "regenerate") {
    return worktreeDirty
      ? `Existing Spotlight Views and regions will be replaced. ${worktreeDirtyWarning}`
      : "Existing Spotlight Views and regions will be replaced.";
  }

  return worktreeDirty ? worktreeDirtyWarning : null;
}

export function pendingRunConfirmationTitle(
  pendingRunConfirmation: PendingRunConfirmation,
): string {
  return pendingRunConfirmation.kind === "ai_review"
    ? "Start AI review run"
    : pendingRunConfirmation.kind === "fingerprint_recovery"
      ? "Refresh review and retry AI run"
      : "Start Spotlight run";
}
