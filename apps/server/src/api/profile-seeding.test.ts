import { afterEach, describe, expect, it } from "vitest";

import type { HarnessDetectedCli } from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { mockFallbackProfileDescription, mockFallbackSeedMarker } from "../storage/profiles";
import type { HarnessClient } from "./harness-client";
import {
  createGreenroomApiServices,
  readDefaultAiBackendOverrideFromEnv,
  seedHarnessProfilesFromDetection,
  seedProfilesFromDetection,
} from "./services";

const probedAt = "2026-07-01T12:00:00.000Z";

const storages: TestStorage[] = [];

afterEach(() => {
  while (storages.length > 0) {
    storages.pop()?.cleanup();
  }
});

function createStorage(): TestStorage {
  const storage = createTestStorage();
  storages.push(storage);
  return storage;
}

function detectedCli(
  overrides: Partial<HarnessDetectedCli> & { kind: string },
): HarnessDetectedCli {
  return {
    label: overrides.kind,
    command: overrides.kind,
    found: true,
    path: `/usr/local/bin/${overrides.kind}`,
    version: null,
    lastVerifiedVersion: null,
    recommendSmoke: true,
    probedAt,
    message: null,
    ...overrides,
  };
}

function detectionClient(harnesses: HarnessDetectedCli[]): HarnessClient {
  return {
    run: () => Promise.reject(new Error("run is not supported in this test")),
    detectedHarnesses: () => Promise.resolve({ probedAt, harnesses }),
  };
}

function failingDetectionClient(): HarnessClient {
  return {
    run: () => Promise.reject(new Error("run is not supported in this test")),
    detectedHarnesses: () => Promise.reject(new Error("bridge is down")),
  };
}

function hangingDetectionClient(): HarnessClient {
  return {
    run: () => Promise.reject(new Error("run is not supported in this test")),
    detectedHarnesses: () =>
      new Promise(() => {
        // Never resolves: simulates a bridge that accepts the request but
        // does not answer within the seeding timeout.
      }),
  };
}

