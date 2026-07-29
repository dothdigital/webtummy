// Thin API client. Real login (token in localStorage). The backend enforces JWT + RBAC.
let token: string | null = localStorage.getItem("wt_token");
let activeClientId: string | null = localStorage.getItem("wt_active_client_id");
let currentRole: AppUser["role"] | null = localStorage.getItem("wt_role") as AppUser["role"] | null;
let impersonationLabel: string | null = localStorage.getItem("wt_impersonation_label");
const LAST_ACTIVITY_KEY = "wt_last_user_activity_at";
const ACTIVE_RENEWAL_WINDOW_MS = 5 * 60 * 1000;
let lastUserActivityAt = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now();
export const SESSION_EXPIRED_EVENT = "senuke-ai:session-expired";
export const ACTIVE_CLIENT_EVENT = "senuke-ai:active-client-changed";
const WELCOME_USER_KEY = "wt_welcome_user_id";
const WELCOME_WORKSPACE_PREFIX = "wt_welcome_completed_workspace:";

function markUserActivity() {
  lastUserActivityAt = Date.now();
  localStorage.setItem(LAST_ACTIVITY_KEY, String(lastUserActivityAt));
}

// Loading or returning to the application is itself deliberate activity.
markUserActivity();
for (const eventName of ["pointerdown", "keydown", "touchstart"] as const) {
  window.addEventListener(eventName, markUserActivity, { passive: true });
}
window.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") markUserActivity(); });

function captureRenewedSession(res: Response) {
  const renewed = res.headers.get("X-SEnuke-Session-Token");
  if (!renewed || Date.now() - lastUserActivityAt > ACTIVE_RENEWAL_WINDOW_MS) return;
  token = renewed;
  localStorage.setItem("wt_token", renewed);
}

async function readJson(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Invalid server response" : "Server returned an HTML error page. Please try again.");
  }
}

function notifySessionExpired() {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "client_admin" | "client_user";
  clientId: string | null;
  firstLogin?: boolean;
  workspace: {
    id: string;
    name: string;
    type: string;
    membershipId: string;
    roles: string[];
    primaryRole: "admin" | "manager" | "editor" | "viewer" | "client_viewer";
    primaryOwner: boolean;
    onboardingRequired: boolean;
    landingPath: string;
    capabilities: {
      manageWorkspace: boolean; manageProjects: boolean; assignTasks: boolean; approve: boolean;
      edit: boolean; publish: boolean; billing: boolean; viewInternal: boolean;
      permissions: Record<string, boolean>;
      approvalMode?: "solo" | "team";
    };
  } | null;
}

export function getToken() {
  return token;
}

export function welcomePending(userId: string, workspaceId?: string | null) {
  if (workspaceId) return sessionStorage.getItem(WELCOME_WORKSPACE_PREFIX + workspaceId) !== "true";
  return localStorage.getItem(WELCOME_USER_KEY) === userId;
}

export function completeWelcome(workspaceId?: string | null) {
  if (workspaceId) sessionStorage.setItem(WELCOME_WORKSPACE_PREFIX + workspaceId, "true");
  localStorage.removeItem(WELCOME_USER_KEY);
}

export function getActiveClientId() {
  return activeClientId;
}

export function setActiveClientId(clientId: string | null) {
  activeClientId = clientId;
  if (clientId) localStorage.setItem("wt_active_client_id", clientId);
  else localStorage.removeItem("wt_active_client_id");
  window.dispatchEvent(new Event(ACTIVE_CLIENT_EVENT));
}

export function getImpersonationLabel() {
  return impersonationLabel;
}

export function startImpersonation(clientId: string, label: string) {
  impersonationLabel = label;
  localStorage.setItem("wt_impersonation_label", label);
  setActiveClientId(clientId);
}

export function endImpersonation() {
  impersonationLabel = null;
  localStorage.removeItem("wt_impersonation_label");
  setActiveClientId(null);
}

function rememberUser(user: AppUser) {
  currentRole = user.role;
  localStorage.setItem("wt_role", user.role);
  if (user.role === "super_admin" && activeClientId && !impersonationLabel) {
    setActiveClientId(null);
  }
}

