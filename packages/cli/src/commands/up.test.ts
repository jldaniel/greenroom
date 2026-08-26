import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  describeBridge,
  noHarnessDetectedHint,
  resolveWebServeMode,
  staticWebServiceStatus,
  upsertServiceStatus,
  webBuildIsStale,
  webDistDirFor,
  webSourcePathsFor,
} from "./up";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveWebServeMode", () => {
  const distDir = "/repo/apps/web/dist";

  it("selects the Vite dev server when --dev is set, regardless of the build", () => {
    expect(resolveWebServeMode({ dev: true, distDir, buildIsStale: false })).toEqual({
      kind: "dev",
    });
    expect(resolveWebServeMode({ dev: true, distDir, buildIsStale: true })).toEqual({
      kind: "dev",
    });
  });

  it("serves an existing build statically without rebuilding", () => {
    expect(resolveWebServeMode({ dev: false, distDir, buildIsStale: false })).toEqual({
      kind: "static",
      distDir,
      needsBuild: false,
    });
  });

  it("builds once when the web build output is missing", () => {
    expect(resolveWebServeMode({ dev: false, distDir, buildIsStale: true })).toEqual({
      kind: "static",
      distDir,
      needsBuild: true,
    });
  });
});

describe("webDistDirFor", () => {
  it("points at the Vite build output inside the workspace", () => {
    expect(webDistDirFor("/repo")).toBe(join("/repo", "apps", "web", "dist"));
  });
});

describe("webBuildIsStale", () => {
  it("detects source files newer than the static web build", () => {
    const root = mkdtempSync(join(tmpdir(), "greenroom-up-test-"));
    tempDirs.push(root);
    const builtIndexPath = join(root, "apps", "web", "dist", "index.html");
    const sourcePath = join(root, "apps", "web", "src", "main.tsx");
    mkdirSync(join(root, "apps", "web", "dist"), { recursive: true });
    mkdirSync(join(root, "apps", "web", "src"), { recursive: true });
    writeFileSync(builtIndexPath, "<html></html>");
    writeFileSync(sourcePath, "console.log('fresh');");
    const older = new Date("2026-07-01T00:00:00.000Z");
    const newer = new Date("2026-07-02T00:00:00.000Z");
    utimesSync(builtIndexPath, older, older);
    utimesSync(sourcePath, newer, newer);

    expect(
      webBuildIsStale({ builtIndexPath, sourcePaths: [join(root, "apps", "web", "src")] }),
    ).toBe(true);

    utimesSync(builtIndexPath, newer, newer);
    expect(webBuildIsStale({ builtIndexPath, sourcePaths: [sourcePath] })).toBe(false);
  });
});

describe("webSourcePathsFor", () => {
  it("covers the web app source and public asset roots", () => {
    expect(webSourcePathsFor("/repo")).toEqual([
      join("/repo", "apps", "web", "index.html"),
      join("/repo", "apps", "web", "package.json"),
      join("/repo", "apps", "web", "public"),
      join("/repo", "apps", "web", "src"),
      join("/repo", "apps", "web", "vite.config.ts"),
    ]);
  });
});

describe("describeBridge", () => {
  it("labels a supervised bridge with its origin", () => {
    expect(
      describeBridge({ bridgeBaseUrl: "http://127.0.0.1:49343", ports: { bridge: 49343 } }),
    ).toBe("http://127.0.0.1:49343 (harness bridge, supervised)");
  });

  it("labels an external bridge configured through the environment", () => {
    expect(
      describeBridge({ bridgeBaseUrl: "http://127.0.0.1:5000", ports: { bridge: null } }),
    ).toBe("http://127.0.0.1:5000 (external, from GREENROOM_HARNESS_BASE_URL)");
  });

  it("reports a disabled bridge", () => {
    expect(describeBridge({ bridgeBaseUrl: null, ports: { bridge: null } })).toBe(
      "disabled (GREENROOM_HARNESS_BASE_URL is empty)",
    );
  });
});

describe("staticWebServiceStatus", () => {
  it("reports the API-served web app as running without its own process", () => {
    const status = staticWebServiceStatus("http://127.0.0.1:49331", "2026-07-01T00:00:00.000Z");

    expect(status).toMatchObject({
      name: "web",
      state: "running",
      url: "http://127.0.0.1:49331",
      pid: null,
      message: "static (served by api)",
    });
  });

  it("replaces an existing web entry when upserted into the state file", () => {
    const services = upsertServiceStatus(
      [staticWebServiceStatus("http://127.0.0.1:1", "2026-07-01T00:00:00.000Z")],
      staticWebServiceStatus("http://127.0.0.1:2", "2026-07-01T00:00:01.000Z"),
    );

    expect(services).toHaveLength(1);
    expect(services[0]?.url).toBe("http://127.0.0.1:2");
  });
});

describe("noHarnessDetectedHint", () => {
  const probedAt = "2026-07-01T00:00:00.000Z";
  const missing = (kind: string, label: string) => ({
    kind,
    label,
    command: kind,
    found: false,
    path: null,
    version: null,
    lastVerifiedVersion: null,
    recommendSmoke: false,
    probedAt,
    message: null,
  });

  it("suggests the managed Pi install when no harness CLI is found", () => {
    const hint = noHarnessDetectedHint({
      probedAt,
      harnesses: [
        missing("claude-code", "Claude Code"),
        missing("codex", "Codex"),
        missing("pi", "Pi"),
      ],
    });

    expect(hint).toContain("No harness CLI detected (Claude Code, Codex, Pi)");
    expect(hint).toContain("greenroom harness install-pi");
  });

  it("stays quiet when any harness CLI is found", () => {
    expect(
      noHarnessDetectedHint({
        probedAt,
        harnesses: [
          { ...missing("claude-code", "Claude Code"), found: true, path: "/usr/local/bin/claude" },
          missing("pi", "Pi"),
        ],
      }),
    ).toBeNull();
  });
});
