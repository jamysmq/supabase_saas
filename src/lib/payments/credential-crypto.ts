import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { ProviderConnectionCredentials } from "./provider-contract";

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getEncryptionKey() {
  const encodedKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;

  if (!encodedKey) {
    throw new Error("PAYMENT_CREDENTIALS_ENCRYPTION_KEY is not configured.");
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error(
      "PAYMENT_CREDENTIALS_ENCRYPTION_KEY must be a Base64-encoded 32-byte key."
    );
  }

  return key;
}

export function encryptProviderCredentials(
  credentials: ProviderConnectionCredentials
) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptProviderCredentials(
  encryptedValue: string
): ProviderConnectionCredentials {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, ...rest] =
    encryptedValue.split(".");

  if (
    version !== FORMAT_VERSION ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedCiphertext ||
    rest.length > 0
  ) {
    throw new Error("Unsupported payment credential format.");
  }

  const iv = Buffer.from(encodedIv, "base64url");
  const authTag = Buffer.from(encodedAuthTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Invalid payment credential payload.");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid payment credential contents.");
  }

  return parsed as ProviderConnectionCredentials;
}
