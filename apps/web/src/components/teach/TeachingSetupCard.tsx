import { BookOpen, Play } from "lucide-react";

import type { Profile, ProfileId, SpotlightViewRef } from "@greenroom/schemas";

import type { SpotlightViewResource } from "../../api/client";
import { AiReadinessNote } from "../AiReadinessNote";
import type { AiRunReadiness } from "../aiReadinessUtils";

export type TeachingScopeKind = "full_pr" | "spotlight_view";

/**
 * Run setup sidebar card for the Teach page: teaching profile
 * selection, Full PR / Spotlight View scope, point-of-use readiness,
 * and the run CTA. Consent confirmation itself stays in
 * TeachingSession so trusted/one-click/two-step behavior is unchanged.
 */
export function TeachingSetupCard({
  canCreateRun,
  consentMode,
  fileCount,
  isChecking,
  isCreating,
  onRequestRun,
  onScopeKindChange,
  onSelectProfile,
  onSelectSpotlightView,
  profileId,
  readiness,
  revisionId,
  scopeKind,
  scopeLabel,
  selectedProfile,
  spotlightViewRef,
  spotlightViews,
  teachingProfiles,
  trustedRunStarted,
}: {
  canCreateRun: boolean;
  consentMode: Profile["privacy"]["consentMode"];
  fileCount: number;
  isChecking: boolean;
  isCreating: boolean;
  onRequestRun: () => void;
  onScopeKindChange: (scopeKind: TeachingScopeKind) => void;
  onSelectProfile: (profileId: ProfileId) => void;
  onSelectSpotlightView: (viewRef: SpotlightViewRef) => void;
  profileId: ProfileId | null;
  readiness: AiRunReadiness;
  revisionId: string | null;
  scopeKind: TeachingScopeKind;
  scopeLabel: string;
  selectedProfile: Profile | null;
  spotlightViewRef: SpotlightViewRef | null;
  spotlightViews: readonly SpotlightViewResource[];
  teachingProfiles: readonly Profile[];
  trustedRunStarted: boolean;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BookOpen aria-hidden="true" className="size-4 text-accent-ink" />
        Teaching run
      </div>

      <div className="mt-3 space-y-3">
        <label className="grid gap-1 text-xs font-medium text-muted">
          <span>Profile</span>
          <select
            className="h-9 min-w-0 w-full max-w-full rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={profileId ?? ""}
            onChange={(event) => onSelectProfile(event.target.value as ProfileId)}
          >
            {teachingProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs text-muted">
          <dt>Provider</dt>
          <dd className="truncate text-ink">{selectedProfile?.provider ?? "None"}</dd>
          <dt>Model</dt>
          <dd className="truncate font-mono text-ink">{selectedProfile?.model ?? "None"}</dd>
          <dt>Scope</dt>
          <dd className="truncate text-ink">{scopeLabel}</dd>
        </dl>

        <AiReadinessNote isChecking={isChecking} readiness={readiness} />

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted-surface p-1">
          <button
            aria-pressed={scopeKind === "full_pr"}
            className={scopeButtonClassName(scopeKind === "full_pr")}
            onClick={() => onScopeKindChange("full_pr")}
            type="button"
          >
            Full PR
          </button>
          <button
            aria-pressed={scopeKind === "spotlight_view"}
            className={scopeButtonClassName(scopeKind === "spotlight_view")}
            disabled={spotlightViews.length === 0}
            onClick={() => onScopeKindChange("spotlight_view")}
            type="button"
          >
            Spotlight View
          </button>
        </div>

        {scopeKind !== "spotlight_view" ? null : (
          <label className="grid gap-1 text-xs font-medium text-muted">
            <span>View</span>
            <select
              className="h-9 min-w-0 w-full max-w-full rounded-md border border-line bg-surface px-2 text-sm text-ink"
              disabled={spotlightViews.length === 0}
              value={spotlightViewRef ?? ""}
              onChange={(event) => onSelectSpotlightView(event.target.value as SpotlightViewRef)}
            >
              {spotlightViews.map((view) => (
                <option key={view.displayRef} value={view.displayRef}>
                  {view.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={onRequestRun}
          disabled={!canCreateRun || isCreating}
          title={readiness.reason ?? undefined}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
        >
          <Play aria-hidden="true" className="size-4" />
          {consentMode === "two_step" ? "Prepare" : "Teach"}
        </button>
        {consentMode === "trusted" ? (
          <p aria-live="polite" className="text-xs text-muted" role="status">
            {trustedRunStarted
              ? "Trusted profile: teaching run started without confirmation."
              : "Trusted profile: runs start immediately without a confirmation dialog."}
          </p>
        ) : null}
        {teachingProfiles.length === 0 ? (
          <p className="text-xs text-warning-ink">
            Create a teaching profile in Settings before preparing a run.
          </p>
        ) : revisionId === null ? (
          <p className="text-xs text-warning-ink">Select a revision before preparing a run.</p>
        ) : scopeKind === "spotlight_view" && spotlightViews.length === 0 ? (
          <p className="text-xs text-warning-ink">Generate a Spotlight View before preparing.</p>
        ) : fileCount === 0 ? (
          <p className="text-xs text-warning-ink">No diff context is available for teaching.</p>
        ) : null}
      </div>
    </section>
  );
}

function scopeButtonClassName(active: boolean): string {
  return `inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium ${
    active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink disabled:opacity-50"
  }`;
}
