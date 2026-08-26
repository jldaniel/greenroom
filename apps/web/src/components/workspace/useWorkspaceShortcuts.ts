import { useEffect } from "react";

import type { DiffMode } from "./workspaceTypes";
import { workspaceShortcutActionForKey } from "./workspaceShortcuts";
import { isEditableShortcutTarget } from "./workspaceUtils";

/**
 * Workspace keyboard shortcuts: J/K file navigation, [/] thread navigation,
 * U/S diff mode, R refresh, Escape closes the thread composer, and `?` opens
 * the shortcut reference overlay. Key-to-action mapping lives in
 * workspaceShortcuts.ts so the overlay documents exactly these bindings.
 * Skipped while an editable element has focus or Alt/Ctrl/Meta is held.
 */
export function useWorkspaceShortcuts({
  canClearComposer,
  canRefresh,
  onClearComposer,
  onRefresh,
  onSelectRelativeFile,
  onSelectRelativeThread,
  onSetDiffMode,
  onShowShortcuts,
}: {
  canClearComposer: boolean;
  canRefresh: boolean;
  onClearComposer: () => void;
  onRefresh: () => void;
  onSelectRelativeFile: (offset: number) => void;
  onSelectRelativeThread: (offset: number) => void;
  onSetDiffMode: (mode: DiffMode) => void;
  onShowShortcuts: () => void;
}): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const action = workspaceShortcutActionForKey(event.key);

      switch (action) {
        case "next_file":
          event.preventDefault();
          onSelectRelativeFile(1);
          break;
        case "previous_file":
          event.preventDefault();
          onSelectRelativeFile(-1);
          break;
        case "next_thread":
          event.preventDefault();
          onSelectRelativeThread(1);
          break;
        case "previous_thread":
          event.preventDefault();
          onSelectRelativeThread(-1);
          break;
        case "unified_diff":
          event.preventDefault();
          onSetDiffMode("unified");
          break;
        case "split_diff":
          event.preventDefault();
          onSetDiffMode("split");
          break;
        case "refresh":
          if (canRefresh) {
            event.preventDefault();
            onRefresh();
          }
          break;
        case "clear_composer":
          if (canClearComposer) {
            event.preventDefault();
            onClearComposer();
          }
          break;
        case "show_shortcuts":
          event.preventDefault();
          onShowShortcuts();
          break;
        case null:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canClearComposer,
    canRefresh,
    onClearComposer,
    onRefresh,
    onSelectRelativeFile,
    onSelectRelativeThread,
    onSetDiffMode,
    onShowShortcuts,
  ]);
}
