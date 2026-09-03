import {
  useCallback,
  useId,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TransitionEvent,
} from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  iconButtonClass,
} from "../analysis/panelIcons";

export const SIDE_PANEL_DEFAULT_WIDTH = 384;
export const SIDE_PANEL_MIN_WIDTH = 300;
export const SIDE_PANEL_MAX_WIDTH = 760;
const RAIL_WIDTH = 40;

export function clampPanelWidth(width: number): number {
  return Math.round(
    Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(SIDE_PANEL_MAX_WIDTH, width))
  );
}

interface SidePanelProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Expanded width in px; drag the left edge to change it. */
  width: number;
  onWidthChange: (width: number) => void;
  /** Buttons shown in the slim rail while collapsed (one per view). */
  rail: ReactNode;
  children: ReactNode;
}

/**
 * Right-hand tool panel that folds to a 40 px icon rail and can be resized
 * by dragging its left edge.
 *
 * Only the expanded body is mounted, so charts inside it always size
 * against a real container. Plotly's `useResizeHandler` listens to window
 * resize events only, hence the synthetic one at the end of the width
 * transition and after a drag.
 */
export default function SidePanel({
  title,
  collapsed,
  onCollapsedChange,
  width,
  onWidthChange,
  rail,
  children,
}: SidePanelProps) {
  const bodyId = useId();
  const [dragging, setDragging] = useState(false);

  const handleTransitionEnd = (e: TransitionEvent<HTMLElement>) => {
    if (e.propertyName === "width") window.dispatchEvent(new Event("resize"));
  };

  const startResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      setDragging(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const move = (ev: PointerEvent) => {
        // The edge is on the left: dragging left makes the panel wider
        onWidthChange(clampPanelWidth(startWidth + (startX - ev.clientX)));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setDragging(false);
        window.dispatchEvent(new Event("resize"));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [width, onWidthChange]
  );

  return (
    <aside
      aria-label={title}
      onTransitionEnd={handleTransitionEnd}
      style={{ width: collapsed ? RAIL_WIDTH : width }}
      className={`relative flex-shrink-0 bg-slate-700 border-l border-slate-600 ${
        dragging ? "" : "transition-[width] duration-200 ease-out"
      }`}
    >
      {/* Grab zone straddling the edge: 4 px over the canvas, 6 px inside */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={width}
          aria-valuemin={SIDE_PANEL_MIN_WIDTH}
          aria-valuemax={SIDE_PANEL_MAX_WIDTH}
          title="Drag to resize · double-click to reset"
          onPointerDown={startResize}
          onDoubleClick={() => onWidthChange(SIDE_PANEL_DEFAULT_WIDTH)}
          className={`absolute -left-1 top-0 h-full w-2.5 z-20 cursor-col-resize group ${
            dragging ? "bg-sky-500/40" : "hover:bg-sky-500/20"
          }`}
        >
          <span
            className={`absolute inset-y-0 left-1 w-0.5 ${
              dragging ? "bg-sky-400" : "bg-transparent group-hover:bg-sky-400"
            }`}
          />
        </div>
      )}

      <div className="h-full flex flex-col overflow-hidden">
        {collapsed ? (
          <nav
            aria-label={`${title} views`}
            className="flex flex-col items-center gap-1 pt-1"
          >
            <button
              type="button"
              onClick={() => onCollapsedChange(false)}
              title="Expand panel"
              aria-label="Expand panel"
              aria-expanded={false}
              aria-controls={bodyId}
              className={iconButtonClass}
            >
              <IconChevronLeft />
            </button>
            <div className="w-6 h-px bg-slate-600 my-1" />
            {rail}
          </nav>
        ) : (
          <>
            <div className="h-9 flex-none flex items-center justify-between pl-3 pr-1.5 border-b border-slate-600">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {title}
              </span>
              <button
                type="button"
                onClick={() => onCollapsedChange(true)}
                title="Collapse panel"
                aria-label="Collapse panel"
                aria-expanded
                aria-controls={bodyId}
                className={iconButtonClass}
              >
                <IconChevronRight />
              </button>
            </div>
            <div id={bodyId} className="flex-1 min-h-0 overflow-y-auto">
              {children}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
