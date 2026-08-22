import { BadRequestException } from "@nestjs/common";
import { assertPasswordPolicy, isValidCanonicalEmail, normalizeEmail } from "@yt-monitor/auth";
import { z } from "zod";

const createUserSchema = z.strictObject({
  email: z.string(),
  password: z.string(),
});
const updateEmailSchema = z.strictObject({ email: z.string() });
const resetPasswordSchema = z.strictObject({ password: z.string() });
const emptyActionSchema = z.strictObject({});
const canonicalDecimalPattern = /^[1-9]\d*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalidRequest(): never {
  throw new BadRequestException();
}

function canonicalEmail(email: string): string {
  const canonical = normalizeEmail(email);
  return isValidCanonicalEmail(canonical) ? canonical : invalidRequest();
}

function passwordWithinPolicy(password: string): string {
  try {
    assertPasswordPolicy(password);
    return password;
  } catch {
    return invalidRequest();
  }
}

function positiveDecimal(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !canonicalDecimalPattern.test(value)) {
    return invalidRequest();
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : invalidRequest();
}

export function parseListUsersQuery(query: unknown): { page: number; pageSize: number } {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    return invalidRequest();
  }
  const entries = Object.entries(query);
  if (entries.some(([key]) => key !== "page" && key !== "pageSize")) {
    return invalidRequest();
  }
  const values = query as Record<string, unknown>;
  const page = positiveDecimal(values.page, 1);
  const pageSize = positiveDecimal(values.pageSize, 20);
  const offset = (page - 1) * pageSize;
  if (pageSize > 100 || !Number.isSafeInteger(offset)) {
    return invalidRequest();
  }
  return { page, pageSize };
}

export function parseCreateUserBody(body: unknown): { email: string; password: string } {
  const result = createUserSchema.safeParse(body);
  if (!result.success) return invalidRequest();
  return {
    email: canonicalEmail(result.data.email),
    password: passwordWithinPolicy(result.data.password),
  };
}

export function parseUpdateEmailBody(body: unknown): { email: string } {
  const result = updateEmailSchema.safeParse(body);
  if (!result.success) return invalidRequest();
  return { email: canonicalEmail(result.data.email) };
}

export function parseResetPasswordBody(body: unknown): { password: string } {
  const result = resetPasswordSchema.safeParse(body);
  if (!result.success) return invalidRequest();
  return { password: passwordWithinPolicy(result.data.password) };
}

export function parseEmptyActionBody(body: unknown): void {
  if (body === undefined) return;
  if (!emptyActionSchema.safeParse(body).success) invalidRequest();
}

export function parseUserId(id: string): string {
  return uuidPattern.test(id) ? id : invalidRequest();
}
