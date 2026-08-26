import { useState, type ReactNode } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { Brain, KeyRound, PlugZap, SlidersHorizontal } from "lucide-react";

import { readGreenroomApiTokenStatus, type GreenroomApiTokenStatus } from "../../api/client";
import { AiProfilesSettings } from "./AiProfilesSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { GeneralSettings } from "./GeneralSettings";
import {
  defaultSettingsSection,
  settingsSectionLabels,
  settingsSections,
  type SettingsSection,
} from "./settingsSectionUtils";
import { TokensSettings } from "./TokensSettings";

const sectionIcons: Record<SettingsSection, ReactNode> = {
  general: <SlidersHorizontal aria-hidden="true" className="size-4" />,
  connections: <PlugZap aria-hidden="true" className="size-4" />,
  profiles: <Brain aria-hidden="true" className="size-4" />,
  tokens: <KeyRound aria-hidden="true" className="size-4" />,
};

const sectionDescriptions: Record<SettingsSection, string> = {
  general: "Appearance, app status, server configuration, and transcripts",
  connections: "API token, harness bridge, and MCP clients",
  profiles: "AI profiles for teaching, review, and Spotlight runs",
  tokens: "Scoped capability tokens for external tools",
};

/**
 * Settings shell: four deep-linkable sections (General, Connections,
 * AI Profiles, Tokens) selected via `?section=`. Each section owns its
 * queries; the browser token status is shared so every section can disable
 * API-backed panels consistently.
 */
export function SettingsPage() {
  const search = useSearch({ from: "/settings" });
  const section = search.section ?? defaultSettingsSection;
  const [tokenStatus, setTokenStatus] = useState<GreenroomApiTokenStatus>(() =>
    readGreenroomApiTokenStatus(),
  );

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Settings</h1>
        <p className="mt-1 text-sm text-muted">{sectionDescriptions[section]}</p>
      </div>

      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-1 rounded-lg bg-muted-surface p-1"
      >
        {settingsSections.map((candidate) => (
          <Link
            key={candidate}
            to="/settings"
            search={{ section: candidate }}
            aria-current={candidate === section ? "page" : undefined}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
              candidate === section ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {sectionIcons[candidate]}
            <span>{settingsSectionLabels[candidate]}</span>
          </Link>
        ))}
      </nav>

      <SettingsSectionContent
        section={section}
        tokenStatus={tokenStatus}
        onTokenStatusChange={() => setTokenStatus(readGreenroomApiTokenStatus())}
      />
    </section>
  );
}

function SettingsSectionContent({
  section,
  tokenStatus,
  onTokenStatusChange,
}: {
  section: SettingsSection;
  tokenStatus: GreenroomApiTokenStatus;
  onTokenStatusChange: () => void;
}) {
  if (section === "connections") {
    return (
      <ConnectionsSettings tokenStatus={tokenStatus} onTokenStatusChange={onTokenStatusChange} />
    );
  }

  if (section === "profiles") {
    return <AiProfilesSettings tokenStatus={tokenStatus} />;
  }

  if (section === "tokens") {
    return <TokensSettings tokenStatus={tokenStatus} />;
  }

  return <GeneralSettings tokenStatus={tokenStatus} />;
}
