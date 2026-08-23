import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, EncryptionKeyError, maskSecret } from "./index.js";

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("secret crypto", () => {
  it("round trips with authenticated AES-GCM", () => {
    const envelope = encryptSecret("AIza-test-secret", key);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(decryptSecret(envelope, key)).toBe("AIza-test-secret");
  });

  it("rejects tampering and invalid keys", () => {
    const envelope = encryptSecret("secret", key);
    const parts = envelope.split(":");
    const ciphertext = parts[3]!;
    parts[3] = `${ciphertext.slice(0, -1)}${ciphertext.slice(-1) === "A" ? "B" : "A"}`;
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
    expect(() => encryptSecret("secret", "too-short")).toThrow(EncryptionKeyError);
  });

  it("masks only the final four characters", () => {
    expect(maskSecret("AIza-1234abcd")).toBe("••••••••abcd");
    expect(maskSecret("abcd")).toBe("••••••••");
    expect(maskSecret(undefined)).toBeNull();
  });
});
