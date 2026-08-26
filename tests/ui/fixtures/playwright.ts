import { expect, test as base } from "@playwright/test";

export { expect };
export type { Page } from "@playwright/test";

type ErrorPattern = string | RegExp;

export interface BrowserErrorAllowlist {
  console?: readonly ErrorPattern[];
  page?: readonly ErrorPattern[];
}

interface ErrorGuardFixtures {
  errorGuardAllowlist: BrowserErrorAllowlist;
}

const genericFailedResourceDiagnostic =
  /^Failed to load resource: the server responded with a status of \d+ \([^)]*\)$/u;

export const test = base.extend<ErrorGuardFixtures>({
  errorGuardAllowlist: [{}, { option: true }],
  page: async ({ errorGuardAllowlist, page }, use) => {
    const errors: string[] = [];

    const onPageError = (error: Error) => {
      const detail = error.stack ?? error.message;
      if (!matchesAllowlist(detail, errorGuardAllowlist.page)) {
        errors.push(`Uncaught page error:\n${detail}`);
      }
    };
    const onConsole = (message: {
      location(): { url?: string; lineNumber?: number };
      text(): string;
    }) => {
      const detail = message.text();
      if (
        genericFailedResourceDiagnostic.test(detail) ||
        matchesAllowlist(detail, errorGuardAllowlist.console)
      ) {
        return;
      }

      const location = message.location();
      const source = location.url
        ? ` (${location.url}${location.lineNumber === undefined ? "" : `:${location.lineNumber}`})`
        : "";
      errors.push(`Application console.error${source}:\n${detail}`);
    };

    page.on("pageerror", onPageError);
    page.on("console", (message) => {
      if (message.type() === "error") {
        onConsole(message);
      }
    });

    await use(page);

    if (errors.length > 0) {
      throw new Error(`Browser errors detected:\n\n${errors.join("\n\n")}`);
    }
  },
});

function matchesAllowlist(detail: string, patterns: readonly ErrorPattern[] | undefined): boolean {
  return (patterns ?? []).some((pattern) => {
    if (typeof pattern === "string") {
      return detail === pattern;
    }

    pattern.lastIndex = 0;
    const matches = pattern.test(detail);
    pattern.lastIndex = 0;
    return matches;
  });
}
