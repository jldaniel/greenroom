import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import type { StructuredTeachingOutput, ThreadAnchor } from "@greenroom/schemas";

import { createGreenroomApp } from "../apps/server/src/api/app";
import { createGreenroomApiServices } from "../apps/server/src/api/services";
import { openGreenroomDatabase } from "../apps/server/src/storage/database";

const fixedNow = "2026-07-02T12:00:00.000Z";

const repositories: TestGitRepository[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }
});

interface TeachingRunPayload {
  run: {
    id: string;
    reviewDisplayId: string;
    status: string;
    output: StructuredTeachingOutput | null;
  };
}

/**
 * Teaching runs, follow-up conversations, and promoted threads must
 * survive an API restart (`greenroom down` / `greenroom up`) because they are
 * durable workflow/thread records, not process state. This drives a
 * real service stack over one SQLite file, tears it down, reconstructs the
 * services over the SAME file, and asserts the durable surface the Teach page
 * rebuilds itself from after a reload.
 */
describe("teach promotion and restart persistence (V2-048)", () => {
  it("keeps the teaching run, follow-up events, and promoted threads durable across a service restart over the same database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "greenroom-teach-restart-"));
    const databasePath = join(directory, "greenroom.sqlite");
    // One deterministic factory shared by both stacks so post-restart writes
    // never collide with ids minted before the restart.
    const idFactory = deterministicIds();
    const clock = () => fixedNow;
    let firstDatabase: ReturnType<typeof openGreenroomDatabase> | null = null;
    let secondDatabase: ReturnType<typeof openGreenroomDatabase> | null = null;

    try {
      const repository = await createReviewRepository();

      // --- First stack: simulated `greenroom up` ---
      firstDatabase = openGreenroomDatabase({ databasePath });
      const firstServices = createGreenroomApiServices(firstDatabase, {
        domain: { clock, idFactory },
      });
      const adminToken = firstServices.tokens.create({
        name: "Teach restart admin",
        scopes: ["admin"],
      }).plaintextToken;
      const firstRequest = createAuthedRequester(
        createGreenroomApp({ services: firstServices }),
        adminToken,
      );

      const repositoryPayload = (await json(
        await firstRequest("/api/repositories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rootPath: repository.directory }),
        }),
      )) as { repository: { id: string } };
      const reviewPayload = (await json(
        await firstRequest("/api/reviews", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repositoryId: repositoryPayload.repository.id,
            title: "Restart teaching review",
            baseRef: "main",
            headRef: "feature/review",
          }),
        }),
      )) as { review: { displayId: string; currentRevisionId: string } };
      const reviewId = reviewPayload.review.displayId;
      const profilePayload = (await json(
        await firstRequest("/api/profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Restart teaching",
            workflowType: "teaching",
            provider: "mock",
            model: "mock-teacher",
          }),
        }),
      )) as { profile: { id: string } };

      const consentResponse = await firstRequest(`/api/reviews/${reviewId}/teaching/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId: profilePayload.profile.id,
          revisionId: reviewPayload.review.currentRevisionId,
        }),
      });
      const consentPayload = (await json(consentResponse)) as TeachingRunPayload;
      const runId = consentPayload.run.id;

      expect(consentResponse.status).toBe(201);
      // Teaching runs are durable workflow records, not teach_run_
      // process state: restart persistence hangs off this contract.
      expect(runId).toMatch(/^workflow_run_/u);

      const approvedPayload = (await json(
        await firstRequest(`/api/teaching/runs/${runId}/approve`, { method: "POST" }),
      )) as TeachingRunPayload;

      expect(approvedPayload.run.status).toBe("approved");

      const completedPayload = await waitForResult(
        async () =>
          (await json(await firstRequest(`/api/teaching/runs/${runId}`))) as TeachingRunPayload,
        (payload) => payload.run.status === "completed",
        "teaching run completion",
      );

      const output = completedPayload.run.output;
      const point = output?.walkthrough[0];

      if (output === null || point === undefined || point.anchor === null) {
        throw new Error("Mock teaching output did not include a promotable walkthrough point");
      }

      const question = "What should I re-read after the walkthrough?";
      const followUpPayload = (await json(
        await firstRequest(`/api/teaching/runs/${runId}/follow-up`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question }),
        }),
      )) as {
        followUp: { runId: string; followUpRunId: string; status: string; answer: string | null };
      };

      expect(followUpPayload.followUp).toMatchObject({
        runId,
        followUpRunId: expect.stringMatching(/^workflow_run_/u),
        status: "queued",
        answer: null,
      });

      await waitForResult(
        async () =>
          (await json(await firstRequest(`/api/workflow-runs/${runId}/events`))) as {
            events: Array<{ metadata: Record<string, unknown> }>;
          },
        (payload) =>
          payload.events.some(
            (event) =>
              event.metadata.followUpWorkflowRunId === followUpPayload.followUp.followUpRunId &&
              typeof event.metadata.answer === "string" &&
              event.metadata.answer.includes(question),
          ),
        "teaching follow-up answer event before restart",
      );

      const promoted = await firstRequest(`/api/reviews/${reviewId}/teaching/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          profileId: profilePayload.profile.id,
          title: point.title,
          body: point.body,
          anchor: point.anchor,
        }),
      });

      expect(promoted.status).toBe(201);
      expect(await json(promoted)).toMatchObject({
        thread: { shortRef: "GT-1", source: { kind: "teaching" } },
      });

      // --- Restart: close the database, reconstruct services over the SAME file ---
      firstDatabase.close();
      firstDatabase = null;

      secondDatabase = openGreenroomDatabase({ databasePath });
      const secondServices = createGreenroomApiServices(secondDatabase, {
        domain: { clock, idFactory },
      });
      const secondRequest = createAuthedRequester(
        createGreenroomApp({ services: secondServices }),
        adminToken,
      );

      // The teaching run is still listed for the review with its terminal state.
      const listedRuns = (await json(
        await secondRequest(`/api/reviews/${reviewId}/workflow-runs`),
      )) as { runs: Array<{ id: string; workflowKind: string; status: string }> };

      expect(listedRuns.runs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: runId,
            workflowKind: "teaching_generate",
            status: "completed",
          }),
          expect.objectContaining({ workflowKind: "teaching_follow_up", status: "completed" }),
        ]),
      );

      // The run is fetchable through the teaching API with its structured
      // output intact - exactly what the Teach page rehydrates from on load.
      const reloadedRun = (await json(
        await secondRequest(`/api/teaching/runs/${runId}`),
      )) as TeachingRunPayload;

      expect(reloadedRun.run).toMatchObject({ id: runId, status: "completed" });
      expect(reloadedRun.run.output).toMatchObject({
        changeSummary: output.changeSummary,
        walkthrough: [expect.objectContaining({ title: point.title, body: point.body })],
      });
      expect(reloadedRun.run.output?.walkthrough[0]?.anchor).toEqual(point.anchor);

      // The follow-up conversation is reconstructable from the run's event
      // log: the `persistence` event contract that
      // `followUpEntriesFromWorkflowEvents` consumes in the browser.
      const events = (await json(await secondRequest(`/api/workflow-runs/${runId}/events`))) as {
        events: Array<{ eventType: string; summary: string; metadata: Record<string, unknown> }>;
      };

      expect(events.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "persistence",
            summary: "Teaching follow-up answered.",
            metadata: expect.objectContaining({
              followUpWorkflowRunId: expect.stringMatching(/^workflow_run_/u),
              question,
              answer: expect.stringContaining(question),
            }),
          }),
        ]),
      );

      // The promoted point survives as an ordinary anchored review thread.
      const threadsPayload = (await json(
        await secondRequest(`/api/reviews/${reviewId}/threads`),
      )) as {
        threads: Array<{
          shortRef: string;
          source: { kind: string; metadata: Record<string, unknown> };
          comments: Array<{ body: string }>;
        }>;
      };

      expect(threadsPayload.threads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            shortRef: "GT-1",
            source: expect.objectContaining({
              kind: "teaching",
              metadata: expect.objectContaining({ teachingRunId: runId }),
            }),
            comments: [expect.objectContaining({ body: expect.stringContaining(point.body) })],
          }),
        ]),
      );

      // Follow-ups keep working against the reloaded run (scope and output
      // are rebuilt from the durable record, not process memory).
      const postRestartQuestion = "Where do promoted threads live after a restart?";
      const postRestartFollowUp = (await json(
        await secondRequest(`/api/teaching/runs/${runId}/follow-up`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: postRestartQuestion }),
        }),
      )) as {
        followUp: { runId: string; followUpRunId: string; status: string; answer: string | null };
      };

      expect(postRestartFollowUp.followUp).toMatchObject({
        runId,
        followUpRunId: expect.stringMatching(/^workflow_run_/u),
        status: "queued",
        answer: null,
      });

      await waitForResult(
        async () =>
          (await json(await secondRequest(`/api/workflow-runs/${runId}/events`))) as {
            events: Array<{ metadata: Record<string, unknown> }>;
          },
        (payload) =>
          payload.events.some(
            (event) =>
              event.metadata.followUpWorkflowRunId === postRestartFollowUp.followUp.followUpRunId &&
              typeof event.metadata.answer === "string" &&
              event.metadata.answer.includes(postRestartQuestion),
          ),
        "teaching follow-up answer event after restart",
      );

      // Promotion also keeps working from the reloaded run, including the
      // anchor-targets-changed-line and run-scope validation.
      const quizAnchor: ThreadAnchor | null = output.quiz[0]?.anchor ?? null;

      if (quizAnchor === null) {
        throw new Error("Mock teaching output did not include a promotable quiz anchor");
      }

      const promotedAfterRestart = await secondRequest(
        `/api/reviews/${reviewId}/teaching/promote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            profileId: profilePayload.profile.id,
            title: "Post-restart promotion",
            body: "Promoted from the reloaded teaching run after a restart.",
            anchor: quizAnchor,
          }),
        },
      );

      expect(promotedAfterRestart.status).toBe(201);
      expect(await json(promotedAfterRestart)).toMatchObject({
        thread: { shortRef: "GT-2", source: { kind: "teaching" } },
      });
    } finally {
      firstDatabase?.close();
      secondDatabase?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

async function createReviewRepository(): Promise<TestGitRepository> {
  const repository = await createTempGitRepository();
  repositories.push(repository);

  repository.writeFile("README.md", "# Fixture\n");
  await repository.stage();
  await repository.commit("Initial commit");
  await repository.checkout("feature/review", { create: true });
  repository.writeFile("src/index.ts", "export function answer() {\n  return 42;\n}\n");
  await repository.stage();
  await repository.commit("Add feature implementation");

  return repository;
}

function createAuthedRequester(app: ReturnType<typeof createGreenroomApp>, token: string) {
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);

    return app.request(path, {
      ...init,
      headers,
    });
  };
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

async function waitForResult<T>(
  read: () => Promise<T>,
  predicate: (payload: T) => boolean,
  description: string,
): Promise<T> {
  let latest: T | null = null;

  for (let poll = 0; poll < 100; poll += 1) {
    latest = await read();

    if (predicate(latest)) {
      return latest;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${description}; latest=${JSON.stringify(latest)}`);
}
