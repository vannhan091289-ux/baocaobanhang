import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface EncryptedPayload {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}

/**
 * Generates an opaque random token with at least 256 bits (32 bytes) of entropy.
 */
export function generateOpaqueToken(byteLength = 32): string {
  if (byteLength < 32) {
    throw new Error("Opaque token must be at least 32 bytes (256 bits).");
  }
  return randomBytes(byteLength).toString("base64url");
}

/**
 * Computes the SHA-256 hex digest (64 lowercase hex chars) of an opaque token.
 * Raw tokens are never stored in the database.
 */
export function hashOpaqueToken(rawToken: string): string {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("Token to hash must be a non-empty string.");
  }
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Produces a safe, deterministic, non-reversible reference for an OIDC subject
 * so raw external claims/PII are never written to AuditEvent or logs.
 */
export function createSafeSubjectRef(issuer: string, subject: string): string {
  const digest = createHash("sha256")
    .update(`${issuer}|${subject}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `oidc_sub_sha256:${digest}`;
}

/**
 * Constant-time string comparison for CSRF tokens and state bindings.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Encrypts the PKCE code_verifier using AES-256-GCM (256-bit key, 96-bit random IV, 128-bit auth tag)
 * per docs/decisions/SPRINT-1-APPROVAL.md §2.
 */
export function encryptVerifierAes256Gcm(
  plaintextVerifier: string,
  key: Buffer,
  associatedData?: string,
): EncryptedPayload {
  if (key.length !== 32) {
    throw new Error("AES-256-GCM key must be exactly 32 bytes (256 bits).");
  }
  if (!plaintextVerifier) {
    throw new Error("PKCE verifier plaintext must not be empty.");
  }
  const iv = randomBytes(12); // 96-bit random IV
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16,
  });
  if (associatedData) {
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
  }
  const encrypted = Buffer.concat([
    cipher.update(plaintextVerifier, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertextB64: encrypted.toString("base64"),
    ivB64: iv.toString("base64"),
    authTagB64: authTag.toString("base64"),
  };
}

/**
 * Decrypts and authenticates the PKCE code_verifier using AES-256-GCM.
 * Fails closed on any IV, ciphertext, authTag, or AAD tampering.
 */
export function decryptVerifierAes256Gcm(
  payload: EncryptedPayload,
  key: Buffer,
  associatedData?: string,
): string {
  if (key.length !== 32) {
    throw new Error("AES-256-GCM key must be exactly 32 bytes (256 bits).");
  }
  const iv = Buffer.from(payload.ivB64, "base64");
  const authTag = Buffer.from(payload.authTagB64, "base64");
  const ciphertext = Buffer.from(payload.ciphertextB64, "base64");

  if (iv.length !== 12) {
    throw new Error(
      "Invalid AES-256-GCM IV length; expected 12 bytes (96 bits).",
    );
  }
  if (authTag.length !== 16) {
    throw new Error(
      "Invalid AES-256-GCM auth tag length; expected 16 bytes (128 bits).",
    );
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16,
  });
  decipher.setAuthTag(authTag);
  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
  }

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
