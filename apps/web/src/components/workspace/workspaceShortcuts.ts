/**
 * Single source of truth for workspace keyboard shortcuts: the key
 * bindings drive useWorkspaceShortcuts and the grouped reference drives the
 * `?` overlay, so the overlay can never document a shortcut that does not
 * exist (a unit test asserts both sides cover the same actions).
 */

export type WorkspaceShortcutAction =
  | "next_file"
  | "previous_file"
  | "next_thread"
  | "previous_thread"
  | "unified_diff"
  | "split_diff"
  | "refresh"
  | "clear_composer"
  | "show_shortcuts";

/**
 * Maps a normalized `KeyboardEvent.key` (lowercased) to its workspace
 * action. Shortcuts are letter/symbol presses without Alt/Ctrl/Meta; Shift is
 * allowed so `?` (Shift+/) works.
 */
export const workspaceShortcutBindings: Readonly<Record<string, WorkspaceShortcutAction>> = {
  j: "next_file",
  k: "previous_file",
  "]": "next_thread",
  "[": "previous_thread",
  u: "unified_diff",
  s: "split_diff",
  r: "refresh",
  escape: "clear_composer",
  "?": "show_shortcuts",
};

export function workspaceShortcutActionForKey(key: string): WorkspaceShortcutAction | null {
  return workspaceShortcutBindings[key.toLowerCase()] ?? null;
}

export interface WorkspaceShortcutReferenceItem {
  action: WorkspaceShortcutAction;
  keys: string[];
  description: string;
}

export interface WorkspaceShortcutReferenceGroup {
  title: string;
  items: WorkspaceShortcutReferenceItem[];
}

export const workspaceShortcutReference: readonly WorkspaceShortcutReferenceGroup[] = [
  {
    title: "Navigation",
    items: [
      { action: "next_file", keys: ["J"], description: "Next changed file" },
      { action: "previous_file", keys: ["K"], description: "Previous changed file" },
    ],
  },
  {
    title: "Diff",
    items: [
      { action: "unified_diff", keys: ["U"], description: "Unified diff view" },
      { action: "split_diff", keys: ["S"], description: "Split diff view" },
      { action: "refresh", keys: ["R"], description: "Refresh the review from the worktree" },
    ],
  },
  {
    title: "Threads",
    items: [
      { action: "next_thread", keys: ["]"], description: "Next visible thread" },
      { action: "previous_thread", keys: ["["], description: "Previous visible thread" },
      { action: "clear_composer", keys: ["Esc"], description: "Close the comment composer" },
    ],
  },
  {
    title: "Help",
    items: [{ action: "show_shortcuts", keys: ["?"], description: "Show this shortcut reference" }],
  },
];
