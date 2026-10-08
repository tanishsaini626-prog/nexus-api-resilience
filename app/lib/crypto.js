import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Provider keys are encrypted at rest with AES-256-GCM before they touch the
// database. GCM gives us confidentiality AND tamper detection: the auth tag it
// appends means a modified ciphertext fails to decrypt instead of silently
// returning garbage. A fresh random IV per encryption means the same key
// encrypts to different ciphertext every time, so stored rows leak no patterns.
//
// Stored format:  enc:v1:<base64( iv | authTag | ciphertext )>
// The "enc:v1:" prefix marks the scheme, so a future v2 can be read alongside
// v1 rows, and anything WITHOUT the prefix is a legacy plaintext row written
// before encryption existed (see decryptSecret).
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = "enc:v1:";

// Read lazily (not at module load) so tests and env changes take effect per call.
function getEncryptionKey() {
  const hex = process.env.NEXUS_ENCRYPTION_KEY;
  if (!hex) return null;
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("NEXUS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return key;
}

export function isEncryptionEnabled() {
  return Boolean(process.env.NEXUS_ENCRYPTION_KEY);
}

// Encrypts when a key is configured. Without one we store the plaintext
// unchanged (with a warning) so an environment that hasn't set the variable
// yet keeps working instead of failing every save.
export function encryptSecret(plaintext) {
  const key = getEncryptionKey();
  if (!key) {
    console.warn("NEXUS_ENCRYPTION_KEY is not set — storing provider key unencrypted");
    return plaintext;
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return PREFIX + payload.toString("base64");
}

// Reverses encryptSecret. Values without the prefix are legacy plaintext rows
// and pass straight through, so existing keys keep working until re-saved.
export function decryptSecret(stored) {
  if (typeof stored !== "string" || !stored.startsWith(PREFIX)) return stored;

  const key = getEncryptionKey();
  if (!key) throw new Error("Cannot decrypt: NEXUS_ENCRYPTION_KEY is not set");

  const payload = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (payload.length <= IV_BYTES + TAG_BYTES) throw new Error("Malformed encrypted value");

  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag); // throws below if the key is wrong or data was altered
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
