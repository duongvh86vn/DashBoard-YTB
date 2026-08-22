import type { PublicUser } from "@yt-monitor/auth";

export const USERS_APPLICATION_PORT = Symbol("USERS_APPLICATION_PORT");

export interface UsersApplicationPort {
  list(input: { page: number; pageSize: number }): Promise<{
    items: PublicUser[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  create(input: { actorUserId: string; email: string; password: string }): Promise<PublicUser>;
  updateEmail(input: {
    actorUserId: string;
    targetUserId: string;
    email: string;
  }): Promise<PublicUser>;
  resetPassword(input: {
    actorUserId: string;
    targetUserId: string;
    password: string;
  }): Promise<void>;
  revokeSessions(input: { actorUserId: string; targetUserId: string }): Promise<void>;
  disable(input: {
    actorUserId: string;
    targetUserId: string;
    via: "DISABLE_ENDPOINT" | "DELETE_ALIAS";
  }): Promise<void>;
  enable(input: { actorUserId: string; targetUserId: string }): Promise<void>;
}
