import type { PublicUser } from "@yt-monitor/auth";

export const AUTH_APPLICATION_PORT = Symbol("AUTH_APPLICATION_PORT");

export interface AuthApplicationPort {
  login(input: {
    email: string;
    password: string;
  }): Promise<{ user: PublicUser; sessionToken: string }>;
  logout(input: { userId: string; sessionId: string }): Promise<void>;
  changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void>;
}
