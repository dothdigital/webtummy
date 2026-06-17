// Auth context: holds the current user, exposes login/logout.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  verifyEmail as apiVerifyEmail,
  resetPassword as apiResetPassword,
  fetchMe,
  type AppUser,
} from "./api.js";

interface AuthCtx {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; companyName: string; email: string; password: string }) => Promise<string>;
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
    fetchMe()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    setUser(await apiLogin(email, password));
  };
  const register = async (input: { name: string; companyName: string; email: string; password: string }) => {
    return apiRegister(input);
  };
  const verifyEmail = async (token: string) => {
    setUser(await apiVerifyEmail(token));
  };
  const resetPassword = async (token: string, password: string) => {
    setUser(await apiResetPassword(token, password));
  };
  const logout = () => {
    apiLogout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, verifyEmail, resetPassword, logout }}>{children}</Ctx.Provider>;
}
