// Auth context: holds the current user, exposes login/logout.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  verifyEmail as apiVerifyEmail,
  resetPassword as apiResetPassword,
  fetchMe,
  SESSION_EXPIRED_EVENT,
  type AppUser,
} from "./api.js";
import { bindBackgroundJobsScope } from "./background-jobs.js";

interface AuthCtx {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; workspaceType: string; email: string; password: string; captchaToken?: string }) => Promise<string>;
  verifyEmail: (token: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onSessionExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    fetchMe()
      .then((nextUser) => {
        bindBackgroundJobsScope(`${nextUser.id}:${nextUser.workspace?.id ?? "no-workspace"}`);
        setUser(nextUser);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  const login = async (email: string, password: string) => {
    const nextUser = await apiLogin(email, password);
    bindBackgroundJobsScope(`${nextUser.id}:${nextUser.workspace?.id ?? "no-workspace"}`);
    setUser(nextUser);
  };
  const register = async (input: { name: string; workspaceType: string; email: string; password: string; captchaToken?: string }) => {
    return apiRegister(input);
  };
  const verifyEmail = async (token: string) => {
    await apiVerifyEmail(token);
    apiLogout();
    setUser(null);
  };
  const resetPassword = async (token: string, password: string) => {
    await apiResetPassword(token, password);
    apiLogout();
    setUser(null);
  };
  const logout = () => {
    apiLogout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, verifyEmail, resetPassword, logout }}>{children}</Ctx.Provider>;
}
