import { describe, expect, it } from "vitest";

import { docsUrl, untrackedFilesDocsPath } from "./docsLinks";

describe("docsLinks", () => {
  it("builds documentation URLs against the published repository", () => {
    expect(docsUrl("docs/CLI.md")).toBe(
      "https://github.com/jldaniel/greenroom/blob/main/docs/CLI.md",
    );
  });

  it("preserves anchors in documentation paths", () => {
    expect(docsUrl(untrackedFilesDocsPath)).toBe(
      "https://github.com/jldaniel/greenroom/blob/main/docs/Git.md#untracked-files",
    );
  });
});
