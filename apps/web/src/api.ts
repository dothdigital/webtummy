// Thin API client. Browser authentication uses an HttpOnly session cookie. A
// legacy local token is accepted once so existing sessions migrate cleanly.
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
  token = null;
  localStorage.removeItem("wt_token");
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

type ApiErrorEnvelope = { error?: unknown; message?: unknown; missingRequirement?: unknown; errorCode?: unknown };

export function publicErrorMessage(value: unknown, fallback = "This action could not be completed. Please try again.") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  if (/safety[_ ]violations?|request was rejected by the safety system|\bsexual\b/i.test(raw)) {
    return "The content service could not process this page because its topic was interpreted without enough context. Confirm the page describes a legitimate professional service, then retry it; completed pages remain preserved.";
  }
  return raw
    .replace(/openai/gi, "the AI service")
    .replace(/\breq_[a-z0-9]+\b/gi, "")
    .replace(/contact us at help\.[^\s]+[^.]*\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || fallback;
}

function firstErrorText(value: unknown, depth = 0): string | null {
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
}

export function apiErrorMessage(data: unknown, fallback: string, res?: Response) {
  const envelope = data && typeof data === "object" && !Array.isArray(data) ? data as ApiErrorEnvelope : {};
  if (res?.status === 502) {
    const errorCode = typeof envelope.errorCode === "string" ? envelope.errorCode : res.headers.get("X-SEnuke-Error-Code");
    const publicMessage = firstErrorText(envelope.message) ?? firstErrorText(envelope.error);
    if (publicMessage && !/^we could not complete this request\b/i.test(publicMessage)) {
      return [publicErrorMessage(publicMessage, fallback), errorCode ? `Error code: ${errorCode}` : null].filter(Boolean).join("\n");
    }
    return [
      "The service is temporarily unavailable while the server recovers (502 Bad Gateway). Your action may still have completed. Wait a moment, refresh, and check its status before retrying.",
      errorCode ? `Error code: ${errorCode}` : null,
    ].filter(Boolean).join("\n");
  }
  // Some endpoints return a stable machine-readable `error` key alongside a
  // user-facing `message`. Prefer the explanation so internal identifiers such
  // as `growth_intelligence_stale_or_incomplete` never become the UI copy.
  const message = firstErrorText(envelope.message)
    ?? firstErrorText(envelope.missingRequirement)
    ?? firstErrorText(envelope.error)
    ?? fallback;
  const errorCode = typeof envelope.errorCode === "string"
    ? envelope.errorCode
    : res?.headers.get("X-SEnuke-Error-Code");
  const publicMessage = publicErrorMessage(message, fallback);
  if (!errorCode) return publicMessage;
  return [publicMessage, `Error code: ${errorCode}`].join("\n");
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
    commercialState: string;
    accessMode: string;
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

export function resetWelcome(workspaceId?: string | null) {
  if (workspaceId) sessionStorage.removeItem(WELCOME_WORKSPACE_PREFIX + workspaceId);
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
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status >= 500) throw new Error(apiErrorMessage(data, "Sign in is temporarily unavailable. Please try again.", res));
    throw new Error(data.error === "email_not_verified" ? "email_not_verified" : "Invalid email or password");
  }
  const data = await res.json();
  token = null;
  localStorage.removeItem("wt_token");
  markUserActivity();
  const authenticatedUser = data.user as AppUser;
  if (authenticatedUser.role === "super_admin") endImpersonation();
  if (authenticatedUser.firstLogin && authenticatedUser.workspace?.primaryOwner) localStorage.setItem(WELCOME_USER_KEY, authenticatedUser.id);
  rememberUser(authenticatedUser);
  return authenticatedUser;
}

export async function fetchPublicConfig(): Promise<{ recaptchaSiteKey: string; trialEnabled: boolean; trialDays: number }> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) return { recaptchaSiteKey: "", trialEnabled: false, trialDays: 14 };
  return res.json() as Promise<{ recaptchaSiteKey: string; trialEnabled: boolean; trialDays: number }>;
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
    throw new Error(res.status >= 500 ? apiErrorMessage(data, "Registration is temporarily unavailable. Please try again.", res) : first ?? "Registration failed");
  }
  return data.message as string;
}

export async function verifyEmail(verificationToken: string): Promise<AppUser> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verificationToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status >= 500 ? apiErrorMessage(data, "Email verification is temporarily unavailable. Please try again.", res) : data.error ?? "Verification link is invalid or expired");
  token = null;
  localStorage.removeItem("wt_token");
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
  if (!res.ok) throw new Error(res.status >= 500 ? apiErrorMessage(data, "Could not process request. Please try again.", res) : "Could not process request");
  return data.message as string;
}

export async function forgotPassword(email: string): Promise<string> {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(res.status >= 500 ? apiErrorMessage(data, "Could not process request. Please try again.", res) : "Could not process request");
  return data.message as string;
}

export async function resetPassword(resetToken: string, password: string): Promise<AppUser> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resetToken, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fe = data.error ?? {};
    const first = typeof fe === "string" ? fe : (Object.values(fe).flat()[0] as string | undefined);
    throw new Error(res.status >= 500 ? apiErrorMessage(data, "Password reset is temporarily unavailable. Please try again.", res) : first ?? "Could not reset password");
  }
  token = null;
  localStorage.removeItem("wt_token");
  return data.user as AppUser;
}

export function logout() {
  void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
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
  logout();
  notifySessionExpired();
}

export async function fetchMe(): Promise<AppUser | null> {
  const res = await fetch("/api/auth/me", { headers: authHeaders(), credentials: "same-origin" });
  captureRenewedSession(res);
  if (!res.ok) {
    if (res.status === 401) {
      expireSession();
      return null;
    }
    const data = await readJson(res).catch(() => ({}));
    throw new Error(apiErrorMessage(data, "Session validation is temporarily unavailable.", res));
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
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  captureRenewedSession(res);
  if (!res.ok) {
    const data = await readJson(res).catch(() => ({}));
    if (res.status === 401) expireSession();
    throw new Error(apiErrorMessage(data, "Request failed. Please try again.", res));
  }
  return res.json() as Promise<T>;
}

async function download(path: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
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
    throw new Error(apiErrorMessage(data, "Download failed. Please try again.", res));
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "project-report.pdf";
  const href = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function preview(path: string) {
  const previewWindow = window.open("", "_blank");
  try {
    const res = await fetch(path, { headers: authHeaders() });
    captureRenewedSession(res);
    if (!res.ok) {
      const data = await readJson(res).catch(() => ({}));
      if (res.status === 401) expireSession();
      throw new Error(apiErrorMessage(data, "Preview failed. Please try again.", res));
    }
    const href = URL.createObjectURL(await res.blob());
    if (previewWindow) previewWindow.location.href = href;
    else window.open(href, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch (error) {
    previewWindow?.close();
    throw error;
  }
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body: unknown, init: RequestInit = {}) => request<T>(p, { ...init, method: "POST", body: JSON.stringify(body) }),
  put: <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(p: string, body?: unknown) => request<T>(p, { method: "DELETE", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  download,
  preview,
};