describe("profile seeding from detection (V2-026)", () => {
  it("seeds harness profiles for every workflow-capable detected harness kind", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: detectionClient([
        detectedCli({ kind: "claude-code", label: "Claude Code", version: "claude 2.1.0" }),
        detectedCli({ kind: "codex", label: "Codex" }),
        detectedCli({ kind: "not-installed", label: "Not Installed", found: false, path: null }),
      ]),
    });

    const result = await seedProfilesFromDetection(services);

    expect(result.outcome).toBe("harness_detected");
    expect(result.detectedKinds).toEqual(["claude-code", "codex"]);
    expect(result.created.map((profile) => profile.name)).toEqual([
      "Default teaching (Claude Code)",
      "Default spotlight (Claude Code)",
      "Default AI review (Claude Code)",
      "Default teaching (Codex)",
      "Default spotlight (Codex)",
      "Default AI review (Codex)",
    ]);
    expect(result.created[0]).toMatchObject({
      provider: "harness",
      model: "claude-code",
      description:
        "Seeded automatically because the Claude Code CLI (claude 2.1.0) was detected on this machine.",
      modelSettings: { harness: { kind: "claude-code" } },
    });
    expect(services.profiles.list()).toHaveLength(6);
  });

  it("seeds unknown future harness kinds generically from the detection payload", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: detectionClient([
        detectedCli({ kind: "future-agent", label: "Future Agent" }),
      ]),
    });

    const result = await seedProfilesFromDetection(services);

    expect(result.outcome).toBe("harness_detected");
    expect(result.detectedKinds).toEqual(["future-agent"]);
    expect(result.created.map((profile) => profile.name)).toEqual([
      "Default teaching (Future Agent)",
      "Default spotlight (Future Agent)",
      "Default AI review (Future Agent)",
    ]);
    expect(result.created[0]).toMatchObject({
      provider: "harness",
      model: "future-agent",
      description:
        "Seeded automatically because the Future Agent CLI was detected on this machine.",
      modelSettings: { harness: { kind: "future-agent" } },
    });
  });

  it("seeds the mock fallback with an explanation when no harness CLI is found", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: detectionClient([
        detectedCli({ kind: "claude-code", label: "Claude Code", found: false, path: null }),
      ]),
    });

    const result = await seedProfilesFromDetection(services);

    expect(result.outcome).toBe("mock_fallback");
    expect(result.created.map((profile) => profile.name)).toEqual([
      "Default teaching",
      "Default spotlight",
    ]);
    expect(result.created[0]).toMatchObject({
      provider: "mock",
      description: mockFallbackProfileDescription,
      contextPreferences: { seededBy: mockFallbackSeedMarker },
    });
    expect(result.created[0]?.description).toContain("no coding-agent harness CLI was detected");
    expect(result.created[0]?.description).toContain("greenroom up");
  });

  it("seeds the mock fallback when the bridge is not configured", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: null,
    });

    const result = await seedProfilesFromDetection(services);

    expect(result.outcome).toBe("mock_fallback");
    expect(result.created).toHaveLength(2);
    expect(result.created[0]?.description).toBe(mockFallbackProfileDescription);
  });

  it("seeds the mock fallback when the bridge detection request fails", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: failingDetectionClient(),
    });

    const result = await seedProfilesFromDetection(services);

    expect(result.outcome).toBe("mock_fallback");
    expect(result.created).toHaveLength(2);
  });

  it("seeds the mock fallback when detection exceeds the seeding timeout", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: hangingDetectionClient(),
    });

    const result = await seedProfilesFromDetection(services, { detectionTimeoutMs: 10 });

    expect(result.outcome).toBe("mock_fallback");
    expect(result.created).toHaveLength(2);
  });

  it("does not reseed a database that already has non-fallback profiles", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      defaultAiBackend: "mock",
      harnessClient: detectionClient([detectedCli({ kind: "claude-code", label: "Claude Code" })]),
    });

    const result = await seedProfilesFromDetection(services);

    expect(result.outcome).toBe("profiles_exist");
    expect(result.created).toEqual([]);
    expect(services.profiles.list().every((profile) => profile.provider === "mock")).toBe(true);
  });

  it("upgrades a mock-fallback-only database once detection succeeds", async () => {
    const storage = createStorage();
    const offlineServices = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: null,
    });
    const first = await seedProfilesFromDetection(offlineServices);
    expect(first.outcome).toBe("mock_fallback");

    // Same database on a later startup, now with a reachable bridge.
    const onlineServices = createGreenroomApiServices(storage.database, {
      env: {},
      harnessClient: detectionClient([detectedCli({ kind: "claude-code", label: "Claude Code" })]),
    });
    const second = await seedProfilesFromDetection(onlineServices);

    expect(second.outcome).toBe("harness_detected");
    expect(second.created.map((profile) => profile.name)).toEqual([
      "Default teaching (Claude Code)",
      "Default spotlight (Claude Code)",
      "Default AI review (Claude Code)",
    ]);
    // The fallback mock profiles are kept alongside the harness profiles.
    expect(onlineServices.profiles.list()).toHaveLength(5);

    // Once harness profiles exist, subsequent startups do not reseed.
    const third = await seedProfilesFromDetection(onlineServices);
    expect(third).toMatchObject({ outcome: "profiles_exist", created: [] });
  });

  it("exposes an idempotent wizard helper that adds only missing harness kinds", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: {},
      defaultAiBackend: "harness:claude-code",
      harnessClient: detectionClient([
        detectedCli({ kind: "claude-code", label: "Claude Code" }),
        detectedCli({ kind: "pi", label: "Pi" }),
        detectedCli({ kind: "codex", label: "Codex" }),
      ]),
    });

    const first = await seedHarnessProfilesFromDetection(services);

    expect(first.detectedKinds).toEqual(["claude-code", "pi", "codex"]);
    // Claude Code profiles already exist from the override; Pi and Codex are added.
    expect(first.created.map((profile) => profile.name)).toEqual([
      "Default teaching (Pi)",
      "Default spotlight (Pi)",
      "Default AI review (Pi)",
      "Default teaching (Codex)",
      "Default spotlight (Codex)",
      "Default AI review (Codex)",
    ]);

    const second = await seedHarnessProfilesFromDetection(services);
    expect(second.created).toEqual([]);
  });

  it("honors the GREENROOM_DEFAULT_AI_BACKEND override over detection", async () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: { GREENROOM_DEFAULT_AI_BACKEND: "mock" },
      harnessClient: detectionClient([detectedCli({ kind: "claude-code", label: "Claude Code" })]),
    });

    // The override seeds synchronously at service creation.
    expect(services.profiles.list().map((profile) => profile.name)).toEqual([
      "Default spotlight",
      "Default teaching",
    ]);
    expect(services.profiles.list().every((profile) => profile.provider === "mock")).toBe(true);

    const result = await seedProfilesFromDetection(services);
    expect(result).toMatchObject({ outcome: "profiles_exist", created: [] });
  });

  it("seeds harness profiles for any harness:<kind> override value", () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: { GREENROOM_DEFAULT_AI_BACKEND: "harness:future-agent" },
      harnessClient: null,
    });

    expect(services.profiles.list().map((profile) => profile.name)).toEqual([
      "Default AI review (future-agent)",
      "Default spotlight (future-agent)",
      "Default teaching (future-agent)",
    ]);
  });

  it("seeds Codex profiles for a harness:codex override", () => {
    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: { GREENROOM_DEFAULT_AI_BACKEND: "harness:codex" },
      harnessClient: null,
    });

    expect(services.profiles.list().map((profile) => profile.name)).toEqual([
      "Default AI review (Codex)",
      "Default spotlight (Codex)",
      "Default teaching (Codex)",
    ]);
  });

  it("ignores unknown override values so detection applies", () => {
    expect(readDefaultAiBackendOverrideFromEnv({})).toBeNull();
    expect(readDefaultAiBackendOverrideFromEnv({ GREENROOM_DEFAULT_AI_BACKEND: "" })).toBeNull();
    expect(
      readDefaultAiBackendOverrideFromEnv({ GREENROOM_DEFAULT_AI_BACKEND: "openai" }),
    ).toBeNull();
    expect(
      readDefaultAiBackendOverrideFromEnv({ GREENROOM_DEFAULT_AI_BACKEND: "harness:" }),
    ).toBeNull();
    expect(readDefaultAiBackendOverrideFromEnv({ GREENROOM_DEFAULT_AI_BACKEND: "mock" })).toBe(
      "mock",
    );
    expect(
      readDefaultAiBackendOverrideFromEnv({
        GREENROOM_DEFAULT_AI_BACKEND: " harness:claude-code ",
      }),
    ).toBe("harness:claude-code");

    const storage = createStorage();
    const services = createGreenroomApiServices(storage.database, {
      env: { GREENROOM_DEFAULT_AI_BACKEND: "openai" },
      harnessClient: null,
    });

    expect(services.profiles.list()).toEqual([]);
  });
});
