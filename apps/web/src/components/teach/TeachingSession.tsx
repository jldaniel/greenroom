import { useEffect, useMemo, useState } from "react";

import type {
  DiffFile,
  ProfileId,
  ReviewReference,
  RevisionId,
  SpotlightViewRef,
  TeachingRunId,
  TeachingRunResult,
  WorkflowRunId,
} from "@greenroom/schemas";

import type { SpotlightViewResource } from "../../api/client";
import {
  useApproveTeachingRun,
  useCreateTeachingConsent,
  useHarnessStatus,
  useProfiles,
  usePromoteTeachingPoint,
  useTeachingRun,
  useWorkflowRun,
  useWorkflowRunEvents,
  useWorkflowRuns,
} from "../../api/hooks";
import { deriveAiRunReadiness } from "../aiReadinessUtils";
import { ConsentCard } from "../ConsentCard";
import { ApiErrorBanner, EmptyState } from "../Feedback";
import { RunConsentDialog } from "../RunConsentDialog";
import { RunStatus } from "../RunStatus";
import { isWorkflowRunActive, WorkflowValidationIssueList } from "../WorkflowPanels";
import { FollowUpThread } from "./FollowUpThread";
import type { QuizAnswerMap } from "./quizProgress";
import { TeachingConsentSummary } from "./TeachingConsentSummary";
import { TeachingQuiz } from "./TeachingQuiz";
import {
  firstAnchorFromContext,
  latestWorkflowRunByKind,
  promotionTitle,
  type TeachingPromotedPoint,
} from "./teachingSessionUtils";
import { TeachingSetupCard, type TeachingScopeKind } from "./TeachingSetupCard";
import { TeachingWalkthrough } from "./TeachingWalkthrough";
import { useFollowUpConversation } from "./useFollowUpConversation";

interface TeachingSessionProps {
  reviewId: ReviewReference;
  revisionId: RevisionId | null;
  currentRevisionId: RevisionId | null;
  files: DiffFile[];
  initialSpotlightViewRef?: SpotlightViewRef | null;
  onPromoted?: (shortRef: string) => void;
  spotlightViews?: SpotlightViewResource[];
}

/**
 * Interactive teaching session for the full-page Teach route.
 * Owns the run lifecycle (prepare/consent/approve via the shared
 * ConsentCard/RunStatus components) and the session interaction state: quiz
 * answers, and the follow-up conversation (persisted exchanges from the
 * original run's workflow events merged with in-flight client entries).
 */
