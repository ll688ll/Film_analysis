/**
 * A one-slot handoff of the most recently uploaded image.
 *
 * `ProtectedTabs` keeps every page mounted with its own session state, so the
 * Film Dose and Image pages each upload independently. This lets the Image
 * page offer "Use image from the Film Dose tab" without either page owning the
 * other's state -- a full shared-session context would mean refactoring
 * AnalysisPage for no benefit here.
 */

export interface SharedImageSession {
  sessionId: string;
  filename: string;
  width: number;
  height: number;
  /** Blob URL of the JPEG preview, or null if it was never fetched. */
  previewUrl: string | null;
  source: "analysis" | "imaging";
}

let current: SharedImageSession | null = null;
const listeners = new Set<(s: SharedImageSession | null) => void>();

export function getSharedSession(): SharedImageSession | null {
  return current;
}

export function setSharedSession(session: SharedImageSession | null): void {
  current = session;
  listeners.forEach((fn) => fn(current));
}

export function subscribeSharedSession(
  fn: (s: SharedImageSession | null) => void
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
