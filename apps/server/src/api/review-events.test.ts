import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import type { WorkflowRun } from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import type { ReviewCreatedEvent } from "./events";
import {
  createCommittedReview,
  createGreenroomApiServices,
  createWorkflowRunForReview,
} from "./services";

const fixedNow = "2026-06-25T12:00:00.000Z";

const storages: TestStorage[] = [];
const repositories: TestGitRepository[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }

  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }
});

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

async function createFixture() {
  const storage = createTestStorage({
    clock: () => fixedNow,
    idFactory: deterministicIds(),
    defaultAiBackend: "mock",
  });
  storages.push(storage);
  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
    autoResumeQueuedWorkflowRuns: false,
  });
  const app = createGreenroomApp({ services });
  const admin = services.tokens.create({ name: "Review events admin", scopes: ["admin"] });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${admin.plaintextToken}`);
    return app.request(path, { ...init, headers });
  };

  const gitRepository = await createTempGitRepository();
  repositories.push(gitRepository);
  gitRepository.writeFile("README.md", "# Fixture\n");
  await gitRepository.stage();
  await gitRepository.commit("Initial commit");
  await gitRepository.checkout("feature/review", { create: true });
  gitRepository.writeFile("src/index.ts", "export function answer() {\n  return 42;\n}\n");
  await gitRepository.stage();
  await gitRepository.commit("Add feature implementation");

  await request("/api/repositories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: gitRepository.directory }),
  });

  const createReview = () =>
    request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Feature review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });

  return { services, request, admin, createReview };
}

describe("review.created internal event", () => {
  it("emits review.created with review, repository, revision, and creator context", async () => {
    const { services, admin, createReview } = await createFixture();
    const received: ReviewCreatedEvent[] = [];
    services.events.on("review.created", (event) => {
      received.push(event);
    });

    const response = await createReview();
    const payload = (await response.json()) as {
      review: { displayId: string };
      revision: { id: string };
    };

    expect(response.status).toBe(201);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      review: {
        displayId: payload.review.displayId,
        title: "Feature review",
        repositoryId: "repo_1",
      },
      repository: { id: "repo_1" },
      revision: { id: payload.revision.id, reviewDisplayId: payload.review.displayId },
      createdBy: { kind: "api_token", tokenId: admin.token.id, tokenName: "Review events admin" },
      createdAt: fixedNow,
    });
  });

  it("marks direct service-layer review creation with the internal actor", async () => {
    const { services } = await createFixture();
    const received: ReviewCreatedEvent[] = [];
    services.events.on("review.created", (event) => {
      received.push(event);
    });

    const created = await createCommittedReview(services, {
      repositoryId: "repo_1",
      baseRef: "main",
      headRef: "feature/review",
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      review: { displayId: created.review.displayId },
      createdBy: { kind: "internal", tokenId: null, tokenName: null },
    });
  });

  it("lets a subscriber enqueue a builtin-review run that still requires consent", async () => {
    const { services, createReview } = await createFixture();
    const profile = services.profiles.create({
      name: "Auto review harness",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      modelSettings: { harness: { kind: "claude-code" } },
      allowedTools: [],
      contextPreferences: {},
      privacy: { persistTranscript: false },
    });
    const enqueued: WorkflowRun[] = [];
    services.events.on("review.created", (event) => {
      enqueued.push(
        createWorkflowRunForReview(services, {
          reviewDisplayId: event.review.displayId,
          workflowKind: "builtin_review",
          profileId: profile.id,
          revisionId: event.revision.id,
        }),
      );
    });

    const response = await createReview();
    const payload = (await response.json()) as {
      review: { displayId: string };
      revision: { id: string };
    };
    const storedReview = services.reviews.getByDisplayId(payload.review.displayId);

    if (storedReview === null) {
      throw new Error("Created review was not found by display id");
    }

    const runs = services.workflowRunner.listRunsByReview(storedReview.id);

    expect(response.status).toBe(201);
    expect(enqueued).toHaveLength(1);
    expect(runs).toHaveLength(1);
    // Auto-enqueued runs use the normal run-creation path: they land in
    // pending_consent and stay inert until explicitly approved, so the hook
    // never bypasses consent (two-step semantics by default).
    expect(runs[0]).toMatchObject({
      workflowKind: "builtin_review",
      reviewDisplayId: payload.review.displayId,
      revisionId: payload.revision.id,
      profileId: profile.id,
      status: "pending_consent",
      consentSummary: expect.objectContaining({ workflowKind: "builtin_review" }),
    });
  });

  it("has no side effects when no subscriber is registered", async () => {
    const { services, createReview } = await createFixture();

    const response = await createReview();
    const payload = (await response.json()) as { review: { displayId: string } };
    const storedReview = services.reviews.getByDisplayId(payload.review.displayId);

    if (storedReview === null) {
      throw new Error("Created review was not found by display id");
    }

    expect(response.status).toBe(201);
    expect(services.events.listenerCount("review.created")).toBe(0);
    expect(services.workflowRunner.listRunsByReview(storedReview.id)).toHaveLength(0);
  });

  it("isolates listener failures from review creation and supports unsubscribe", async () => {
    const { services, createReview } = await createFixture();
    let calls = 0;
    services.events.on("review.created", () => {
      throw new Error("listener exploded");
    });
    const unsubscribe = services.events.on("review.created", () => {
      calls += 1;
    });

    const first = await createReview();
    unsubscribe();
    const second = await createReview();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(calls).toBe(1);
    expect(services.events.listenerCount("review.created")).toBe(1);
  });
});
