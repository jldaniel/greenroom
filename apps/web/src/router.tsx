import { useEffect } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { LayoutDashboard, ListChecks, Plus, Settings, Server } from "lucide-react";

import type { SpotlightViewRef } from "@greenroom/schemas";

import {
  greenroomApiBaseUrl,
  probeGreenroomApiAuthStatus,
  readGreenroomApiTokenStatus,
} from "./api/client";
import { HeaderRunIndicator, RunCompletionToasts } from "./components/RunNotifications";
import { ToastProvider } from "./components/Toast";
import { DashboardPage } from "./routes/DashboardPage";
import { RepositoriesPage } from "./routes/RepositoriesPage";
import { ReviewCreationPage } from "./routes/ReviewCreationPage";
import { ReviewListPage } from "./routes/ReviewListPage";
import { ReviewWorkspacePage } from "./routes/ReviewWorkspacePage";
import { parseReviewWorkspaceSearch } from "./routes/reviewWorkspaceSearchUtils";
import { SettingsPage } from "./routes/settings/SettingsPage";
import { parseSettingsSection, type SettingsSection } from "./routes/settings/settingsSectionUtils";
import { SetupWizardPage } from "./routes/SetupWizardPage";
import { shouldAutoLaunchSetupWizard } from "./routes/setupWizardUtils";
import { TeachPage } from "./routes/TeachPage";
import { parseTeachViewSearch } from "./routes/teachPageUtils";

const rootRoute = createRootRoute({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const repositoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "repositories",
  component: RepositoriesPage,
});

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "reviews",
  component: ReviewListPage,
});

const reviewCreationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "reviews/new",
  component: ReviewCreationPage,
});

// Global thread and view refs are deep-linkable into the workspace through
// their respective search parameters.
export const reviewWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "reviews/$reviewId",
  validateSearch: parseReviewWorkspaceSearch,
  component: ReviewWorkspacePage,
});

// Dedicated full-page Teach surface. An optional `?view=`
// search param preselects a Spotlight View for View-scoped teaching.
export const reviewTeachRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "reviews/$reviewId/teach",
  validateSearch: (search: Record<string, unknown>): { view?: SpotlightViewRef } => {
    const view = parseTeachViewSearch(search.view);

    return view === undefined ? {} : { view };
  },
  component: TeachPage,
});

// Settings sections are deep-linkable via `?section=`; unknown
// values fall back to the General section inside the page.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  validateSearch: (search: Record<string, unknown>): { section?: SettingsSection } => {
    const section = parseSettingsSection(search.section);

    return section === undefined ? {} : { section };
  },
  component: SettingsPage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "setup",
  component: SetupWizardPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  repositoriesRoute,
  reviewsRoute,
  reviewCreationRoute,
  reviewWorkspaceRoute,
  reviewTeachRoute,
  settingsRoute,
  setupRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// First-launch detection runs once per full page load: when the browser has
// no stored token, an unauthenticated probe decides whether the API actually
// requires one (401) before routing to the setup wizard. Running it once per
// load (not per navigation) lets "Skip setup" land on the dashboard without
// being bounced straight back into the wizard.
let firstLaunchCheckDone = false;

function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isReviewWorkspace = isReviewWorkspacePathname(pathname);
  const navigate = useNavigate();

  useEffect(() => {
    if (firstLaunchCheckDone) {
      return;
    }

    firstLaunchCheckDone = true;

    // Cheap pre-check before issuing the probe request: a stored token or an
    // excluded pathname can never auto-launch the wizard (a 401 probe result
    // is assumed so only the other conditions decide).
    const wouldLaunchOn401 = shouldAutoLaunchSetupWizard({
      tokenSource: readGreenroomApiTokenStatus().source,
      pathname: window.location.pathname,
      probeStatus: 401,
    });

    if (!wouldLaunchOn401) {
      return;
    }

    void probeGreenroomApiAuthStatus().then((probeStatus) => {
      if (
        shouldAutoLaunchSetupWizard({
          tokenSource: readGreenroomApiTokenStatus().source,
          pathname: window.location.pathname,
          probeStatus,
        })
      ) {
        void navigate({ to: "/setup" });
      }
    });
  }, [navigate]);

  return (
    <ToastProvider>
      <RunCompletionToasts />
      <div className="min-h-screen bg-canvas text-ink">
        <header className="border-b border-line bg-surface" role="banner">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface p-1.5">
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-full"
                  src="/brand/greenroom-mark.svg"
                />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-6">Greenroom</p>
                <p className="truncate text-sm text-muted">Local review workspace</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <HeaderRunIndicator />
              <nav aria-label="Primary navigation" className="flex flex-wrap gap-2">
                <NavLink icon={<LayoutDashboard className="size-4" />} label="Workspace" to="/" />
                <NavLink
                  icon={<Server className="size-4" />}
                  label="Repositories"
                  to="/repositories"
                />
                <NavLink icon={<ListChecks className="size-4" />} label="Reviews" to="/reviews" />
                <NavLink icon={<Plus className="size-4" />} label="Create" to="/reviews/new" />
                <NavLink icon={<Settings className="size-4" />} label="Settings" to="/settings" />
              </nav>
            </div>
          </div>
          <div className="border-t border-line/70 bg-muted-surface">
            <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-xs text-muted sm:px-6">
              <Server aria-hidden="true" className="size-3.5" />
              <span className="truncate">{greenroomApiBaseUrl}</span>
            </div>
          </div>
        </header>
        <main
          className={`mx-auto px-4 py-6 sm:px-6 ${
            isReviewWorkspace ? "max-w-none 2xl:px-8" : "max-w-7xl"
          }`}
        >
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  );
}

function isReviewWorkspacePathname(pathname: string): boolean {
  const segments = pathname.replace(/\/+$/, "").split("/");

  return segments.length === 3 && segments[1] === "reviews" && segments[2] !== "new";
}

interface NavLinkProps {
  icon: React.ReactNode;
  label: string;
  to: "/" | "/repositories" | "/reviews" | "/reviews/new" | "/settings";
}

function NavLink({ icon, label, to }: NavLinkProps) {
  return (
    <Link
      to={to}
      activeProps={{ className: "border-ink bg-ink text-surface" }}
      inactiveProps={{ className: "border-line bg-surface text-ink hover:bg-muted-surface" }}
      className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
