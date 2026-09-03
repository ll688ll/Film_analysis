import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api/client";
import { setAuthFailureHandler, type AuthFailureReason } from "../api/client";
import { isTokenExpired, tokenExpiryMs } from "./token";

/** How long before the end of the session the warning banner appears. */
export const EXPIRY_WARNING_MS = 2 * 60 * 1000;

interface User {
  id: number;
  username: string;
  email: string;
}

export type SessionEndReason = AuthFailureReason;

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  logout: () => void;
  /** Wall-clock ms at which the current token stops being accepted. */
  expiresAt: number | null;
  /** True once inside the last EXPIRY_WARNING_MS of the session. */
  expiringSoon: boolean;
  /** Why the previous session ended, for the login screen to explain. */
  endedReason: SessionEndReason | null;
  dismissEndedReason: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token")
  );
  const [loading, setLoading] = useState(true);
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [endedReason, setEndedReason] = useState<SessionEndReason | null>(null);

  const isAuthenticated = !!token && !!user;
  const expiresAt = useMemo(() => tokenExpiryMs(token), [token]);

  /**
   * Drop the session and go back to the login screen. A null reason is a
   * deliberate sign-out, which needs no explanation.
   */
  const endSession = useCallback(
    (reason: SessionEndReason | null) => {
      localStorage.removeItem("token");
      setToken(null);
      setUser(null);
      setExpiringSoon(false);
      setEndedReason(reason);
      navigate("/login", { replace: true });
    },
    [navigate]
  );

  // A ref keeps the interceptor and the timers off endSession's identity.
  const endSessionRef = useRef(endSession);
  endSessionRef.current = endSession;

  // Let a 401 from anywhere in the app end the session through the router
  // instead of a hard window.location reload.
  useEffect(
    () =>
      setAuthFailureHandler((reason) => {
        endSessionRef.current(reason);
      }),
    []
  );

  // Validate an existing token on mount.
  useEffect(() => {
    const stored = localStorage.getItem("token");
    if (!stored) {
      setLoading(false);
      return;
    }
    if (isTokenExpired(stored)) {
      // No point spending a round trip to be told what the token already says.
      endSessionRef.current("expired");
      setLoading(false);
      return;
    }
    api
      .getMe()
      .then(setUser)
      .catch(() => {
        // The interceptor has already ended the session with a reason.
      })
      .finally(() => setLoading(false));
  }, []);

  // End the session the moment the token expires, rather than at whatever
  // later point the user happens to make a request.
  useEffect(() => {
    if (!token || expiresAt === null) return;

    let warnTimer: number | undefined;
    let endTimer: number | undefined;

    const schedule = () => {
      window.clearTimeout(warnTimer);
      window.clearTimeout(endTimer);
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        endSessionRef.current("expired");
        return;
      }
      setExpiringSoon(remaining <= EXPIRY_WARNING_MS);
      if (remaining > EXPIRY_WARNING_MS) {
        warnTimer = window.setTimeout(
          () => setExpiringSoon(true),
          remaining - EXPIRY_WARNING_MS
        );
      }
      endTimer = window.setTimeout(
        () => endSessionRef.current("expired"),
        remaining
      );
    };

    schedule();

    // Timers do not run while the machine sleeps, so re-check on the way back.
    const recheck = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);

    return () => {
      window.clearTimeout(warnTimer);
      window.clearTimeout(endTimer);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [token, expiresAt]);

  // Signing out in one tab signs out the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "token" && e.newValue === null && token) {
        endSessionRef.current(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.login(username, password);
    const newToken = response.access_token;
    localStorage.setItem("token", newToken);
    setToken(newToken);
    setEndedReason(null);
    setExpiringSoon(false);

    const userData = await api.getMe();
    setUser(userData);
  }, []);

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      await api.register(username, email, password);
      // After registration, log the user in automatically
      const response = await api.login(username, password);
      const newToken = response.access_token;
      localStorage.setItem("token", newToken);
      setToken(newToken);
      setEndedReason(null);
      setExpiringSoon(false);

      const userData = await api.getMe();
      setUser(userData);
    },
    []
  );

  const logout = useCallback(() => endSession(null), [endSession]);

  const dismissEndedReason = useCallback(() => setEndedReason(null), []);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated,
      loading,
      login,
      register,
      logout,
      expiresAt,
      expiringSoon,
      endedReason,
      dismissEndedReason,
    }),
    [
      user,
      token,
      isAuthenticated,
      loading,
      login,
      register,
      logout,
      expiresAt,
      expiringSoon,
      endedReason,
      dismissEndedReason,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/** The sentence the login screen shows after an involuntary sign-out. */
export function sessionEndMessage(reason: SessionEndReason): string {
  switch (reason) {
    case "expired":
      return "Your session timed out. Please sign in again to continue.";
    case "inactive":
      return "This account has been disabled. Contact an administrator.";
    default:
      return "Your sign-in is no longer valid. Please sign in again.";
  }
}
