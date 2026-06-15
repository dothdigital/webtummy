// Thin API client. Real login (token in localStorage). The backend enforces JWT + RBAC.
let token: string | null = localStorage.getItem("wt_token");

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "client_admin" | "client_user";
  clientId: string | null;
}

export function getToken() {
  return token;
}

export async function login(email: string, password: string): Promise<AppUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Invalid email or password");
  const data = await res.json();
  token = data.token;
  localStorage.setItem("wt_token", token!);
  return data.user as AppUser;
}

export async function register(input: {
  name: string;
  companyName: string;
  email: string;
  password: string;
}): Promise<AppUser> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) {
    // surface field errors from zod
    const fe = data.error ?? {};
    const first = Object.values(fe).flat()[0] as string | undefined;
    throw new Error(first ?? "Registration failed");
  }
  token = data.token;
  localStorage.setItem("wt_token", token!);
  return data.user as AppUser;
}

export async function forgotPassword(email: string): Promise<string> {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Could not process request");
  return data.message as string;
}

export function logout() {
  token = null;
  localStorage.removeItem("wt_token");
}

export async function fetchMe(): Promise<AppUser | null> {
  if (!token) return null;
  const res = await fetch("/api/auth/me", { headers: authHeaders() });
  if (!res.ok) {
    logout();
    return null;
  }
  return (await res.json()).user as AppUser;
}

function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body: unknown) => request<T>(p, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
};
