import type { HarnessStatusResponse, ProviderKind } from "@greenroom/schemas";

/**
 * Point-of-use readiness for a run CTA backed by an AI profile,
 * derived from `GET /api/harness/status`: is the bridge reachable, and did it
 * detect a coding agent CLI? Mock (and custom) profiles never block — they
 * run without the bridge.
 */
export interface AiRunReadiness {
  /** True when the profile's backing runtime is known to be unable to run. */
  blocked: boolean;
  /** Human-readable reason shown inline next to the run CTA when blocked. */
  reason: string | null;
  /** Short positive detail when the harness path is known to be ready. */
  detail: string | null;
  /** Whether the fix-it link to Settings > Connections applies. */
  showConnectionsLink: boolean;
}

const readyReadiness: AiRunReadiness = {
  blocked: false,
  reason: null,
  detail: null,
  showConnectionsLink: false,
};

export function deriveAiRunReadiness({
  provider,
  status,
}: {
  provider: ProviderKind | null;
  status: HarnessStatusResponse | null | undefined;
}): AiRunReadiness {
  if (provider === null || provider === "custom") {
    return readyReadiness;
  }

  if (provider === "mock") {
    return {
      ...readyReadiness,
      detail: "Mock profile — runs locally without the harness bridge.",
    };
  }

  // Harness-backed profile. When the status is still loading (or the status
  // endpoint itself failed, in which case every request fails and the error
  // banner already explains it), fail open rather than blocking on a guess.
  if (status === undefined || status === null) {
    return readyReadiness;
  }

  if (!status.configured) {
    return {
      blocked: true,
      reason: "The harness bridge is not configured, so harness-backed runs cannot start.",
      detail: null,
      showConnectionsLink: true,
    };
  }

  if (!status.healthy) {
    return {
      blocked: true,
      reason: "The harness bridge is unreachable, so harness-backed runs cannot start.",
      detail: null,
      showConnectionsLink: true,
    };
  }

  const detected = status.detectedHarnesses.filter((harness) => harness.found);

  if (status.detectedHarnesses.length > 0 && detected.length === 0) {
    return {
      blocked: true,
      reason: "No coding agent CLI (e.g. Claude Code, Codex) was detected on this machine.",
      detail: null,
      showConnectionsLink: true,
    };
  }

  // Older bridges without detection data report availableKinds only.
  if (status.detectedHarnesses.length === 0 && status.availableKinds.length === 0) {
    return {
      blocked: true,
      reason: "The harness bridge reports no available coding agents.",
      detail: null,
      showConnectionsLink: true,
    };
  }

  const names = detected
    .map((harness) =>
      harness.version === null ? harness.label : `${harness.label} ${harness.version}`,
    )
    .join(", ");

  return {
    ...readyReadiness,
    detail: names.length > 0 ? `Bridge connected — ${names}` : "Bridge connected",
  };
}
