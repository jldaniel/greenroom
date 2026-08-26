import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { Context } from "hono";

import { apiErrorResponse } from "./errors";

/**
 * Static web-app serving.
 *
 * When the server is configured with a web dist directory (the Vite build
 * output), it serves the SPA from the same origin as the API: static assets
 * by path, and `index.html` for every other GET so client-side routes deep
 * link correctly. The handler is registered as a catch-all *after* every API
 * route, so `/health`, `/api/*`, and the other JSON endpoints always take
 * precedence, and unknown `/api/*` paths keep returning JSON 404s instead of
 * the SPA shell.
 *
 * Same-origin serving means the browser needs no CORS or absolute-URL
 * configuration: the web client falls back to `window.location.origin` when
 * no explicit API base URL is baked into the build.
 */

// Hashed Vite assets are safe to cache forever; everything else (notably
// index.html) must be revalidated so new builds are picked up.
const immutableAssetPrefix = "/assets/";
const immutableCacheControl = "public, max-age=31536000, immutable";
const htmlCacheControl = "no-cache";

export type StaticWebHandler = (context: Context) => Promise<Response>;

/**
 * Builds the catch-all GET handler for the built web app. Paths are decoded,
 * resolved against the dist root, and prefix-checked so traversal sequences
 * (`..`, encoded or not) can never escape the dist directory.
 */
export function createStaticWebHandler(distDir: string): StaticWebHandler {
  const root = resolve(distDir);

  return async (context) => {
    const requestPath = context.req.path;

    // Unknown API-ish paths keep their JSON 404 contract even in static mode.
    if (requestPath === "/api" || requestPath.startsWith("/api/")) {
      return apiErrorResponse(context, 404, "not_found", `Route ${requestPath} was not found`);
    }

    const decodedPath = safeDecodePathname(requestPath);

    if (decodedPath === null || decodedPath.includes("\0")) {
      return apiErrorResponse(context, 404, "not_found", "Requested path is not valid");
    }

    const candidate = resolve(
      root,
      `.${decodedPath.startsWith("/") ? decodedPath : `/${decodedPath}`}`,
    );

    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      return apiErrorResponse(context, 404, "not_found", "Requested path is outside the web app");
    }

    if (candidate !== root && (await isReadableFile(candidate))) {
      return fileResponse(candidate, {
        cacheControl: decodedPath.startsWith(immutableAssetPrefix)
          ? immutableCacheControl
          : htmlCacheControl,
      });
    }

    // Paths that look like concrete files (an extension in the last segment)
    // are real 404s; everything else is a client-side route that gets the
    // SPA shell.
    if (lastSegmentHasExtension(decodedPath)) {
      return apiErrorResponse(context, 404, "not_found", `Route ${requestPath} was not found`);
    }

    const indexPath = resolve(root, "index.html");

    if (!(await isReadableFile(indexPath))) {
      return apiErrorResponse(
        context,
        404,
        "not_found",
        `Web app build was not found at ${root}; run \`bun run web:build\` or start with --dev`,
      );
    }

    return fileResponse(indexPath, { cacheControl: htmlCacheControl });
  };
}

function fileResponse(path: string, options: { cacheControl: string }): Response {
  const file = Bun.file(path);

  return new Response(file, {
    headers: {
      "content-type": file.type,
      "cache-control": options.cacheControl,
    },
  });
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function safeDecodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function lastSegmentHasExtension(pathname: string): boolean {
  const lastSegment = pathname.split("/").at(-1) ?? "";
  return lastSegment.includes(".");
}
