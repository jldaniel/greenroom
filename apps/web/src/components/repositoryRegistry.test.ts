import { describe, expect, it } from "vitest";

import { GreenroomApiError, type ReviewPreviewResponse } from "../api/client";
import { deriveQuickReviewNoChanges, describeQuickReviewError } from "./repositoryRegistryUtils";

type PreviewSubset = Pick<ReviewPreviewResponse, "files" | "baseRefDisplay">;

function previewWith(files: number): PreviewSubset {
  return {
    baseRefDisplay: "merge-base(origin/main, HEAD)",
    files: Array.from({ length: files }, () => ({}) as PreviewSubset["files"][number]),
  };
}

describe("deriveQuickReviewNoChanges", () => {
  it("stops the one-click flow when the worktree diff is empty", () => {
    const notice = deriveQuickReviewNoChanges(previewWith(0));

    expect(notice).toMatchObject({
      kind: "no_changes",
      message: expect.stringContaining("No changes to review"),
    });
    expect(notice).toMatchObject({
      message: expect.stringContaining("merge-base(origin/main, HEAD)"),
    });
  });

  it("lets the flow proceed when files changed", () => {
    expect(deriveQuickReviewNoChanges(previewWith(1))).toBeNull();
  });
});

describe("describeQuickReviewError", () => {
  it("defers 401s to the central connect prompt", () => {
    const error = new GreenroomApiError(401, "Unauthorized", {
      code: "unauthorized",
      message: "Unauthorized",
    });

    expect(describeQuickReviewError(error)).toEqual({ kind: "auth" });
  });

  it("explains an unreachable API", () => {
    const error = new GreenroomApiError(0, "Failed to fetch", null);
    const notice = describeQuickReviewError(error);

    expect(notice.kind).toBe("failure");
    expect(notice).toMatchObject({ message: expect.stringContaining("unreachable") });
  });

  it("explains a missing token scope", () => {
    const error = new GreenroomApiError(403, "Forbidden", {
      code: "forbidden",
      message: "Missing scope review:write",
    });

    expect(describeQuickReviewError(error)).toMatchObject({
      kind: "failure",
      message: expect.stringContaining("scope"),
    });
  });

  it("explains an unreachable repository path", () => {
    const error = new GreenroomApiError(404, "Repository path does not exist", {
      code: "not_found",
      message: "Repository path does not exist",
      details: { gitErrorCode: "path_not_found", path: "/gone" },
    });

    expect(describeQuickReviewError(error)).toMatchObject({
      kind: "failure",
      message: expect.stringContaining("repository path is unreachable"),
    });
  });

  it("explains a repository that no longer exists", () => {
    const error = new GreenroomApiError(404, "Repository not found", {
      code: "not_found",
      message: "Repository not found",
    });

    expect(describeQuickReviewError(error)).toMatchObject({
      kind: "failure",
      message: expect.stringContaining("not found"),
    });
  });

  it("points base-detection conflicts at the creation page", () => {
    const error = new GreenroomApiError(409, "No merge base", {
      code: "conflict",
      message: "No merge base",
      details: { gitErrorCode: "merge_base_not_found" },
    });

    expect(describeQuickReviewError(error)).toMatchObject({
      kind: "failure",
      message: expect.stringContaining("Create Review"),
    });
  });

  it("falls back to the underlying message for other errors", () => {
    expect(describeQuickReviewError(new Error("boom"))).toEqual({
      kind: "failure",
      message: "Could not create the review: boom",
    });
    expect(describeQuickReviewError("nope")).toEqual({
      kind: "failure",
      message: "Could not create the review: unexpected error",
    });
  });
});
