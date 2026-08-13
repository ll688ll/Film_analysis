/**
 * A one-slot handoff of a saved analysis being reopened.
 *
 * The History page reopens an analysis server-side, then navigates to the Film
 * Dose tab. Both pages stay mounted (see `ProtectedTabs`), so the payload is
 * parked here rather than threaded through the router -- the same approach
 * `imageSession.ts` uses for cross-tab image sharing.
 *
 * AnalysisPage consumes the payload with `takePendingRestore`, which clears the
 * slot so a later tab switch cannot replay a stale restore.
 */

export interface SavedROI {
  roi_type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation_deg: number;
  hole_ratio: number;
  threshold: number;
  trim_enabled: boolean;
  trim_percent: number;
  corner_cut_enabled: boolean;
  corner_cut_mm: number;
}

export interface SavedStats {
  max: number | null;
  min: number | null;
  mean: number | null;
  std: number | null;
  cv: number | null;
  dur: number | null;
  flatness: number | null;
  pixel_count: number | null;
  center_x_mm: number | null;
  center_y_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  area_mm2: number | null;
  trim_enabled?: boolean;
  trim_percent?: number;
  corner_cut_mm?: number;
  roi_type?: string;
}

export interface ProfileInfo {
  id: number | null;
  name: string | null;
  deleted: boolean;
}

/** Summary row as returned by `GET /analysis/history`. */
export interface SavedAnalysis {
  id: number;
  original_filename: string;
  project_id: number | null;
  profile_id: number | null;
  profile: ProfileInfo;
  channel: string;
  a: number;
  b: number;
  c: number;
  dpi: number;
  image_width: number | null;
  image_height: number | null;
  cmap_min: number;
  cmap_max: number;
  colormap: string;
  notes: string;
  has_roi: boolean;
  has_file: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** Payload from `POST /analysis/saved/{id}/open`: a live session plus saved state. */
export interface RestorePayload extends SavedAnalysis {
  session_id: string;
  width: number;
  height: number;
  channels: number;
  image_channels: number | null;
  profile_snapshot: Record<string, unknown> | null;
  roi: SavedROI | null;
  stats: SavedStats | null;
}

let pending: RestorePayload | null = null;
const listeners = new Set<(p: RestorePayload) => void>();

export function setPendingRestore(payload: RestorePayload): void {
  pending = payload;
  listeners.forEach((fn) => fn(payload));
}

/** Consume the pending restore, clearing it so it is applied at most once. */
export function takePendingRestore(): RestorePayload | null {
  const payload = pending;
  pending = null;
  return payload;
}

export function subscribePendingRestore(
  fn: (p: RestorePayload) => void
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
