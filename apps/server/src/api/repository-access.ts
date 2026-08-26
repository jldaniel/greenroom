import {
  harnessRepositoryAccessModeFromProfile,
  harnessRepositoryWorkspaceStrategyFromProfile,
  workflowDefaultRepositoryAccessSummary,
  type Profile,
  type Repository,
  type RevisionSnapshot,
  type WorkflowRepositoryAccessSummary,
} from "@greenroom/schemas";

export function workflowRepositoryAccessSummaryForProfile(input: {
  profile: Pick<Profile, "provider" | "modelSettings">;
  repository: Pick<Repository, "rootPath">;
  revision: Pick<RevisionSnapshot, "id" | "baseSha" | "headSha">;
}): WorkflowRepositoryAccessSummary {
  const configuredMode = harnessRepositoryAccessModeFromProfile(input.profile);

  if (configuredMode !== "snapshot_readonly" || input.revision.headSha === null) {
    return { ...workflowDefaultRepositoryAccessSummary };
  }

  return {
    mode: "snapshot_readonly",
    readScopeLabel:
      "Tracked repository files at the approved commit may be read from an isolated snapshot.",
    revisionId: input.revision.id,
    baseSha: input.revision.baseSha,
    headSha: input.revision.headSha,
    workspaceStrategy: harnessRepositoryWorkspaceStrategyFromProfile(input.profile),
  };
}

export function workflowRepositoryAccessMetadata(
  repositoryAccess: WorkflowRepositoryAccessSummary,
): Record<string, string> {
  return {
    repositoryAccessMode: repositoryAccess.mode,
    repositoryAccessReadScopeLabel: repositoryAccess.readScopeLabel,
    ...(repositoryAccess.revisionId === null
      ? {}
      : { repositoryAccessRevisionId: repositoryAccess.revisionId }),
    ...(repositoryAccess.baseSha === null
      ? {}
      : { repositoryAccessBaseSha: repositoryAccess.baseSha }),
    ...(repositoryAccess.headSha === null
      ? {}
      : { repositoryAccessHeadSha: repositoryAccess.headSha }),
    ...(repositoryAccess.workspaceStrategy === null
      ? {}
      : { repositoryAccessWorkspaceStrategy: repositoryAccess.workspaceStrategy }),
  };
}
