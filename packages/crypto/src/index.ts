import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export class EncryptionKeyError extends Error {
  constructor() {
    super("SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes");
    this.name = "EncryptionKeyError";
  }
}

function decodeKey(value: string): Buffer {
  const trimmed = value.trim();
  const candidates: Buffer[] = [];
  if (/^[0-9a-f]{64}$/i.test(trimmed)) candidates.push(Buffer.from(trimmed, "hex"));
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length > 0) candidates.push(decoded);
  } catch {
    // A malformed base64 value is rejected by the length check below.
  }
  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) throw new EncryptionKeyError();
  return key;
}

function encodePart(value: Buffer): string {
  return value.toString("base64url");
}

function decodePart(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/** Encrypts a secret as a versioned, authenticated AES-256-GCM envelope. */
export function encryptSecret(secret: string, encryptionKey: string): string {
  if (secret.length === 0) throw new Error("Cannot encrypt an empty secret");
  const key = decodeKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, encodePart(iv), encodePart(tag), encodePart(ciphertext)].join(":");
}

/** Decrypts and authenticates a value produced by encryptSecret. */
export function decryptSecret(envelope: string, encryptionKey: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = envelope.split(":");
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Invalid encrypted secret envelope");
  }
  const iv = decodePart(ivPart);
  const tag = decodePart(tagPart);
  const ciphertext = decodePart(ciphertextPart);
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted secret envelope");
  const decipher = createDecipheriv(ALGORITHM, decodeKey(encryptionKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Returns a UI-safe representation that never includes the complete secret. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 4) return "••••••••";
  const suffix = secret.slice(-4);
  return `••••••••${suffix}`;
}

/** Hashes a value for a stable, non-reversible cache/config comparison. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
