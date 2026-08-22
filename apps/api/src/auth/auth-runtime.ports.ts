import { randomBytes } from "node:crypto";

import { hashPassword, verifyPassword, type PasswordVerification } from "@yt-monitor/auth";

export interface Clock {
  now(): Date;
}

export interface EntropySource {
  bytes(length: number): Uint8Array;
}

export interface PasswordPort {
  verify(hash: string, password: string): Promise<PasswordVerification>;
  hash(password: string): Promise<string>;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export const systemEntropy: EntropySource = {
  bytes: (length) => new Uint8Array(randomBytes(length)),
};

export const systemPasswords: PasswordPort = {
  verify: verifyPassword,
  hash: hashPassword,
};
