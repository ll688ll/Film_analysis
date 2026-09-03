import axios from "axios";

const client = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: attach JWT token
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Why the server rejected the token, from the X-Auth-Error header. */
export type AuthFailureReason = "expired" | "invalid" | "inactive";

const AUTH_ERROR_REASONS: Record<string, AuthFailureReason> = {
  token_expired: "expired",
  invalid_token: "invalid",
  user_not_found: "invalid",
  user_inactive: "inactive",
};

let authFailureHandler: ((reason: AuthFailureReason) => void) | null = null;

/**
 * Let the auth context end the session itself, so it can navigate with the
 * router and explain what happened. Returns an unsubscribe function.
 */
export function setAuthFailureHandler(
  handler: (reason: AuthFailureReason) => void
): () => void {
  authFailureHandler = handler;
  return () => {
    if (authFailureHandler === handler) authFailureHandler = null;
  };
}

// Response interceptor: handle 401
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    // A rejected sign-in is a form error, not a lost session -- leave it to
    // the login page, which otherwise gets reloaded out from under its message.
    const url: string = error.config?.url ?? "";
    const isSignInAttempt =
      url.includes("/auth/login") || url.includes("/auth/register");

    if (status === 401 && !isSignInAttempt) {
      const code = error.response?.headers?.["x-auth-error"];
      // An older backend sends no code; a timed-out session is the common case.
      const reason = AUTH_ERROR_REASONS[code] ?? "expired";
      localStorage.removeItem("token");
      if (authFailureHandler) {
        authFailureHandler(reason);
      } else {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface RegisterResponse {
  id: number;
  username: string;
  email: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
}

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await client.post<LoginResponse>("/auth/login", {
    username,
    password,
  });
  return response.data;
}

export async function register(
  username: string,
  email: string,
  password: string
): Promise<RegisterResponse> {
  const response = await client.post<RegisterResponse>("/auth/register", {
    username,
    email,
    password,
  });
  return response.data;
}

export async function getMe(): Promise<User> {
  const response = await client.get<User>("/auth/me");
  return response.data;
}

export default client;
