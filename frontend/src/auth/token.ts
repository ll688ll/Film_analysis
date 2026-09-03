/**
 * Reading the session's end time out of the JWT. The `exp` claim is already
 * in the token the app stores, so there is nothing to ask the server for --
 * and it survives a page reload, unlike anything held in React state.
 */

/** Milliseconds since the epoch when the token stops being accepted. */
export function tokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    // A token we cannot read is not automatically invalid -- the server is the
    // authority. Fall back to letting the next 401 end the session.
    return null;
  }
}

export function isTokenExpired(token: string | null): boolean {
  const expiry = tokenExpiryMs(token);
  return expiry !== null && expiry <= Date.now();
}
