import { BadRequestException } from "@nestjs/common";
import { assertPasswordPolicy } from "@yt-monitor/auth";
import { z } from "zod";

const loginSchema = z.strictObject({
  email: z.string(),
  password: z.string(),
});

const logoutSchema = z.strictObject({});

const changePasswordSchema = z.strictObject({
  currentPassword: z.string(),
  newPassword: z.string(),
});

function invalidRequest(): never {
  throw new BadRequestException();
}

export function parseLoginBody(body: unknown): z.infer<typeof loginSchema> {
  const result = loginSchema.safeParse(body);
  return result.success ? result.data : invalidRequest();
}

export function parseLogoutBody(body: unknown): void {
  if (body === undefined) {
    return;
  }
  if (!logoutSchema.safeParse(body).success) {
    invalidRequest();
  }
}

export function parseChangePasswordBody(body: unknown): z.infer<typeof changePasswordSchema> {
  const result = changePasswordSchema.safeParse(body);
  if (!result.success) {
    return invalidRequest();
  }

  try {
    assertPasswordPolicy(result.data.newPassword);
  } catch {
    return invalidRequest();
  }
  return result.data;
}
