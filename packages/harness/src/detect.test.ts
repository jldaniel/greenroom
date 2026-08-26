import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createHarnessDetector, defaultHarnessCliProbeSpecs, probeHarnessCli } from "./detect";
import { managedPiBinaryPath } from "./pi-install";
import { knownPresetKinds } from "./presets";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("harness CLI detection", () => {
  it("covers every registered harness preset kind", () => {
    const detectedKinds = defaultHarnessCliProbeSpecs()
      .map((spec) => spec.kind)
      .sort();
    const registeredKinds = knownPresetKinds().sort();

    expect(detectedKinds).toEqual(registeredKinds);
  });

  it("probes the managed Pi install ahead of the PATH when a tools dir is set", async () => {
    const root = await tempDir();
    const toolsDir = join(root, "tools");
    const managedBinary = managedPiBinaryPath(toolsDir);
    await mkdir(join(toolsDir, "pi", "node_modules", ".bin"), { recursive: true });
    await writeScript(managedBinary, "echo '0.73.1'");
    // A different pi on PATH must lose to the managed install.
    const bin = await fakeBin(root, { pi: "echo '9.9.9-path'" });

    const specs = defaultHarnessCliProbeSpecs({ toolsDir });
    const detection = await createHarnessDetector({
      stateDir: null,
      toolsDir,
      env: { PATH: bin },
    }).probe();

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pi", commands: [managedBinary, "pi"] }),
      ]),
    );
    expect(detection.harnesses.find((entry) => entry.kind === "pi")).toMatchObject({
      found: true,
      command: managedBinary,
      path: managedBinary,
      version: "0.73.1",
    });
  });

  it("falls back to pi on the PATH when there is no managed install", async () => {
    const root = await tempDir();
    const bin = await fakeBin(root, { pi: "echo '0.73.1'" });

    const detection = await createHarnessDetector({
      stateDir: null,
      toolsDir: join(root, "tools"),
      env: { PATH: bin },
    }).probe();

    expect(detection.harnesses.find((entry) => entry.kind === "pi")).toMatchObject({
      found: true,
      command: "pi",
      path: join(bin, "pi"),
      version: "0.73.1",
    });
  });

  it("detects installed CLIs with path and version and persists a baseline", async () => {
    const root = await tempDir();
    const bin = await fakeBin(root, { claude: "echo '9.9.9 (Claude Code)'" });
    const stateDir = join(root, "state");
    const detector = createHarnessDetector({ stateDir, env: { PATH: bin } });

    const detection = await detector.probe();
    const claude = detection.harnesses.find((entry) => entry.kind === "claude-code");
    const codex = detection.harnesses.find((entry) => entry.kind === "codex");
    const state = JSON.parse(await readFile(join(stateDir, "harness-versions.json"), "utf8")) as {
      harnesses: Record<string, { verifiedVersion: string; verifiedBy: string }>;
    };

    expect(claude).toMatchObject({
      kind: "claude-code",
      command: "claude",
      found: true,
      path: join(bin, "claude"),
      version: "9.9.9 (Claude Code)",
      lastVerifiedVersion: "9.9.9 (Claude Code)",
      recommendSmoke: false,
      message: null,
    });
    expect(codex).toMatchObject({
      kind: "codex",
      found: false,
      path: null,
      version: null,
      recommendSmoke: false,
      message: expect.stringContaining("not found"),
    });
    expect(state.harnesses["claude-code"]).toMatchObject({
      verifiedVersion: "9.9.9 (Claude Code)",
      verifiedBy: "baseline",
    });
  });

  it("recommends a re-smoke on version change and clears it after a recorded smoke", async () => {
    const root = await tempDir();
    const bin = await fakeBin(root, { claude: "echo '1.0.0 (Claude Code)'" });
    const stateDir = join(root, "state");
    const env = { PATH: bin };

    // Baseline probe with version 1.0.0, then the CLI updates to 2.0.0.
    await createHarnessDetector({ stateDir, env }).probe();
    await writeScript(join(bin, "claude"), "echo '2.0.0 (Claude Code)'");

    // A fresh detector (bridge restart) reads the persisted baseline.
    const detector = createHarnessDetector({ stateDir, env });
    const changed = await detector.probe();
    const flagged = changed.harnesses.find((entry) => entry.kind === "claude-code");

    expect(flagged).toMatchObject({
      found: true,
      version: "2.0.0 (Claude Code)",
      lastVerifiedVersion: "1.0.0 (Claude Code)",
      recommendSmoke: true,
    });

    const recorded = await detector.recordSmoke("claude-code");
    const after = await detector.probe();
    const state = JSON.parse(await readFile(join(stateDir, "harness-versions.json"), "utf8")) as {
      harnesses: Record<string, { verifiedVersion: string; verifiedBy: string }>;
    };

    expect(recorded).toMatchObject({
      version: "2.0.0 (Claude Code)",
      lastVerifiedVersion: "2.0.0 (Claude Code)",
      recommendSmoke: false,
    });
    expect(after.harnesses.find((entry) => entry.kind === "claude-code")).toMatchObject({
      recommendSmoke: false,
      lastVerifiedVersion: "2.0.0 (Claude Code)",
    });
    expect(state.harnesses["claude-code"]).toMatchObject({
      verifiedVersion: "2.0.0 (Claude Code)",
      verifiedBy: "smoke",
    });
    expect(await detector.recordSmoke("unknown-kind")).toBeNull();
  });

  it("treats non-zero exits and timeouts as not found without throwing", async () => {
    const root = await tempDir();
    const bin = await fakeBin(root, {
      claude: "echo 'boom' >&2; exit 3",
      codex: "/bin/sleep 5",
    });

    const failing = await probeHarnessCli(
      { kind: "claude-code", label: "Claude Code", commands: ["claude"], versionArgs: ["-v"] },
      { PATH: bin },
      2000,
    );
    const timedOut = await probeHarnessCli(
      { kind: "codex", label: "Codex", commands: ["codex"], versionArgs: ["-v"] },
      { PATH: bin },
      250,
    );

    expect(failing).toMatchObject({
      found: false,
      version: null,
      message: expect.stringContaining("exited with status 3"),
    });
    expect(timedOut).toMatchObject({
      found: false,
      version: null,
      message: expect.stringContaining("timed out"),
    });
  });

  it("tracks versions in memory when no state dir is configured", async () => {
    const root = await tempDir();
    const bin = await fakeBin(root, { claude: "echo '1.2.3'" });
    const detector = createHarnessDetector({ stateDir: null, env: { PATH: bin } });

    await detector.probe();
    await writeScript(join(bin, "claude"), "echo '1.2.4'");
    const changed = await detector.probe();

    expect(changed.harnesses.find((entry) => entry.kind === "claude-code")).toMatchObject({
      version: "1.2.4",
      lastVerifiedVersion: "1.2.3",
      recommendSmoke: true,
    });
  });

  it("recovers from a corrupt state file instead of crashing", async () => {
    const root = await tempDir();
    const bin = await fakeBin(root, { claude: "echo '3.0.0'" });
    const stateDir = join(root, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "harness-versions.json"), "{not json", "utf8");

    const detection = await createHarnessDetector({ stateDir, env: { PATH: bin } }).probe();

    expect(detection.harnesses.find((entry) => entry.kind === "claude-code")).toMatchObject({
      found: true,
      version: "3.0.0",
      recommendSmoke: false,
    });
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "greenroom-harness-detect-"));
  tempDirs.push(dir);
  return dir;
}

async function fakeBin(root: string, scripts: Record<string, string>): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });

  for (const [name, body] of Object.entries(scripts)) {
    await writeScript(join(bin, name), body);
  }

  return bin;
}

async function writeScript(path: string, body: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(path, 0o755);
}
