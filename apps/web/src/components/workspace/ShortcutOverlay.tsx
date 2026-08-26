import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";

import { workspaceShortcutReference } from "./workspaceShortcuts";

/**
 * `?`-triggered keyboard shortcut reference. Renders the grouped
 * descriptor list from workspaceShortcuts.ts (the same source the shortcut
 * hook consumes) and dismisses on Escape, backdrop click, or the close
 * button. Escape is handled in the capture phase and prevented so the
 * workspace shortcut hook does not also act on it.
 */
export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      aria-label="Keyboard shortcuts"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Keyboard aria-hidden="true" className="size-5 text-accent-ink" />
            <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          </div>
          <button
            aria-label="Close shortcut reference"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-muted-surface hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Available in the review workspace while no text field has focus.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {workspaceShortcutReference.map((group) => (
            <section key={group.title}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                {group.title}
              </h3>
              <dl className="mt-2 space-y-2">
                {group.items.map((item) => (
                  <div
                    className="flex items-center justify-between gap-3 text-sm"
                    key={item.action}
                  >
                    <dt className="min-w-0 text-ink">{item.description}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line bg-muted-surface px-1.5 font-mono text-xs font-medium text-ink"
                          key={key}
                        >
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
