/**
 * Settings is split into four deep-linkable sections. The active
 * section rides in the `?section=` search param so links like
 * `/settings?section=connections` land on the right tab; unknown or missing
 * values fall back to General.
 */

export const settingsSections = ["general", "connections", "profiles", "tokens"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const settingsSectionLabels: Record<SettingsSection, string> = {
  general: "General",
  connections: "Connections",
  profiles: "AI Profiles",
  tokens: "Tokens",
};

export function parseSettingsSection(value: unknown): SettingsSection | undefined {
  return typeof value === "string" && (settingsSections as readonly string[]).includes(value)
    ? (value as SettingsSection)
    : undefined;
}

export const defaultSettingsSection: SettingsSection = "general";
