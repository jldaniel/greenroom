import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory } from "@greenroom/core";
import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import type { DiffFile, DiffLine, ThreadAnchor } from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices, refreshReview } from "./services";

const fixedNow = "2026-07-09T12:00:00.000Z";
const storages: TestStorage[] = [];
const repositories: TestGitRepository[] = [];

function deterministicIds(): IdFactory {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

async function createFixture() {
  const storage = createTestStorage();
  storages.push(storage);
  const repository = await createTempGitRepository();
  repositories.push(repository);

  repository.writeFile("README.md", "# Fixture\n");
  await repository.stage();
  await repository.commit("Initial commit");
  await repository.checkout("feature/refresh", { create: true });
  repository.writeFile("src/index.ts", "export function answer() {\n  return 42;\n}\n");
  await repository.stage();
  await repository.commit("Add answer");

  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
  });
  const app = createGreenroomApp({ services });
  const admin = services.tokens.create({ name: "Refresh admin", scopes: ["admin"] });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${admin.plaintextToken}`);
    return app.request(path, { ...init, headers });
  };

  const repositoryResponse = await request("/api/repositories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: repository.directory }),
  });
  expect(repositoryResponse.status).toBe(201);

  const reviewResponse = await request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repositoryId: "repo_1", title: "Atomic refresh" }),
  });
  expect(reviewResponse.status).toBe(201);

  return { storage, repository, services, request };
}

function firstAdditionAnchor(files: readonly DiffFile[]): ThreadAnchor {
  for (const file of files) {
    for (const hunk of file.hunks) {
      const line = hunk.lines.find(
        (candidate): candidate is DiffLine & { type: "addition"; newLineNumber: number } =>
          candidate.type === "addition" && candidate.newLineNumber !== null,
      );

      if (line !== undefined) {
        return {
          reviewDisplayId: "GR-1",
          revisionId: "revision_1",
          filePath: file.path,
          oldFilePath: file.oldPath,
          side: "head",
          lineNumber: line.newLineNumber,
          lineType: line.type,
          hunkId: hunk.id,
          hunkHeader: hunk.header,
          contextBefore: [],
          contextAfter: [],
          originalLineText: line.content,
        };
      }
    }
  }

  throw new Error("Fixture diff did not include an addition");
}

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }

  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }
});

describe("review refresh transactions", () => {
  it("serializes concurrent refresh requests and reuses the single new revision", async () => {
    const fixture = await createFixture();
    fixture.repository.writeFile(
      "src/index.ts",
      "export function answer() {\n  const value = 42;\n  return value;\n}\n",
    );

    const responses = await Promise.all([
      fixture.request("/api/reviews/GR-1/refresh", { method: "POST" }),
      fixture.request("/api/reviews/GR-1/refresh", { method: "POST" }),
    ]);
    const payloads = await Promise.all(
      responses.map(
        (response) => response.json() as Promise<{ revision: { id: string }; reused: boolean }>,
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(payloads.map((payload) => payload.revision.id)).toEqual(["revision_2", "revision_2"]);
    expect(payloads.map((payload) => payload.reused).sort()).toEqual([false, true]);
    expect(
      fixture.services.reviews
        .listRevisions("review_1")
        .map((revision) => revision.id)
        .sort(),
    ).toEqual(["revision_1", "revision_2"]);
    expect(fixture.services.reviews.get("review_1")?.currentRevisionId).toBe("revision_2");
  });

  it("rolls back the revision, pointer, thread remap, and Spotlight remap together", async () => {
    const fixture = await createFixture();
    const anchor = firstAdditionAnchor(fixture.services.reviews.listDiffFiles("revision_1"));
    const thread = fixture.services.threads.create({
      reviewDisplayId: "GR-1",
      type: "question",
      source: { kind: "human", displayName: "Reviewer" },
      anchor,
      firstComment: {
        authorKind: "human",
        authorDisplayName: "Reviewer",
        body: "Keep tracking this line.",
      },
    });
    const spotlightProfile = fixture.services.profiles
      .list()
      .find((profile) => profile.workflowType === "spotlight");

    if (spotlightProfile === undefined) {
      throw new Error("Expected the default Spotlight profile");
    }

    const run = fixture.services.spotlight.createRun({
      reviewDisplayId: "GR-1",
      type: "generate",
      trigger: "manual",
      gated: false,
      status: "completed",
      revisionId: "revision_1",
      profileId: spotlightProfile.id,
    });
    const view = fixture.services.spotlight.createView({
      reviewDisplayId: "GR-1",
      title: "Answer flow",
      description: "The changed answer implementation.",
      intent: "feature",
      orderIndex: 0,
      originRunId: run.id,
      lastReconciledRevisionId: "revision_1",
    });
    fixture.services.spotlight.replaceRegions(view.displayRef, [
      {
        filePath: anchor.filePath,
        oldPath: anchor.oldFilePath,
        anchors: [anchor],
        remapConfidence: null,
        stale: false,
      },
    ]);
    fixture.storage.database.sqlite.exec(`
      CREATE TRIGGER fail_refresh_spotlight
      BEFORE UPDATE OF last_reconciled_revision_id ON spotlight_views
      WHEN NEW.last_reconciled_revision_id <> OLD.last_reconciled_revision_id
      BEGIN
        SELECT RAISE(ABORT, 'forced refresh failure');
      END;
    `);
    fixture.repository.writeFile(
      "src/index.ts",
      "export function answer() {\n  const value = 42;\n  return value;\n}\n",
    );

    await expect(refreshReview(fixture.services, "GR-1")).rejects.toThrow("forced refresh failure");

    expect(
      fixture.services.reviews.listRevisions("review_1").map((revision) => revision.id),
    ).toEqual(["revision_1"]);
    expect(fixture.services.reviews.get("review_1")?.currentRevisionId).toBe("revision_1");
    expect(fixture.services.reviews.getRevision("revision_2")).toBeNull();
    expect(fixture.services.threads.getByRef(thread.shortRef)?.anchor.revisionId).toBe(
      "revision_1",
    );

    const persistedView = fixture.services.spotlight.getViewWithRegionsByRef(view.displayRef);
    expect(persistedView?.lastReconciledRevisionId).toBe("revision_1");
    expect(persistedView?.regions[0]?.anchors[0]?.revisionId).toBe("revision_1");
  });
});