export function TeachingSession({
  reviewId,
  revisionId,
  currentRevisionId,
  files,
  initialSpotlightViewRef = null,
  onPromoted,
  spotlightViews = [],
}: TeachingSessionProps) {
  const profiles = useProfiles();
  const teachingProfiles = useMemo(
    () => (profiles.data ?? []).filter((profile) => profile.workflowType === "teaching"),
    [profiles.data],
  );
  const defaultProfileId = teachingProfiles[0]?.id ?? null;
  const [profileId, setProfileId] = useState<ProfileId | null>(defaultProfileId);
  const [scopeKind, setScopeKind] = useState<TeachingScopeKind>(
    initialSpotlightViewRef === null ? "full_pr" : "spotlight_view",
  );
  const [spotlightViewRef, setSpotlightViewRef] = useState<SpotlightViewRef | null>(
    initialSpotlightViewRef,
  );
  const [run, setRun] = useState<TeachingRunResult | null>(null);
  const [isConfirmingRun, setIsConfirmingRun] = useState(false);
  const [trustedRunStarted, setTrustedRunStarted] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<QuizAnswerMap>({});
  const createConsent = useCreateTeachingConsent();
  const approveRun = useApproveTeachingRun();
  const promotePoint = usePromoteTeachingPoint();
  const workflowRuns = useWorkflowRuns(reviewId, true, true);
  const latestTeachingWorkflowRun = useMemo(
    () => latestWorkflowRunByKind(workflowRuns.data ?? [], "teaching_generate"),
    [workflowRuns.data],
  );
  const activeRunId = (run?.id ?? latestTeachingWorkflowRun?.id ?? null) as TeachingRunId | null;
  const activeWorkflowRunId = activeRunId as WorkflowRunId | null;
  const durableRun = useTeachingRun(activeRunId);
  const workflowRun = useWorkflowRun(activeWorkflowRunId);
  const workflowEvents = useWorkflowRunEvents(
    activeWorkflowRunId,
    activeWorkflowRunId !== null,
    workflowRun.data !== undefined && isWorkflowRunActive(workflowRun.data.status),
  );
  const selectedProfile =
    profileId === null
      ? null
      : (teachingProfiles.find((profile) => profile.id === profileId) ?? null);
  const selectedSpotlightView =
    spotlightViewRef === null
      ? null
      : (spotlightViews.find((view) => view.displayRef === spotlightViewRef) ?? null);
  const consentMode = selectedProfile?.privacy.consentMode ?? "one_click";
  const oneClickConsent = consentMode === "one_click";
  const trustedConsent = consentMode === "trusted";
  const consentRevisionId = scopeKind === "spotlight_view" ? currentRevisionId : revisionId;
  // Point-of-use readiness: harness-backed teaching profiles are
  // disabled with an inline reason when the bridge cannot run; mock profiles
  // stay enabled.
  const harnessStatus = useHarnessStatus();
  const readiness = deriveAiRunReadiness({
    provider: selectedProfile?.provider ?? null,
    status: harnessStatus.data,
  });
  const canCreateConsent =
    profileId !== null &&
    consentRevisionId !== null &&
    files.length > 0 &&
    !readiness.blocked &&
    (scopeKind === "full_pr" || selectedSpotlightView !== null);
  const fileScopeLabel = `${files.length} ${files.length === 1 ? "file" : "files"}`;
  const viewScopeLabel =
    selectedSpotlightView === null
      ? "No View selected"
      : `${selectedSpotlightView.title} (${selectedSpotlightView.associatedFiles.length} ${
          selectedSpotlightView.associatedFiles.length === 1 ? "file" : "files"
        })`;
  const scopeLabel =
    scopeKind === "spotlight_view"
      ? `Spotlight View - ${viewScopeLabel}`
      : `Full PR (${fileScopeLabel})`;
  // Follow-up errors render inline in the conversation, not in the banner.
  const mutationError =
    createConsent.error ??
    approveRun.error ??
    promotePoint.error ??
    workflowRuns.error ??
    durableRun.error ??
    workflowRun.error ??
    workflowEvents.error ??
    profiles.error;
  const followUps = useFollowUpConversation({
    events: workflowEvents.data,
    runId: run?.id ?? null,
  });

  useEffect(() => {
    if (profileId === null && defaultProfileId !== null) {
      setProfileId(defaultProfileId);
    }
  }, [defaultProfileId, profileId]);

  useEffect(() => {
    if (
      initialSpotlightViewRef !== null &&
      spotlightViews.some((view) => view.displayRef === initialSpotlightViewRef)
    ) {
      setScopeKind("spotlight_view");
      setSpotlightViewRef(initialSpotlightViewRef);
    }
  }, [initialSpotlightViewRef, spotlightViews]);

  useEffect(() => {
    if (scopeKind !== "spotlight_view") {
      return;
    }

    if (
      spotlightViewRef !== null &&
      spotlightViews.some((view) => view.displayRef === spotlightViewRef)
    ) {
      return;
    }

    setSpotlightViewRef(spotlightViews[0]?.displayRef ?? null);
  }, [scopeKind, spotlightViewRef, spotlightViews]);

  useEffect(() => {
    if (durableRun.data === undefined) {
      return;
    }

    if (run === null || run.id === durableRun.data.id) {
      setRun(durableRun.data);
    }
  }, [durableRun.data, run]);

  async function handleCreateConsent(start: boolean) {
    if (!canCreateConsent || profileId === null || consentRevisionId === null) {
      return;
    }

    const created = await createConsent.mutateAsync({
      reviewId,
      input: {
        profileId,
        revisionId: consentRevisionId,
        scope:
          scopeKind === "spotlight_view" && selectedSpotlightView !== null
            ? { kind: "spotlight_view", viewRef: selectedSpotlightView.displayRef }
            : { kind: "full_pr" },
        maxApproximateTokens: 16_000,
        ...(start ? { start: true } : {}),
      },
    });

    setRun(created);
    setQuizAnswers({});
    followUps.reset();
  }

  function handleRequestRun() {
    // Trusted profiles skip the confirmation dialog entirely: the run starts
    // immediately and the page surfaces a lightweight started notice.
    if (trustedConsent) {
      setTrustedRunStarted(true);
      void handleCreateConsent(true);
      return;
    }

    if (oneClickConsent) {
      setIsConfirmingRun(true);
      return;
    }

    void handleCreateConsent(false);
  }

  async function handleConfirmRun() {
    try {
      await handleCreateConsent(true);
    } finally {
      setIsConfirmingRun(false);
    }
  }

  async function handleApproveRun() {
    if (run === null) {
      return;
    }

    setRun(await approveRun.mutateAsync(run.id));
  }

  async function handlePromote(input: TeachingPromotedPoint) {
    if (run === null) {
      return;
    }

    const anchor = input.anchor ?? firstAnchorFromContext(run);

    if (anchor === null) {
      return;
    }

    const thread = await promotePoint.mutateAsync({
      reviewId,
      input: {
        runId: run.id,
        profileId: run.profileId,
        title: promotionTitle(input.title),
        body: input.body,
        anchor,
      },
    });

    onPromoted?.(thread.shortRef);
  }

  return (
    <div className="space-y-5">
      {mutationError === null ? null : <ApiErrorBanner error={mutationError} />}

      <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <TeachingSetupCard
            canCreateRun={canCreateConsent}
            consentMode={consentMode}
            fileCount={files.length}
            isChecking={harnessStatus.isLoading}
            isCreating={createConsent.isPending}
            onRequestRun={handleRequestRun}
            onScopeKindChange={setScopeKind}
            onSelectProfile={setProfileId}
            onSelectSpotlightView={setSpotlightViewRef}
            profileId={profileId}
            readiness={readiness}
            revisionId={revisionId}
            scopeKind={scopeKind}
            scopeLabel={scopeLabel}
            selectedProfile={selectedProfile}
            spotlightViewRef={spotlightViewRef}
            spotlightViews={spotlightViews}
            teachingProfiles={teachingProfiles}
            trustedRunStarted={trustedRunStarted}
          />

          {run === null ? null : (
            <>
              <RunStatus
                emptyEventsLabel="No Teaching workflow events yet."
                events={workflowEvents.data ?? []}
                isLoadingEvents={workflowEvents.isLoading}
                run={workflowRun.data ?? null}
              />

              <ConsentCard
                approveLabel="Approve"
                consent={workflowRun.data?.consentSummary ?? null}
                fallback={<TeachingConsentSummary run={run} />}
                {...(run.status === "pending_consent" || run.status === "approved"
                  ? { isApproving: approveRun.isPending, onApprove: () => void handleApproveRun() }
                  : {})}
              />

              <WorkflowValidationIssueList issues={workflowRun.data?.validationIssues ?? []} />
            </>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          {run === null ? (
            <EmptyState
              title="No teaching run"
              body="Prepare a run to generate an interactive walkthrough, quiz, and follow-up Q&A for this review."
            />
          ) : run.output === null ? (
            <EmptyState
              title="Waiting for teaching output"
              body="Approve the consent summary to launch the run; the walkthrough appears here when it completes."
            />
          ) : (
            <>
              <TeachingTextBlock title="Summary" body={run.output.changeSummary} />
              <TeachingTextBlock title="Architecture" body={run.output.architectureExplanation} />

              <TeachingWalkthrough
                contextFiles={run.context.files}
                onPromote={(point) => void handlePromote(point)}
                output={run.output}
              />

              <TeachingQuiz
                answers={quizAnswers}
                contextFiles={run.context.files}
                onAnswer={(questionId, choiceId) =>
                  setQuizAnswers((current) => ({ ...current, [questionId]: choiceId }))
                }
                onPromote={(point) => void handlePromote(point)}
                onReset={() => setQuizAnswers({})}
                output={run.output}
              />

              <FollowUpThread
                entries={followUps.conversation}
                isAsking={followUps.isAsking}
                onAsk={(question: string) => void followUps.ask(question)}
              />
            </>
          )}
        </div>
      </div>

      {isConfirmingRun ? (
        <RunConsentDialog
          confirmLabel="Confirm & teach"
          details={[
            { label: "Profile", value: selectedProfile?.name ?? "None" },
            {
              label: "Provider",
              value:
                selectedProfile === null
                  ? "None"
                  : `${selectedProfile.provider} / ${selectedProfile.model}`,
            },
            { label: "Scope", value: scopeLabel },
            { label: "Revision", value: consentRevisionId ?? "None" },
          ]}
          isConfirming={createConsent.isPending}
          onCancel={() => setIsConfirmingRun(false)}
          onConfirm={() => void handleConfirmRun()}
          title="Start teaching run"
        />
      ) : null}
    </div>
  );
}

function TeachingTextBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-muted-surface p-4">
      <p className="text-xs font-medium uppercase text-muted">{title}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{body}</p>
    </div>
  );
}
