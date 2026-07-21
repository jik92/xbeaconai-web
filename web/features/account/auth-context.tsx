import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiBaseUrl } from "@/api/base-url";
import { client } from "@/api/generated/client.gen";
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  sendSmsVerificationCode,
  setupPassword as setupPasswordRequest,
  verifyPasswordReset as verifyPasswordResetRequest,
} from "@/api/generated/sdk.gen";
import type { PasswordSetupChallenge, UserSummary } from "@/api/generated/types.gen";

const TOKEN_KEY = "yaozuo:auth-token:v1";

export function getAuthToken() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

function configureClient(token = getAuthToken()) {
  client.setConfig({
    baseUrl: apiBaseUrl(),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

type Credentials = { phone: string; password: string };
type VerificationInput = { phone: string; verificationCode: string };
type SmsPurpose = "register" | "reset_password";
type AuthContextValue = {
  status: "loading" | "anonymous" | "authenticated";
  user?: UserSummary;
  login: (input: Credentials) => Promise<void>;
  register: (input: VerificationInput) => Promise<PasswordSetupChallenge>;
  verifyPasswordReset: (input: VerificationInput) => Promise<PasswordSetupChallenge>;
  setupPassword: (input: { setupToken: string; password: string }) => Promise<void>;
  sendVerificationCode: (
    phone: string,
    purpose: SmsPurpose,
  ) => Promise<{ expiresAt: string; retryAfterSeconds: number; verificationCode: string }>;
  logout: () => Promise<void>;
  setUser: (user: UserSummary) => void;
  refresh: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [user, setUserState] = useState<UserSummary>();
  const accept = useCallback((token: string, nextUser: UserSummary) => {
    localStorage.setItem(TOKEN_KEY, token);
    configureClient(token);
    setUserState(nextUser);
    setStatus("authenticated");
  }, []);
  const clear = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    configureClient(null);
    setUserState(undefined);
    setStatus("anonymous");
  }, []);
  const refresh = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      clear();
      return;
    }
    configureClient(token);
    try {
      const { data } = await getCurrentUser({ throwOnError: true });
      if (!data) throw new Error("登录状态无效");
      setUserState(data.user);
      setStatus("authenticated");
    } catch {
      clear();
    }
  }, [clear]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const login = useCallback(
    async (input: Credentials) => {
      configureClient(null);
      const { data } = await loginRequest({ body: input, throwOnError: true });
      if (!data) throw new Error("登录失败");
      accept(data.token, data.user);
    },
    [accept],
  );
  const register = useCallback(async (input: VerificationInput) => {
    configureClient(null);
    const { data } = await registerRequest({ body: input, throwOnError: true });
    if (!data) throw new Error("注册失败");
    return data;
  }, []);
  const verifyPasswordReset = useCallback(async (input: VerificationInput) => {
    configureClient(null);
    const { data } = await verifyPasswordResetRequest({ body: input, throwOnError: true });
    if (!data) throw new Error("手机号验证失败");
    return data;
  }, []);
  const setupPassword = useCallback(
    async (input: { setupToken: string; password: string }) => {
      configureClient(null);
      const { data } = await setupPasswordRequest({ body: input, throwOnError: true });
      if (!data) throw new Error("密码设置失败");
      accept(data.token, data.user);
    },
    [accept],
  );
  const sendVerificationCode = useCallback(async (phone: string, purpose: SmsPurpose) => {
    configureClient(null);
    const { data } = await sendSmsVerificationCode({ body: { phone, purpose }, throwOnError: true });
    if (!data) throw new Error("验证码发送失败");
    return data;
  }, []);
  const logout = useCallback(async () => {
    try {
      configureClient();
      await logoutRequest({ throwOnError: true });
    } catch {
      /* local logout must still complete when the server session already expired */
    } finally {
      clear();
    }
  }, [clear]);
  const value = useMemo(
    () => ({
      status,
      user,
      login,
      register,
      verifyPasswordReset,
      setupPassword,
      sendVerificationCode,
      logout,
      setUser: setUserState,
      refresh,
    }),
    [status, user, login, register, verifyPasswordReset, setupPassword, sendVerificationCode, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}

export function apiErrorMessage(error: unknown, fallback = "操作失败") {
  if (error && typeof error === "object") {
    const candidate = error as { error?: { message?: string }; message?: string };
    return candidate.error?.message ?? candidate.message ?? fallback;
  }
  return fallback;
}
