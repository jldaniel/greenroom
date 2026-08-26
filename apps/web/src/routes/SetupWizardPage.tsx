import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  Clipboard,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Terminal,
  X,
} from "lucide-react";

import type { HarnessDetectedCli } from "@greenroom/schemas";

import {
  GreenroomApiError,
  readGreenroomApiTokenStatus,
  storeGreenroomApiToken,
  type GreenroomApiTokenStatus,
} from "../api/client";
import {
  useHarnessStatus,
  useMintBrowserToken,
  useProfiles,
  useRepositories,
  useRunHarnessSetupSmoke,
} from "../api/hooks";
import { browserTokenCreateHint } from "../components/ConnectGreenroom";
import { ApiErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";
import { RepositoryRegistryPanel } from "../components/RepositoryRegistryPanel";
import {
  classifySetupTokenFailure,
  deriveSetupWizardStepStatuses,
  nextSetupWizardStep,
  previousSetupWizardStep,
  setupWizardStepOrder,
  setupWizardStepTitles,
  summarizeDetectedHarnesses,
  writeSetupWizardCompletionState,
  type SetupWizardStepId,
  type SetupWizardStepStatus,
} from "./setupWizardUtils";

const installPiCommand = "greenroom harness install-pi";

export function SetupWizardPage() {
  const navigate = useNavigate();
  const [tokenStatus, setTokenStatus] = useState<GreenroomApiTokenStatus>(() =>
    readGreenroomApiTokenStatus(),
  );
  const [activeStep, setActiveStep] = useState<SetupWizardStepId>("token");
  const hasToken = tokenStatus.source !== "missing";
  const repositories = useRepositories(hasToken);
  const profiles = useProfiles(hasToken);
  const harnessStatus = useHarnessStatus(hasToken);
  const harnessSummary = summarizeDetectedHarnesses(harnessStatus.data?.detectedHarnesses);
  const repositoryCount = repositories.data?.length ?? null;

  const stepStatuses = deriveSetupWizardStepStatuses({
    tokenSource: tokenStatus.source,
    repositoryCount,
    harnessProbeKnown: harnessStatus.data !== undefined,
    anyHarnessFound: harnessSummary.anyFound,
    profileCount: profiles.data?.length ?? null,
  });

  // Registering a repository succeeds inside the embedded panel; advance the
  // wizard when the count grows while the repository step is active.
  const previousRepositoryCount = useRef(repositoryCount);
  useEffect(() => {
    const previous = previousRepositoryCount.current;
    previousRepositoryCount.current = repositoryCount;

    if (
      activeStep === "repository" &&
      previous !== null &&
      repositoryCount !== null &&
      repositoryCount > previous
    ) {
      setActiveStep("harness");
    }
  }, [activeStep, repositoryCount]);

  function goToNextStep() {
    const next = nextSetupWizardStep(activeStep);

    if (next !== null) {
      setActiveStep(next);
    }
  }

  function goToPreviousStep() {
    const previous = previousSetupWizardStep(activeStep);

    if (previous !== null) {
      setActiveStep(previous);
    }
  }

  function handleTokenStored() {
    setTokenStatus(readGreenroomApiTokenStatus());
    setActiveStep("repository");
  }

  function finishWizard(state: "completed" | "skipped", to: "/" | "/reviews/new") {
    writeSetupWizardCompletionState(state);
    void navigate({ to });
  }

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Set up Greenroom</h1>
          <p className="mt-1 text-sm text-muted">
            Walks token, repository, harness, profiles, and first-review setup. Every step is
            optional; you can re-run this wizard from Settings at any time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => finishWizard("skipped", "/")}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
        >
          <X aria-hidden="true" className="size-4" />
          Skip setup
        </button>
      </div>

      <WizardStepper activeStep={activeStep} stepStatuses={stepStatuses} />

      {activeStep === "token" ? (
        <TokenStep
          tokenStatus={tokenStatus}
          onTokenStored={handleTokenStored}
          onContinue={goToNextStep}
        />
      ) : null}

      {activeStep === "repository" ? (
        <WizardStepCard
          title="Register a repository"
          description="Point Greenroom at a local Git worktree. Existing repositories count as done."
        >
          {hasToken ? (
            <RepositoryRegistryPanel />
          ) : (
            <EmptyState
              title="Token required"
              body="Complete or skip the token step first; repository registration needs an API token."
            />
          )}
          <WizardStepFooter
            onBack={goToPreviousStep}
            onContinue={goToNextStep}
            continueLabel={stepStatuses.repository === "done" ? "Continue" : "Skip step"}
          />
        </WizardStepCard>
      ) : null}

      {activeStep === "harness" ? (
        <HarnessStep
          enabled={hasToken}
          error={harnessStatus.error}
          isLoading={harnessStatus.isLoading}
          isRefetching={harnessStatus.isRefetching}
          onBack={goToPreviousStep}
          onContinue={goToNextStep}
          onRecheck={() => void harnessStatus.refetch()}
          status={harnessStatus.data ?? null}
          summary={harnessSummary}
        />
      ) : null}

      {activeStep === "profiles" ? (
        <WizardStepCard
          title="Seeded profiles"
          description="Profiles were seeded from the harnesses detected on this machine (or a mock profile with an explanation when none were found). Edit them later in Settings."
        >
          {!hasToken ? (
            <EmptyState title="Token required" body="Complete or skip the token step first." />
          ) : profiles.isLoading ? (
            <LoadingBlock label="Loading profiles" />
          ) : profiles.error !== null ? (
            <ApiErrorBanner error={profiles.error} />
          ) : profiles.data === undefined || profiles.data.length === 0 ? (
            <EmptyState
              title="No profiles yet"
              body="Profiles are seeded on first server start; you can create them in Settings."
            />
          ) : (
            <ul className="grid gap-3">
              {profiles.data.map((profile) => (
                <li key={profile.id} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Brain aria-hidden="true" className="size-4 shrink-0 text-accent-ink" />
                    <p className="min-w-0 break-words text-sm font-semibold">{profile.name}</p>
                    <span className="min-w-0 max-w-full [overflow-wrap:anywhere] rounded-md border border-line bg-muted-surface px-2 py-0.5 text-xs text-muted">
                      {profile.provider} / {profile.model}
                    </span>
                  </div>
                  {profile.description !== null && profile.description.length > 0 ? (
                    <p className="mt-2 break-words text-sm text-muted">{profile.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Link
              to="/settings"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
            >
              <Settings aria-hidden="true" className="size-4" />
              Edit profiles in Settings
            </Link>
          </div>
          <WizardStepFooter onBack={goToPreviousStep} onContinue={goToNextStep} />
        </WizardStepCard>
      ) : null}

      {activeStep === "review" ? (
        <WizardStepCard
          title="Create your first review"
          description="Reviews compare a base and head ref of a registered repository. The creation page previews the diff before anything is stored."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => finishWizard("completed", "/reviews/new")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-4 text-sm font-medium text-surface"
            >
              <Plus aria-hidden="true" className="size-4" />
              Create first review
            </button>
            <button
              type="button"
              onClick={() => finishWizard("completed", "/")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-muted-surface"
            >
              <LayoutDashboard aria-hidden="true" className="size-4" />
              Finish and open dashboard
            </button>
          </div>
          <WizardStepFooter onBack={goToPreviousStep} />
        </WizardStepCard>
      ) : null}
    </section>
  );
}

function WizardStepper({
  activeStep,
  stepStatuses,
}: {
  activeStep: SetupWizardStepId;
  stepStatuses: Record<SetupWizardStepId, SetupWizardStepStatus>;
}) {
  return (
    <ol aria-label="Setup steps" className="flex flex-wrap gap-2">
      {setupWizardStepOrder.map((stepId, index) => {
        const isActive = stepId === activeStep;
        const isDone = stepStatuses[stepId] === "done";

        return (
          <li
            key={stepId}
            aria-current={isActive ? "step" : undefined}
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${
              isActive ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink"
            }`}
          >
            <span
              className={`inline-flex size-5 items-center justify-center rounded-full text-xs ${
                isDone
                  ? "bg-success-soft text-success-ink"
                  : isActive
                    ? "bg-surface text-ink"
                    : "bg-muted-surface text-muted"
              }`}
            >
              {isDone ? <Check aria-hidden="true" className="size-3" /> : index + 1}
            </span>
            <span>{setupWizardStepTitles[stepId]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function WizardStepCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function WizardStepFooter({
  onBack,
  onContinue,
  continueLabel = "Continue",
}: {
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
      {onBack === undefined ? (
        <span />
      ) : (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back
        </button>
      )}
      {onContinue === undefined ? null : (
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface"
        >
          {continueLabel}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

function TokenStep({
  tokenStatus,
  onTokenStored,
  onContinue,
}: {
  tokenStatus: GreenroomApiTokenStatus;
  onTokenStored: () => void;
  onContinue: () => void;
}) {
  // Shared minting path with Settings and the central 401 connect prompt
  // Mints "Browser"/admin, stores the token, and refetches queries.
  const createSetupToken = useMintBrowserToken();
  const [manualToken, setManualToken] = useState("");
  const hasToken = tokenStatus.source !== "missing";
  const failureStatus =
    createSetupToken.error instanceof GreenroomApiError ? createSetupToken.error.status : null;
  const failureKind =
    createSetupToken.error === null ? null : classifySetupTokenFailure(failureStatus);

  async function handleCreateToken() {
    try {
      await createSetupToken.mutateAsync();
      onTokenStored();
    } catch {
      // The mutation error is rendered below with paste-a-token guidance.
    }
  }

  function handleStoreManualToken() {
    storeGreenroomApiToken(manualToken);
    setManualToken("");
    onTokenStored();
  }

  return (
    <WizardStepCard
      title="Create a local API token"
      description="The browser stores its own capability token in localStorage and sends it with every API request."
    >
      {hasToken ? (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success-ink">
          <KeyRound aria-hidden="true" className="size-4 shrink-0" />
          <p>Token configured (source: {tokenStatus.source}). You can continue to the next step.</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void handleCreateToken()}
            disabled={createSetupToken.isPending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-4 text-sm font-medium text-surface disabled:opacity-50"
          >
            {createSetupToken.isPending ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Plus aria-hidden="true" className="size-4" />
            )}
            Create token
          </button>

          {failureKind === null ? null : failureKind === "other" ? (
            <ApiErrorBanner error={createSetupToken.error} />
          ) : (
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning-ink">
              <p>
                {failureKind === "non_loopback"
                  ? "The API refused to mint a token for this browser (it is not bound to loopback, or this client is not connecting from loopback)."
                  : "This Greenroom server only mints the first token unauthenticated, and one already exists."}{" "}
                Mint a token on the machine running Greenroom and paste it below:
              </p>
              <CopyableCommand command={browserTokenCreateHint} />
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Paste token"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleStoreManualToken}
              disabled={manualToken.trim().length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface disabled:opacity-50"
            >
              <Check aria-hidden="true" className="size-4" />
              Use token
            </button>
          </div>
        </>
      )}
      <WizardStepFooter
        onContinue={onContinue}
        continueLabel={hasToken ? "Continue" : "Skip step"}
      />
    </WizardStepCard>
  );
}

function HarnessStep({
  enabled,
  error,
  isLoading,
  isRefetching,
  onBack,
  onContinue,
  onRecheck,
  status,
  summary,
}: {
  enabled: boolean;
  error: unknown;
  isLoading: boolean;
  isRefetching: boolean;
  onBack: () => void;
  onContinue: () => void;
  onRecheck: () => void;
  status: { configured: boolean; healthy: boolean } | null;
  summary: ReturnType<typeof summarizeDetectedHarnesses>;
}) {
  const smoke = useRunHarnessSetupSmoke();

  return (
    <WizardStepCard
      title="Detect coding harnesses"
      description="Greenroom drives locally installed agent CLIs (claude-code, codex, ...) through the harness bridge."
    >
      {!enabled ? (
        <EmptyState title="Token required" body="Complete or skip the token step first." />
      ) : isLoading ? (
        <LoadingBlock label="Probing harnesses" />
      ) : error !== null ? (
        <ApiErrorBanner error={error} />
      ) : (
        <>
          {status !== null && (!status.configured || !status.healthy) ? (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
              The harness bridge is{" "}
              {status.configured ? "configured but not healthy" : "not configured"}; detection
              results may be stale or empty. Re-check once the bridge is running.
            </div>
          ) : null}

          {summary.probed ? (
            <ul className="grid gap-3">
              {[...summary.found, ...summary.missing].map((harness) => (
                <DetectedHarnessRow
                  key={harness.kind}
                  harness={harness}
                  isSmokePending={smoke.isPending && smoke.variables === harness.kind}
                  onRunSmoke={() => smoke.mutate(harness.kind)}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No detection results"
              body="The bridge reported no harness probes."
            />
          )}

          {smoke.error !== null ? <ApiErrorBanner error={smoke.error} /> : null}
          {smoke.data === undefined ? null : (
            <div className="min-w-0 break-words rounded-lg bg-muted-surface px-4 py-3 text-sm">
              <p className="min-w-0">
                <span className="font-medium">Smoke check ({smoke.data.harnessKind}):</span>{" "}
                {smoke.data.status} — {smoke.data.message}
              </p>
              <p className="mt-1 text-xs text-muted">
                This check is informational and non-blocking; setup continues regardless of its
                result.
              </p>
            </div>
          )}

          {summary.anyFound ? null : (
            <div className="rounded-lg border border-line bg-muted-surface p-4">
              <p className="text-sm font-medium">No harness CLI detected</p>
              <p className="mt-1 text-sm text-muted">
                API-key users can install the managed Pi fallback from a terminal on this machine,
                then re-check:
              </p>
              <CopyableCommand command={installPiCommand} />
            </div>
          )}

          <button
            type="button"
            onClick={onRecheck}
            disabled={isRefetching}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${isRefetching ? "animate-spin" : ""}`}
            />
            Re-check
          </button>
        </>
      )}
      <WizardStepFooter onBack={onBack} onContinue={onContinue} />
    </WizardStepCard>
  );
}

function DetectedHarnessRow({
  harness,
  isSmokePending,
  onRunSmoke,
}: {
  harness: HarnessDetectedCli;
  isSmokePending: boolean;
  onRunSmoke: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal aria-hidden="true" className="size-4 text-accent-ink" />
            <p className="text-sm font-semibold">{harness.label}</p>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                harness.found ? "bg-success-soft text-success-ink" : "bg-muted-surface text-muted"
              }`}
            >
              {harness.found ? "Found" : "Not found"}
            </span>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-muted">
            {harness.path ?? harness.message ?? harness.command}
          </p>
          {harness.version === null ? null : (
            <p className="mt-1 break-words text-xs text-muted">{harness.version}</p>
          )}
        </div>
        {harness.found ? (
          <button
            type="button"
            onClick={onRunSmoke}
            disabled={isSmokePending}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface disabled:opacity-50"
          >
            {isSmokePending ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Play aria-hidden="true" className="size-4" />
            )}
            Run smoke check
          </button>
        ) : null}
      </div>
      {harness.found && harness.recommendSmoke ? (
        <p className="mt-2 text-xs text-muted">
          A smoke check is recommended for this harness (new or changed version).
        </p>
      ) : null}
    </li>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be denied; the command is still selectable.
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-3 py-2 font-mono text-xs text-ink">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
      >
        <Clipboard aria-hidden="true" className="size-4" />
        {copied ? "Copied" : "Copy command"}
      </button>
    </div>
  );
}
