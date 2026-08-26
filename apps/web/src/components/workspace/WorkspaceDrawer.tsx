import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Bot,
  MessageSquareReply,
  PanelRightClose,
  PanelRightOpen,
  Search,
} from "lucide-react";

import type { WorkspaceDrawerSection } from "./workspaceTypes";
import {
  clampWorkspaceDrawerWidth,
  WORKSPACE_DRAWER_DEFAULT_WIDTH,
  WORKSPACE_DRAWER_MAX_WIDTH,
  WORKSPACE_DRAWER_MIN_WIDTH,
} from "./workspaceDrawerSizing";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";

const drawerTabs = [
  { id: "threads", label: "Threads", Icon: MessageSquareReply },
  { id: "ai_review", label: "AI Review", Icon: Bot },
  { id: "spotlight", label: "Spotlight", Icon: Search },
] as const;

const segmentDividerClasses = [
  "",
  "border-l border-line",
  "border-t border-line sm:border-l sm:border-t-0",
] as const;

const segmentClasses =
  "inline-flex h-10 min-w-0 cursor-pointer items-center justify-center gap-2 bg-surface px-2 text-sm font-medium transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-3";

export const workspaceDrawerSectionLabels: Record<WorkspaceDrawerSection, string> = {
  threads: "Threads",
  ai_review: "AI Review",
  spotlight: "Spotlight",
};

/**
 * Section tabs for the workspace right drawer. The diff stays the
 * permanent center surface; these tabs pick which section the drawer shows
 * and reopen it when it is hidden. Teach is not a drawer section: it renders
 * as a link to the dedicated full-page Teach route.
 */
export function WorkspacePanelTabs({
  activeSection,
  drawerOpen,
  onSelectSection,
  onToggleDrawer,
  reviewId,
}: {
  activeSection: WorkspaceDrawerSection;
  drawerOpen: boolean;
  onSelectSection: (section: WorkspaceDrawerSection) => void;
  onToggleDrawer: () => void;
  reviewId: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-4">
        <div aria-label="Workspace panels" className="contents" role="tablist">
          {drawerTabs.map((tab, index) => {
            const Icon = tab.Icon;
            const selected = drawerOpen && tab.id === activeSection;

            return (
              <button
                aria-controls="workspace-drawer"
                aria-selected={selected}
                className={`${segmentClasses} ${segmentDividerClasses[index]} ${
                  selected
                    ? "bg-muted-surface text-ink shadow-sm"
                    : "text-muted hover:bg-muted-surface hover:text-ink"
                }`}
                id={`workspace-tab-${tab.id}`}
                key={tab.id}
                onClick={() => onSelectSection(tab.id)}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <Link
          className={`${segmentClasses} border-l border-t border-line text-muted hover:bg-muted-surface hover:text-ink sm:border-t-0`}
          params={{ reviewId }}
          to="/reviews/$reviewId/teach"
        >
          <BookOpen aria-hidden="true" className="size-4 shrink-0" />
          Teach
        </Link>
      </div>
      <button
        aria-controls="workspace-drawer"
        aria-expanded={drawerOpen}
        aria-label={drawerOpen ? "Hide side panel" : "Show side panel"}
        className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors hover:bg-muted-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={onToggleDrawer}
        title={drawerOpen ? "Hide side panel" : "Show side panel"}
        type="button"
      >
        {drawerOpen ? (
          <PanelRightClose aria-hidden="true" className="size-4" />
        ) : (
          <PanelRightOpen aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}

/**
 * The drawer column itself: one section at a time, with the revision panel
 * (passed as part of children) below the section content.
 */
export function WorkspaceDrawer({
  activeSection,
  children,
  onWidthChange,
  width,
}: {
  activeSection: WorkspaceDrawerSection;
  children: ReactNode;
  onWidthChange: (width: number) => void;
  width: number;
}) {
  return (
    <aside
      aria-labelledby={`workspace-tab-${activeSection}`}
      className="relative min-w-0 w-full"
      id="workspace-drawer"
      role="tabpanel"
    >
      <WorkspaceResizeHandle
        ariaLabel="Resize side panel"
        className="absolute inset-y-0 -left-3 w-6"
        clampWidth={clampWorkspaceDrawerWidth}
        defaultWidth={WORKSPACE_DRAWER_DEFAULT_WIDTH}
        edge="left"
        gripPosition="viewport"
        maxWidth={WORKSPACE_DRAWER_MAX_WIDTH}
        minWidth={WORKSPACE_DRAWER_MIN_WIDTH}
        onWidthChange={onWidthChange}
        title="Drag to resize side panel; double-click to reset"
        width={width}
      />
      <div className="min-w-0 w-full space-y-4">{children}</div>
    </aside>
  );
}
