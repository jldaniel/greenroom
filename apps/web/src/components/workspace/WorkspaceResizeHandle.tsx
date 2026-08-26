import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export type ResizeHandleEdge = "left" | "right";

export function WorkspaceResizeHandle({
  ariaLabel,
  className,
  clampWidth,
  defaultWidth,
  edge,
  gripPosition = "center",
  maxWidth,
  minWidth,
  onWidthChange,
  title,
  width,
}: {
  ariaLabel: string;
  className: string;
  clampWidth: (width: number) => number;
  defaultWidth: number;
  edge: ResizeHandleEdge;
  gripPosition?: "center" | "viewport";
  maxWidth: number;
  minWidth: number;
  onWidthChange: (width: number) => void;
  title: string;
  width: number;
}) {
  const drag = useRef<{ pointerId: number; startWidth: number; startX: number } | null>(null);

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }

    drag.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    let nextWidth: number;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth = width + (edge === "left" ? step : -step);
        break;
      case "ArrowRight":
        nextWidth = width + (edge === "right" ? step : -step);
        break;
      case "Home":
        nextWidth = minWidth;
        break;
      case "End":
        nextWidth = maxWidth;
        break;
      default:
        return;
    }

    event.preventDefault();
    onWidthChange(clampWidth(nextWidth));
  };

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={minWidth}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      className={`group z-10 hidden touch-none cursor-col-resize focus-visible:outline-none 2xl:block ${className}`}
      onDoubleClick={() => onWidthChange(defaultWidth)}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onPointerCancel={stopDragging}
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, startWidth: width, startX: event.clientX };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;

        if (current === null || current.pointerId !== event.pointerId) {
          return;
        }

        const pointerDelta = event.clientX - current.startX;
        const widthDelta = edge === "right" ? pointerDelta : -pointerDelta;
        onWidthChange(clampWidth(current.startWidth + widthDelta));
      }}
      onPointerUp={stopDragging}
      role="separator"
      tabIndex={0}
      title={title}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
      <span
        className={
          gripPosition === "viewport"
            ? "sticky top-[calc(50vh-1.5rem)] mx-auto block h-12 w-1 rounded-full bg-line transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
            : "absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
        }
      />
    </div>
  );
}
