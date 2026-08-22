import argon2 from "argon2";
import { describe, expect, it } from "vitest";

import { assertPasswordPolicy, hashPassword, normalizeEmail, verifyPassword } from "./index.js";

describe("password primitives", () => {
  it("normalizes email without preserving surrounding space or letter case", () => {
    expect(normalizeEmail("  Admin@Example.COM ")).toBe("admin@example.com");
  });

  it("rejects passwords shorter than 12 Unicode code points", () => {
    expect(() => assertPasswordPolicy("12345678901")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("accepts exactly 12 Unicode code points even when they use surrogate pairs", () => {
    expect(() => assertPasswordPolicy("😀".repeat(12))).not.toThrow();
  });

  it("rejects passwords longer than 128 Unicode code points", () => {
    expect(() => assertPasswordPolicy("😀".repeat(129))).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("prevents hashPassword from bypassing the password policy", async () => {
    await expect(hashPassword("short")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("encodes the required Argon2id cost and output parameters in the PHC hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const fields = hash.split("$");

    expect(fields.slice(0, 3)).toEqual(["", "argon2id", "v=19"]);
    expect(new Set((fields[3] ?? "").split(","))).toEqual(new Set(["m=65536", "t=3", "p=1"]));
    expect(Buffer.from(fields[4] ?? "", "base64").length).toBeGreaterThanOrEqual(16);
    expect(Buffer.from(fields[5] ?? "", "base64")).toHaveLength(32);
  });

  it("does not accept a realistic wrong password for a valid hash", async () => {
    const hash = await hashPassword("S3cure passphrase!");

    await expect(verifyPassword(hash, "S3cure passphrase?")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("does not normalize password text before hashing or verification", async () => {
    const decomposedPassword = "Cafe\u0301-Password!";
    const hash = await hashPassword(decomposedPassword);

    await expect(verifyPassword(hash, decomposedPassword.normalize("NFC"))).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("reports rehashing only after a valid verification with outdated parameters", async () => {
    const password = "valid password for rehash";
    const outdatedHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 32_768,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });

    await expect(verifyPassword(outdatedHash, password)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(verifyPassword(outdatedHash, "wrong password value")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("does not leave a valid non-Argon2id hash unflagged for rehashing", async () => {
    const password = "valid password for variant";
    const argon2iHash = await argon2.hash(password, {
      type: argon2.argon2i,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
    });

    await expect(verifyPassword(argon2iHash, password)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it("treats malformed stored hashes as invalid credentials", async () => {
    await expect(verifyPassword("not-a-phc-hash", "valid password value")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});
