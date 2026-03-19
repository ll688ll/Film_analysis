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

// Response interceptor: handle 401
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
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
