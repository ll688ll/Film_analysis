/**
 * Inline stroke icons for the ROI panel (the app draws every icon inline),
 * plus the tab list and the shared toolbar button style.
 */

import type { ReactElement, ReactNode } from "react";
import type { RoiTab } from "./roiTypes";

interface IconProps {
  size?: number;
  className?: string;
}

function Icon({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}><path d="M10 3.5 5.5 8 10 12.5" /></Icon>
);
export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}><path d="M6 3.5 10.5 8 6 12.5" /></Icon>
);
export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}><path d="M3.5 6 8 10.5 12.5 6" /></Icon>
);
export const IconStats = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6.5h12M2 9.75h12M7 6.5v6.5" />
  </Icon>
);
export const IconHistogram = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 13.5V8.5M6.2 13.5V3.5M9.8 13.5V6.5M13.5 13.5V10M2 13.5h12" /></Icon>
);
export const IconContour = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="8" cy="8" rx="6" ry="4.6" />
    <ellipse cx="8.4" cy="7.8" rx="3.2" ry="2.2" />
  </Icon>
);
export const IconProfiles = (p: IconProps) => (
  <Icon {...p}><path d="M2 12.5c2.6 0 3-8.5 6-8.5s3.4 8.5 6 8.5M2 12.5h12" /></Icon>
);
export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Icon>
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p}><path d="M3 8.5 6.5 12 13 4.5" /></Icon>
);
export const IconDownload = (p: IconProps) => (
  <Icon {...p}><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 12.5h11" /></Icon>
);

export const PANEL_TABS: Array<{
  key: RoiTab;
  label: string;
  Icon: (p: IconProps) => ReactElement;
}> = [
  { key: "stats", label: "Stats", Icon: IconStats },
  { key: "histogram", label: "Histogram", Icon: IconHistogram },
  { key: "contour", label: "Contour", Icon: IconContour },
  { key: "profiles", label: "Profiles", Icon: IconProfiles },
];

/** Small bordered button used in panel toolbars (Copy, CSV, …). */
export const toolbarButtonClass =
  "inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:hover:bg-slate-800 transition-colors";

/** Icon-only button used in the panel header and the collapsed rail. */
export const iconButtonClass =
  "inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-300 hover:bg-slate-600 hover:text-white transition-colors";
