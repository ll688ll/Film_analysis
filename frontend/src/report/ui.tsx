/** Small shared pieces of the report page. */

import type { ReactNode } from "react";

export const buttonClass =
  "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white transition-colors";

export const inputClass =
  "px-2 py-1 text-xs border border-slate-300 rounded text-slate-800 bg-white text-right";

export const segmentClass = (active: boolean) =>
  `flex-1 px-2 py-1 text-xs font-medium transition-colors ${
    active ? "bg-sky-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
  }`;

interface SectionProps {
  id: string;
  title: string;
  /** Right-hand toolbar. */
  actions?: ReactNode;
  children: ReactNode;
  /** Start a new page when printed. */
  pageBreak?: boolean;
}

export function Section({ id, title, actions, children, pageBreak }: SectionProps) {
  return (
    <section
      id={id}
      className={`report-section bg-white border border-slate-200 rounded-lg p-5 mb-5 ${
        pageBreak ? "report-section-break" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-slate-500 leading-relaxed">{children}</p>;
}

export function LineSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
      <line x1="1" x2="17" y1="4" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} />
    </svg>
  );
}

export const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 12.5h11" />
  </svg>
);

export const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
);
