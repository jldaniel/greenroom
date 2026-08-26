import { describe, expect, it } from "vitest";

import { parseSettingsSection, settingsSections } from "./settingsSectionUtils";

describe("parseSettingsSection", () => {
  it("accepts every known section", () => {
    for (const section of settingsSections) {
      expect(parseSettingsSection(section)).toBe(section);
    }
  });

  it("rejects unknown and non-string values", () => {
    expect(parseSettingsSection("nope")).toBeUndefined();
    expect(parseSettingsSection("")).toBeUndefined();
    expect(parseSettingsSection(undefined)).toBeUndefined();
    expect(parseSettingsSection(null)).toBeUndefined();
    expect(parseSettingsSection(3)).toBeUndefined();
    expect(parseSettingsSection(["general"])).toBeUndefined();
  });
});
