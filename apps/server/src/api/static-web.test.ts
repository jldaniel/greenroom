import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices } from "./services";

const indexHtml = "<!doctype html><html><body>Greenroom SPA</body></html>\n";
const assetJs = "console.log('greenroom');\n";

let parentDir: string;
let distDir: string;
let storage: TestStorage;

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), "greenroom-web-dist-"));
  distDir = join(parentDir, "dist");
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(join(distDir, "index.html"), indexHtml, "utf8");
  writeFileSync(join(distDir, "assets", "app-abc123.js"), assetJs, "utf8");
  // Sits one level above the dist root; traversal must never reach it.
  writeFileSync(join(parentDir, "outside-secret.txt"), "top secret\n", "utf8");
});

afterEach(() => {
  storage.cleanup();
  rmSync(parentDir, { recursive: true, force: true });
});

function createStaticFixture(webDistDir: string = distDir) {
  storage = createTestStorage();
  const services = createGreenroomApiServices(storage.database, { defaultAiBackend: "mock" });
  const app = createGreenroomApp({ services, webDistDir });
  const adminToken = services.tokens.create({ name: "Test admin", scopes: ["admin"] });

  return { app, services, adminToken: adminToken.plaintextToken };
}

describe("static web serving", () => {
  it("serves index.html at the root with an html content type", async () => {
    const { app } = createStaticFixture();
    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe(indexHtml);
  });

  it("falls back to index.html for client-side routes (SPA deep links)", async () => {
    const { app } = createStaticFixture();
    const response = await app.request("/reviews/GR-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe(indexHtml);
  });

  it("serves hashed assets with the right content type and immutable caching", async () => {
    const { app } = createStaticFixture();
    const response = await app.request("/assets/app-abc123.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe(assetJs);
  });

  it("keeps /health JSON precedence over the SPA catch-all", async () => {
    const { app } = createStaticFixture();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("returns JSON 404s for unknown /api routes instead of the SPA shell", async () => {
    const { app, adminToken } = createStaticFixture();
    const response = await app.request("/api/does-not-exist", {
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("rejects encoded directory-traversal attempts", async () => {
    const { app } = createStaticFixture();

    for (const path of [
      "/%2e%2e/outside-secret.txt",
      "/..%2foutside-secret.txt",
      "/assets/%2e%2e/%2e%2e/outside-secret.txt",
    ]) {
      const response = await app.request(path);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("top secret");
    }
  });

  it("returns 404 for missing files with extensions instead of the SPA shell", async () => {
    const { app } = createStaticFixture();
    const response = await app.request("/assets/missing-xyz.js");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("returns a helpful 404 when the configured dist has no build output", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "greenroom-web-empty-"));

    try {
      const { app } = createStaticFixture(emptyDir);
      const response = await app.request("/");

      expect(response.status).toBe(404);
      const payload = (await response.json()) as { error: { message: string } };
      expect(payload.error.message).toContain("web:build");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("keeps the JSON not-found handler when no web dist is configured", async () => {
    storage = createTestStorage();
    const services = createGreenroomApiServices(storage.database, { defaultAiBackend: "mock" });
    const app = createGreenroomApp({ services });
    const response = await app.request("/reviews/GR-1");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
