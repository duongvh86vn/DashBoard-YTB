"use client";

import type { PublicUser } from "@yt-monitor/shared/browser-auth";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  changePassword as requestPasswordChange,
  getCurrentUser,
  isUnauthenticatedError,
  login as requestLogin,
  logout as requestLogout,
} from "./api-client";

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: PublicUser }
  | { status: "error" };

interface AuthContextValue {
  state: AuthState;
  retryBootstrap(): void;
  login(email: string, password: string): Promise<PublicUser>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  handleApiError(error: unknown): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const bootstrapController = useRef<AbortController | null>(null);

  const retryBootstrap = useCallback(() => {
    bootstrapController.current?.abort();
    const controller = new AbortController();
    bootstrapController.current = controller;
    setState({ status: "loading" });

    void getCurrentUser(controller.signal)
      .then((user) => {
        if (!controller.signal.aborted) setState({ status: "authenticated", user });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(isUnauthenticatedError(error) ? { status: "anonymous" } : { status: "error" });
      });
  }, []);

  useEffect(() => {
    retryBootstrap();
    return () => bootstrapController.current?.abort();
  }, [retryBootstrap]);

  const login = useCallback(async (email: string, password: string) => {
    const user = await requestLogin(email, password);
    setState({ status: "authenticated", user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    await requestLogout();
    setState({ status: "anonymous" });
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await requestPasswordChange(currentPassword, newPassword);
    setState({ status: "anonymous" });
  }, []);

  const handleApiError = useCallback((error: unknown) => {
    if (!isUnauthenticatedError(error)) return false;
    setState({ status: "anonymous" });
    return true;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, retryBootstrap, login, logout, changePassword, handleApiError }),
    [changePassword, handleApiError, login, logout, retryBootstrap, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
