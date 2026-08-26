import { useCallback, useState } from "react";

import type { ProfileConsentMode } from "@greenroom/schemas";

import type { PendingRunConfirmation, SpotlightRunKind } from "./workspaceTypes";

export interface RunConfirmationFlow {
  cancelPending: () => void;
  confirmPending: () => Promise<void>;
  pending: PendingRunConfirmation | null;
  requestAiReviewRun: () => void;
  requestFingerprintRecovery: () => void;
  requestSpotlightRun: (type: SpotlightRunKind) => void;
  trustedRunNotice: string | null;
}

/**
 * Consent-mode dispatch for every workspace run CTA:
 * one-click profiles get the shared RunConsentDialog confirmation, trusted
 * profiles start immediately with a status notice, and two-step profiles land
 * in the pending-consent state rendered by the shared ConsentCard.
 */
export function useRunConfirmationFlow({
  aiConsentMode,
  createAiConsent,
  recoverAiFingerprint,
  spotlightConsentMode,
  startSpotlightRun,
}: {
  aiConsentMode: ProfileConsentMode;
  createAiConsent: (start: boolean) => Promise<void>;
  recoverAiFingerprint: () => Promise<void>;
  spotlightConsentMode: ProfileConsentMode;
  startSpotlightRun: (type: SpotlightRunKind, start: boolean) => Promise<void>;
}): RunConfirmationFlow {
  const [pending, setPending] = useState<PendingRunConfirmation | null>(null);
  const [trustedRunNotice, setTrustedRunNotice] = useState<string | null>(null);

  const requestAiReviewRun = useCallback(() => {
    // Trusted profiles skip the confirmation dialog entirely; a lightweight
    // status notice replaces it so the immediate start is not silent.
    if (aiConsentMode === "trusted") {
      setTrustedRunNotice("Trusted profile: AI review run started without confirmation.");
      void createAiConsent(true);
      return;
    }

    if (aiConsentMode === "one_click") {
      setPending({ kind: "ai_review" });
      return;
    }

    void createAiConsent(false);
  }, [aiConsentMode, createAiConsent]);

  const requestFingerprintRecovery = useCallback(() => {
    if (aiConsentMode === "trusted") {
      setTrustedRunNotice(
        "Trusted profile: review refreshed and AI review run restarted without confirmation.",
      );
      void recoverAiFingerprint();
      return;
    }

    if (aiConsentMode === "one_click") {
      // The confirmation dialog shows the new scope; confirming is the
      // consent for the refreshed revision.
      setPending({ kind: "fingerprint_recovery" });
      return;
    }

    // Two-step profiles land in the normal pending-consent state.
    void recoverAiFingerprint();
  }, [aiConsentMode, recoverAiFingerprint]);

  const requestSpotlightRun = useCallback(
    (type: SpotlightRunKind) => {
      if (spotlightConsentMode === "one_click") {
        setPending({ kind: "spotlight", type });
        return;
      }

      // Regeneration replaces existing Views, so its destructive-action
      // confirm stays even for trusted profiles; consent itself is skipped.
      if (
        type === "regenerate" &&
        !window.confirm(
          "Regenerate fresh Spotlight views? Existing Views and regions will be replaced.",
        )
      ) {
        return;
      }

      if (spotlightConsentMode === "trusted") {
        setTrustedRunNotice("Trusted profile: Spotlight run started without confirmation.");
        void startSpotlightRun(type, true);
        return;
      }

      void startSpotlightRun(type, false);
    },
    [spotlightConsentMode, startSpotlightRun],
  );

  const confirmPending = useCallback(async () => {
    if (pending === null) {
      return;
    }

    try {
      if (pending.kind === "ai_review") {
        await createAiConsent(true);
      } else if (pending.kind === "fingerprint_recovery") {
        await recoverAiFingerprint();
      } else {
        await startSpotlightRun(pending.type, true);
      }
    } finally {
      setPending(null);
    }
  }, [createAiConsent, pending, recoverAiFingerprint, startSpotlightRun]);

  return {
    cancelPending: useCallback(() => setPending(null), []),
    confirmPending,
    pending,
    requestAiReviewRun,
    requestFingerprintRecovery,
    requestSpotlightRun,
    trustedRunNotice,
  };
}
