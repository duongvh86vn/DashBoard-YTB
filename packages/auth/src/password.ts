import argon2 from "argon2";

const MIN_PASSWORD_CODE_POINTS = 12;
const MAX_PASSWORD_CODE_POINTS = 128;
const MAX_CANONICAL_EMAIL_LENGTH = 320;
const CANONICAL_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DATABASE_UNSAFE_EMAIL_PATTERN = /[\p{Cc}\p{Cs}]/u;

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  version: 0x13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

function hasCurrentPhcShape(hash: string): boolean {
  const fields = hash.split("$");

  return (
    fields[1] === "argon2id" &&
    Buffer.from(fields[4] ?? "", "base64").byteLength >= 16 &&
    Buffer.from(fields[5] ?? "", "base64").byteLength === ARGON2_OPTIONS.hashLength
  );
}

export class AuthInputError extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "AuthInputError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidCanonicalEmail(email: string): boolean {
  return (
    email.length > 0 &&
    email.length <= MAX_CANONICAL_EMAIL_LENGTH &&
    !DATABASE_UNSAFE_EMAIL_PATTERN.test(email) &&
    CANONICAL_EMAIL_PATTERN.test(email)
  );
}

export function assertPasswordPolicy(password: string): void {
  const codePointLength = Array.from(password).length;

  if (codePointLength < MIN_PASSWORD_CODE_POINTS || codePointLength > MAX_PASSWORD_CODE_POINTS) {
    throw new AuthInputError("Password must contain between 12 and 128 Unicode characters");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return hashWithCurrentParameters(password);
}

async function hashWithCurrentParameters(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function rehashVerifiedPassword(password: string): Promise<string> {
  return hashWithCurrentParameters(password);
}

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<PasswordVerification> {
  try {
    const valid = await argon2.verify(hash, password);

    if (!valid) {
      return { valid: false, needsRehash: false };
    }

    return {
      valid: true,
      needsRehash: !hasCurrentPhcShape(hash) || argon2.needsRehash(hash, ARGON2_OPTIONS),
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}
