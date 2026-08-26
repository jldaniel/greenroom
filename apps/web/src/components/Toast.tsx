import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleDot, X } from "lucide-react";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastInput {
  kind: "success" | "error" | "info";
  title: string;
  body?: string | null;
  action?: ToastAction;
}

interface ToastRecord extends ToastInput {
  id: number;
}

type PushToast = (toast: ToastInput) => void;

const ToastContext = createContext<PushToast | null>(null);

// Errors stay longest so the diagnostics action remains reachable; the stack
// keeps at most five toasts so a burst cannot cover the page.
const autoDismissMs: Record<ToastInput["kind"], number> = {
  success: 6_000,
  info: 8_000,
  error: 15_000,
};
const maxVisibleToasts = 5;

export function useToasts(): PushToast {
  const push = useContext(ToastContext);

  if (push === null) {
    throw new Error("useToasts requires a ToastProvider ancestor");
  }

  return push;
}

/**
 * Small in-app toast system: transient completion/failure notices
 * stacked bottom-right, announced politely to screen readers, each with an
 * optional action (e.g. "View diagnostics") and a manual dismiss.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (toast) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      setToasts((current) => [...current.slice(1 - maxVisibleToasts), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), autoDismissMs[toast.kind]);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        role="status"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} onDismiss={() => dismiss(toast.id)} toast={toast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ onDismiss, toast }: { onDismiss: () => void; toast: ToastRecord }) {
  const Icon =
    toast.kind === "error" ? AlertCircle : toast.kind === "success" ? CheckCircle2 : CircleDot;

  return (
    <div
      className={`pointer-events-auto rounded-lg border px-3 py-2.5 shadow-lg ${toastClassName(toast.kind)}`}
    >
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{toast.title}</p>
          {toast.body === undefined || toast.body === null ? null : (
            <p className="mt-0.5 break-words text-xs opacity-90">{toast.body}</p>
          )}
          {toast.action === undefined ? null : (
            <button
              className="mt-2 inline-flex h-7 items-center rounded-md border border-line bg-surface px-2 text-xs font-medium text-ink hover:bg-muted-surface"
              onClick={() => {
                toast.action?.onAction();
                onDismiss();
              }}
              type="button"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          aria-label="Dismiss notification"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-70 hover:bg-surface/60 hover:opacity-100"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function toastClassName(kind: ToastInput["kind"]): string {
  if (kind === "error") {
    return "border-danger/30 bg-danger-soft text-danger-ink";
  }

  if (kind === "success") {
    return "border-success/30 bg-success-soft text-success-ink";
  }

  return "border-line bg-surface text-ink";
}
