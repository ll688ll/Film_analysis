import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The last-two-minutes warning. There is no token refresh, so the useful
 * thing this can offer is time to save work before the session drops.
 */
export default function SessionExpiryBanner() {
  const { expiringSoon, expiresAt, logout } = useAuth();
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiringSoon || expiresAt === null) return;
    const tick = () => setRemaining(expiresAt - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiringSoon, expiresAt]);

  if (!expiringSoon || expiresAt === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2 bg-amber-400 border-b border-amber-500 text-amber-950 text-sm font-medium"
    >
      <span>
        Your session ends in{" "}
        <span className="font-mono font-semibold">{mmss(remaining)}</span>. Save
        anything you need — you will be returned to the sign-in screen.
      </span>
      <button
        type="button"
        onClick={logout}
        className="shrink-0 px-3 py-1 text-xs font-semibold rounded-md border border-amber-700 text-amber-900 hover:bg-amber-300 transition-colors"
      >
        Sign in again
      </button>
    </div>
  );
}
