import { useState } from "react";

import { Clipboard } from "lucide-react";

/**
 * Copies a global entity ref to the clipboard so it can
 * be pasted into agent prompts or shared as a deep link query param.
 */
export function CopyRefButton({
  compact = false,
  refValue,
  stopPropagation = false,
}: {
  compact?: boolean;
  refValue: string;
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(refValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      aria-label={`Copy ${refValue}`}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-md border border-line px-2 text-xs font-medium text-muted hover:bg-muted-surface hover:text-ink ${
        compact ? "w-8 px-0" : ""
      }`}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }
        void handleCopy();
      }}
      title={`Copy ${refValue}`}
      type="button"
    >
      <Clipboard aria-hidden="true" className="size-3.5" />
      {compact ? (
        <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
      ) : (
        <span>{copied ? "Copied" : "Copy"}</span>
      )}
    </button>
  );
}
