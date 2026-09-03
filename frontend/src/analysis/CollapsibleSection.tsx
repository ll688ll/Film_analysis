import { useId, type ReactNode } from "react";
import { IconChevronDown, IconChevronLeft } from "./panelIcons";

interface CollapsibleSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Short status shown at the right of the header, e.g. the ROI shape. */
  summary?: ReactNode;
  children: ReactNode;
}

/** A panel section whose header folds its body away. */
export default function CollapsibleSection({
  title,
  open,
  onToggle,
  summary,
  children,
}: CollapsibleSectionProps) {
  const bodyId = useId();
  return (
    <div className="border-b border-slate-600">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-600/40 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {title}
        </span>
        <span className="flex items-center gap-2 min-w-0">
          {summary && (
            <span className="text-xs text-slate-500 font-mono truncate">
              {summary}
            </span>
          )}
          <span className="text-slate-400">
            {open ? <IconChevronDown /> : <IconChevronLeft />}
          </span>
        </span>
      </button>
      {open && <div id={bodyId}>{children}</div>}
    </div>
  );
}