function clearRememberedUser() {
  currentRole = null;
  localStorage.removeItem("wt_role");
}

export async function login(email: string, password: string): Promise<AppUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error === "email_not_verified" ? "email_not_verified" : "Invalid email or password");
  }
  const data = await res.json();
  token = data.token;
  localStorage.setItem("wt_token", token!);
  markUserActivity();
  const authenticatedUser = data.user as AppUser;
  if (authenticatedUser.role === "super_admin") endImpersonation();
  if (authenticatedUser.firstLogin && authenticatedUser.workspace?.primaryOwner) localStorage.setItem(WELCOME_USER_KEY, authenticatedUser.id);
  rememberUser(authenticatedUser);
  return authenticatedUser;
}

export async function fetchPublicConfig(): Promise<{ recaptchaSiteKey: string }> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) return { recaptchaSiteKey: "" };
  return res.json() as Promise<{ recaptchaSiteKey: string }>;
}

export async function register(input: {
  name: string;
  workspaceType: string;
  email: string;
  password: string;
  captchaToken?: string;
}): Promise<string> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(res);
  if (!res.ok) {
    // surface field errors from zod
    const fe = data.error ?? {};
    const first = Object.values(fe).flat()[0] as string | undefined;
    throw new Error(first ?? "Registration failed");
  }
  return data.message as string;
}

export async function verifyEmail(verificationToken: string): Promise<AppUser> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verificationToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Verification link is invalid or expired");
  token = data.token;
  localStorage.setItem("wt_token", token!);
  rememberUser(data.user as AppUser);
  return data.user as AppUser;
}

export async function resendVerification(email: string): Promise<string> {
  const res = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Could not process request");
  return data.message as string;
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

export async function resetPassword(resetToken: string, password: string): Promise<AppUser> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fe = data.error ?? {};
    const first = typeof fe === "string" ? fe : (Object.values(fe).flat()[0] as string | undefined);
    throw new Error(first ?? "Could not reset password");
  }
  token = data.token;
  localStorage.setItem("wt_token", token!);
  return data.user as AppUser;
}

export function logout() {
  token = null;
  activeClientId = null;
  localStorage.removeItem("wt_token");
  localStorage.removeItem("wt_active_client_id");
  localStorage.removeItem("wt_impersonation_label");
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  impersonationLabel = null;
  clearRememberedUser();
}

function expireSession() {
  if (token || localStorage.getItem("wt_token")) {
    logout();
    notifySessionExpired();
  }
}

export async function fetchMe(): Promise<AppUser | null> {
  if (!token) return null;
  const res = await fetch("/api/auth/me", { headers: authHeaders() });
  captureRenewedSession(res);
  if (!res.ok) {
    if (res.status === 401) {
      expireSession();
      return null;
    }
    throw new Error("Session validation is temporarily unavailable.");
  }
  const user = (await res.json()).user as AppUser;
  rememberUser(user);
  return user;
}

function authHeaders(): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeClientId && impersonationLabel ? { "X-SEnuke-AI-Client-Id": activeClientId } : {}),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  captureRenewedSession(res);
  if (!res.ok) {
    const data = await readJson(res).catch(() => ({}));
    if (res.status === 401) expireSession();
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") throw new Error(error);
    const firstErrorText = (value: unknown, depth = 0): string | null => {
      if (typeof value === "string" && value.trim()) return value;
      if (depth > 5) return null;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = firstErrorText(item, depth + 1);
          if (found) return found;
        }
        return null;
      }
      if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
          const found = firstErrorText(item, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };
    const firstFieldError = firstErrorText(error);
    throw new Error(firstFieldError ?? "Request failed. Please try again.");
  }
  return res.json() as Promise<T>;
}

async function download(path: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  captureRenewedSession(res);
  if (!res.ok) {
    const data = await readJson(res).catch(() => ({}));
    if (res.status === 401) expireSession();
    throw new Error(typeof data.error === "string" ? data.error : "Download failed. Please try again.");
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "project-report.pdf";
  const href = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body: unknown, init: RequestInit = {}) => request<T>(p, { ...init, method: "POST", body: JSON.stringify(body) }),
  put: <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(p: string, body?: unknown) => request<T>(p, { method: "DELETE", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  download,
};
